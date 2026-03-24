package server

import (
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/dominikhattrup/one-key-communicator/internal/config"
	"github.com/dominikhattrup/one-key-communicator/internal/room"
	"github.com/dominikhattrup/one-key-communicator/internal/storage"
	"golang.org/x/net/websocket"
)

// Server is the main HTTP/WebSocket server.
type Server struct {
	cfg           *config.Config
	rooms         *room.Manager
	mux           *http.ServeMux
	landing       fs.FS
	app           fs.FS
	pinLimiter    *RateLimiter // Strict limiter for PIN verification (anti brute-force)
	createLimiter *RateLimiter // Limiter for room creation
	readTokens    map[string]readAccessToken
	readTokenMu   sync.Mutex
}

type readAccessToken struct {
	RoomID    string
	ExpiresAt time.Time
}

// New creates a new server with all routes configured.
func New(cfg *config.Config, db *storage.DB, landingFS, appFS embed.FS) *Server {
	s := &Server{
		cfg:           cfg,
		rooms:         room.NewManager(db),
		mux:           http.NewServeMux(),
		pinLimiter:    NewRateLimiter(10, time.Minute),  // 10 PIN attempts per minute per IP
		createLimiter: NewRateLimiter(30, time.Minute), // 30 room creations per minute per IP
		readTokens:    make(map[string]readAccessToken),
	}

	var err error
	s.landing, err = fs.Sub(landingFS, "landing")
	if err != nil {
		log.Fatalf("landing FS: %v", err)
	}
	s.app, err = fs.Sub(appFS, "app")
	if err != nil {
		log.Fatalf("app FS: %v", err)
	}

	s.routes()

	// Start background cleanup: every 10 minutes, remove rooms inactive for 24h
	s.rooms.StartCleanupLoop(10*time.Minute, 24*time.Hour)

	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("/api/rooms", s.createLimiter.RateLimitMiddleware(s.handleCreateRoom))
	s.mux.HandleFunc("/api/rooms/", s.handleRoomInfo)
	s.mux.HandleFunc("/api/verify-pin", s.pinLimiter.RateLimitMiddleware(s.handleVerifyPIN))
	s.mux.HandleFunc("/api/stats", s.handleStats)
	s.mux.Handle("/ws/", websocket.Handler(s.handleWebSocket))
	s.mux.HandleFunc("/app/", s.handleApp)
	s.mux.HandleFunc("/app", s.handleAppRedirect)
	s.mux.HandleFunc("/stats", s.handleStatsPage)
	s.mux.HandleFunc("/hardware", s.handleHardwarePage)
	s.mux.HandleFunc("/impressum", s.handleImpressumPage)
	s.mux.HandleFunc("/", s.handleLanding)
}

// ListenAndServe starts the HTTP server.
func (s *Server) ListenAndServe() error {
	addr := fmt.Sprintf(":%d", s.cfg.Port)
	log.Printf("OKC listening on %s", addr)
	log.Printf("Landing page: http://localhost:%d", s.cfg.Port)
	log.Printf("App:          http://localhost:%d/app", s.cfg.Port)
	return http.ListenAndServe(addr, s.withMiddleware(s.mux))
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'")

		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") {
			origin := strings.TrimRight(s.cfg.BaseURL, "/")
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	lang := "de"
	if l := r.URL.Query().Get("lang"); l != "" {
		lang = l
	}

	rm := s.rooms.Create(lang)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"id":          rm.ID,
		"pin":         rm.PIN,
		"writerToken": rm.WriterToken,
		"writeURL":    fmt.Sprintf("%s/app#/room/%s", s.cfg.BaseURL, rm.ID),
		"readURL":     fmt.Sprintf("%s/app#/read/%s", s.cfg.BaseURL, rm.ID),
	})
}

func (s *Server) handleRoomInfo(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/rooms/")
	if id == "" {
		http.Error(w, "Room ID required", http.StatusBadRequest)
		return
	}

	// DELETE - delete room
	if r.Method == http.MethodDelete {
		token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if token == "" {
			token = strings.TrimSpace(r.Header.Get("X-Writer-Token"))
		}

		rm := s.rooms.Get(id)
		if rm == nil {
			http.Error(w, "Room not found", http.StatusNotFound)
			return
		}
		if token == "" || token != rm.WriterToken {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		s.rooms.Delete(id)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	rm := s.rooms.Get(id)
	if rm == nil {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":          rm.ID,
		"language":    rm.Language,
		"readers":     rm.ReaderCount(),
		"writer":      rm.HasWriter(),
		"pinRequired": rm.PIN != "",
	})
}

// handleVerifyPIN validates a PIN for room access.
func (s *Server) handleVerifyPIN(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		RoomID string `json:"roomId"`
		PIN    string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	rm := s.rooms.Get(req.RoomID)
	if rm == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"valid": false,
			"error": "room_not_found",
		})
		return
	}

	valid := rm.ValidatePIN(req.PIN)
	resp := map[string]interface{}{"valid": valid}
	if valid {
		resp["readToken"] = s.issueReadToken(req.RoomID, 2*time.Minute)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleWebSocket(ws *websocket.Conn) {
	defer ws.Close()

	if !s.validateWebSocketOrigin(ws.Request()) {
		log.Printf("WS: blocked origin %q", ws.Request().Header.Get("Origin"))
		ws.Write([]byte(`{"type":"error","data":"invalid_origin"}`))
		time.Sleep(100 * time.Millisecond)
		return
	}

	parts := strings.Split(strings.Trim(ws.Request().URL.Path, "/"), "/")
	if len(parts) < 3 {
		log.Printf("WS: invalid path %s", ws.Request().URL.Path)
		return
	}
	roomID := parts[1]
	role := parts[2]

	rm := s.rooms.Get(roomID)
	if rm == nil {
		log.Printf("WS: room %s not found", roomID)
		// Send error to client before closing
		ws.Write([]byte(`{"type":"error","data":"room_not_found"}`))
		time.Sleep(100 * time.Millisecond) // Give client time to receive
		return
	}

	// Validate PIN for readers
	if role == "read" && rm.PIN != "" {
		readToken := ws.Request().URL.Query().Get("token")
		if !s.consumeReadToken(readToken, roomID) {
			log.Printf("WS: invalid read token for room %s", roomID)
			ws.Write([]byte(`{"type":"error","data":"invalid_pin"}`))
			time.Sleep(100 * time.Millisecond) // Give client time to receive
			return
		}
	}

	// Track active connections and country stats
	s.rooms.IncrementConnections()
	country := extractCountry(ws.Request().Header.Get("Accept-Language"))
	s.rooms.TrackConnection(country)
	defer s.rooms.DecrementConnections()

	// Extract client info
	clientIP := getClientIP(ws.Request())
	userAgent := ws.Request().Header.Get("User-Agent")
	deviceType := room.DetectDeviceType(userAgent)

	client := &room.Client{
		Send:       make(chan []byte, 64),
		IP:         clientIP,
		UserAgent:  userAgent,
		DeviceType: deviceType,
	}

	switch role {
	case "write":
		rm.SetWriter(client)
		// Send existing text back to writer (important for page refresh)
		text := rm.GetText()
		if text != "" {
			b, _ := json.Marshal(map[string]string{"type": "text", "data": text})
			client.Send <- b
		}
		// Also send PIN to writer (for display)
		if rm.PIN != "" {
			b, _ := json.Marshal(map[string]string{"type": "pin", "data": rm.PIN})
			client.Send <- b
		}
		// Send room info (creation time)
		roomInfo := map[string]interface{}{
			"type": "room_info",
			"data": map[string]interface{}{
				"createdAt": rm.CreatedAt.Unix(),
			},
		}
		if b, err := json.Marshal(roomInfo); err == nil {
			client.Send <- b
		}
	case "read":
		// Check if reader is on same network as writer
		writerIP := rm.GetWriterIP()
		client.IsLocal = room.IsSameSubnet(clientIP, writerIP)
		rm.AddReader(client)
		text := rm.GetText()
		if text != "" {
			b, _ := json.Marshal(map[string]string{"type": "text", "data": text})
			client.Send <- b
		}
	default:
		log.Printf("WS: invalid role %s", role)
		return
	}

	defer rm.RemoveClient(client)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for msg := range client.Send {
			if _, err := ws.Write(msg); err != nil {
				return
			}
		}
	}()

	buf := make([]byte, 4096)
	for {
		n, err := ws.Read(buf)
		if err != nil {
			break
		}

		var msg room.Message
		if err := json.Unmarshal(buf[:n], &msg); err != nil {
			continue
		}

		// Readers can only send "name" messages
		if !client.IsWriter {
			if msg.Type == "name" {
				rm.SetReaderName(client, msg.Data)
			}
			continue
		}

		switch msg.Type {
		case "text":
			rm.UpdateText(msg.Data)
			s.rooms.Save(rm)
		case "clear":
			rm.UpdateText("")
			s.rooms.Save(rm)
		}
	}

	close(client.Send)
	<-done
}

func (s *Server) handleLanding(w http.ResponseWriter, r *http.Request) {
	http.FileServer(http.FS(s.landing)).ServeHTTP(w, r)
}

func (s *Server) handleAppRedirect(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/app/", http.StatusMovedPermanently)
}

func (s *Server) handleApp(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/app")
	if path == "" || path == "/" {
		path = "index.html"
	} else {
		path = strings.TrimPrefix(path, "/")
	}

	f, err := s.app.Open(path)
	if err != nil {
		// SPA fallback: serve index.html for unknown routes
		f, err = s.app.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		path = "index.html"
	}
	defer f.Close()

	// Detect content type from extension
	ct := mime.TypeByExtension(filepath.Ext(path))
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)

	io.Copy(w, f.(io.Reader))
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Protect with bearer token if configured.
	// Query parameters are intentionally not supported to avoid token leakage in logs.
	if s.cfg.StatsToken != "" {
		token := ""
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		}
		if token != s.cfg.StatsToken {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	stats := s.rooms.GetStats()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(stats)
}

func (s *Server) handleStatsPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	f, err := s.landing.Open("stats.html")
	if err != nil {
		http.Error(w, "Stats page not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	io.Copy(w, f.(io.Reader))
}

func (s *Server) handleHardwarePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	f, err := s.landing.Open("hardware.html")
	if err != nil {
		http.Error(w, "Hardware page not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	io.Copy(w, f.(io.Reader))
}

func (s *Server) handleImpressumPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	f, err := s.landing.Open("impressum.html")
	if err != nil {
		http.Error(w, "Impressum page not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	io.Copy(w, f.(io.Reader))
}

// getClientIP extracts the real client IP from request headers or RemoteAddr.
// Checks X-Forwarded-For and X-Real-IP headers first (for reverse proxy setups).
func getClientIP(r *http.Request) string {
	// Only trust forwarding headers from local/private proxies.
	if !isTrustedProxyRemoteAddr(r.RemoteAddr) {
		addr := r.RemoteAddr
		if host, _, err := net.SplitHostPort(addr); err == nil {
			return host
		}
		return addr
	}

	// Check X-Forwarded-For header (may contain comma-separated list)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	// Check X-Real-IP header
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	// Fall back to RemoteAddr (strip port if present)
	addr := r.RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

func isTrustedProxyRemoteAddr(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() {
		return true
	}
	return false
}

func (s *Server) issueReadToken(roomID string, ttl time.Duration) string {
	token := newSecureToken(24)
	s.readTokenMu.Lock()
	s.readTokens[token] = readAccessToken{RoomID: roomID, ExpiresAt: time.Now().Add(ttl)}
	s.readTokenMu.Unlock()
	return token
}

func (s *Server) consumeReadToken(token, roomID string) bool {
	if token == "" {
		return false
	}

	now := time.Now()
	s.readTokenMu.Lock()
	defer s.readTokenMu.Unlock()

	for k, v := range s.readTokens {
		if now.After(v.ExpiresAt) {
			delete(s.readTokens, k)
		}
	}

	entry, ok := s.readTokens[token]
	if !ok {
		return false
	}
	delete(s.readTokens, token)
	if now.After(entry.ExpiresAt) {
		return false
	}
	return entry.RoomID == roomID
}

func newSecureToken(numBytes int) string {
	b := make([]byte, numBytes)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func (s *Server) validateWebSocketOrigin(r *http.Request) bool {
	base, err := url.Parse(s.cfg.BaseURL)
	if err != nil {
		return false
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		// Non-browser clients may omit Origin.
		return true
	}
	originURL, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(originURL.Scheme, base.Scheme) && strings.EqualFold(originURL.Host, base.Host)
}

// extractCountry extracts country code from Accept-Language header.
// Returns 2-letter country code (e.g., "DE", "US") or empty string.
func extractCountry(acceptLang string) string {
	if acceptLang == "" {
		return ""
	}
	// Parse first language tag, e.g., "de-DE,de;q=0.9,en;q=0.8"
	parts := strings.Split(acceptLang, ",")
	if len(parts) == 0 {
		return ""
	}
	lang := strings.TrimSpace(strings.Split(parts[0], ";")[0])
	// Look for region subtag (e.g., "de-DE" -> "DE")
	if idx := strings.Index(lang, "-"); idx > 0 && len(lang) > idx+1 {
		return strings.ToUpper(lang[idx+1:])
	}
	// Fall back to language code as country approximation
	if len(lang) >= 2 {
		return strings.ToUpper(lang[:2])
	}
	return ""
}
