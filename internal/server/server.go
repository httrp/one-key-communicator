package server

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/dominikhattrup/one-key-communicator/internal/config"
	"github.com/dominikhattrup/one-key-communicator/internal/room"
	"github.com/dominikhattrup/one-key-communicator/internal/storage"
	"golang.org/x/net/websocket"
)

// Server is the main HTTP/WebSocket server.
type Server struct {
	cfg     *config.Config
	rooms   *room.Manager
	mux     *http.ServeMux
	landing fs.FS
	app     fs.FS
}

// New creates a new server with all routes configured.
func New(cfg *config.Config, db *storage.DB, landingFS, appFS embed.FS) *Server {
	s := &Server{
		cfg:   cfg,
		rooms: room.NewManager(db),
		mux:   http.NewServeMux(),
	}

	var err error
	s.landing, err = fs.Sub(landingFS, "web/landing")
	if err != nil {
		log.Fatalf("landing FS: %v", err)
	}
	s.app, err = fs.Sub(appFS, "web/app")
	if err != nil {
		log.Fatalf("app FS: %v", err)
	}

	s.routes()

	// Start background cleanup: every 10 minutes, remove rooms inactive for 24h
	s.rooms.StartCleanupLoop(10*time.Minute, 24*time.Hour)

	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("/api/rooms", s.handleCreateRoom)
	s.mux.HandleFunc("/api/rooms/", s.handleRoomInfo)
	s.mux.Handle("/ws/", websocket.Handler(s.handleWebSocket))
	s.mux.HandleFunc("/app/", s.handleApp)
	s.mux.HandleFunc("/app", s.handleApp)
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

		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
		"id":       rm.ID,
		"writeURL": fmt.Sprintf("%s/app#/room/%s", s.cfg.BaseURL, rm.ID),
		"readURL":  fmt.Sprintf("%s/app#/read/%s", s.cfg.BaseURL, rm.ID),
	})
}

func (s *Server) handleRoomInfo(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/rooms/")
	if id == "" {
		http.Error(w, "Room ID required", http.StatusBadRequest)
		return
	}

	rm := s.rooms.Get(id)
	if rm == nil {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":       rm.ID,
		"language": rm.Language,
		"readers":  rm.ReaderCount(),
		"writer":   rm.HasWriter(),
	})
}

func (s *Server) handleWebSocket(ws *websocket.Conn) {
	defer ws.Close()

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
		return
	}

	client := &room.Client{
		Send: make(chan []byte, 64),
	}

	switch role {
	case "write":
		rm.SetWriter(client)
	case "read":
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
		if !client.IsWriter {
			continue
		}

		var msg room.Message
		if err := json.Unmarshal(buf[:n], &msg); err != nil {
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

func (s *Server) handleApp(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/app")
	if path == "" || path == "/" {
		path = "/index.html"
	}

	f, err := s.app.Open(strings.TrimPrefix(path, "/"))
	if err != nil {
		path = "/index.html"
		f, err = s.app.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}
	f.Close()

	if strings.HasSuffix(path, ".js") {
		w.Header().Set("Content-Type", "application/javascript")
	} else if strings.HasSuffix(path, ".css") {
		w.Header().Set("Content-Type", "text/css")
	} else if strings.HasSuffix(path, ".json") {
		w.Header().Set("Content-Type", "application/json")
	}

	r.URL.Path = path
	http.FileServer(http.FS(s.app)).ServeHTTP(w, r)
}
