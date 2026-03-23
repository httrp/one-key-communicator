package room

import (
	"encoding/json"
	"net"
	"strings"
	"sync"
	"time"
)

// Room represents a communication session.
type Room struct {
	ID        string
	PIN       string // 6-digit access PIN for readers
	CreatedAt time.Time
	Language  string
	Text      string

	mu         sync.RWMutex
	writer     *Client
	readers    map[*Client]bool
	lastActive time.Time
}

// ValidatePIN checks if the provided PIN matches the room's PIN.
func (r *Room) ValidatePIN(pin string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.PIN == pin
}

// Client represents a connected WebSocket client.
type Client struct {
	Send       chan []byte
	IsWriter   bool
	Name       string
	IP         string // Client IP address
	UserAgent  string // User-Agent header
	DeviceType string // Parsed: "desktop", "tablet", "mobile", "unknown"
	IsLocal    bool   // True if same /24 subnet as writer
}

// Message types sent over WebSocket.
type Message struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
}

// SetWriter assigns the writer client to the room.
func (r *Room) SetWriter(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.writer = c
	c.IsWriter = true
	r.lastActive = time.Now()
}

// AddReader adds a reader client and notifies the writer of the new count.
func (r *Room) AddReader(c *Client) {
	r.mu.Lock()
	r.readers[c] = true
	r.lastActive = time.Now()
	count := len(r.readers)
	names := r.readerNames()
	writer := r.writer
	r.mu.Unlock()

	r.sendReaderInfo(writer, count, names)
}

// RemoveClient removes a client (writer or reader).
// If a reader is removed, notifies the writer of the new count.
func (r *Room) RemoveClient(c *Client) {
	r.mu.Lock()
	isWriter := c.IsWriter && r.writer == c
	if isWriter {
		r.writer = nil
	}
	delete(r.readers, c)
	count := len(r.readers)
	names := r.readerNames()
	writer := r.writer
	r.mu.Unlock()

	if !isWriter && writer != nil {
		r.sendReaderInfo(writer, count, names)
	}
}

// SetReaderName sets the display name for a reader and notifies the writer.
func (r *Room) SetReaderName(c *Client, name string) {
	r.mu.Lock()
	c.Name = name
	count := len(r.readers)
	names := r.readerNames()
	writer := r.writer
	r.mu.Unlock()

	r.sendReaderInfo(writer, count, names)
}

// UpdateText sets the text and broadcasts to all readers.
func (r *Room) UpdateText(text string) {
	r.mu.Lock()
	r.Text = text
	r.lastActive = time.Now()
	readers := make([]*Client, 0, len(r.readers))
	for c := range r.readers {
		readers = append(readers, c)
	}
	r.mu.Unlock()

	msg := []byte(`{"type":"text","data":` + jsonEscapeStr(text) + `}`)
	for _, c := range readers {
		select {
		case c.Send <- msg:
		default:
		}
	}
}

// GetText returns the current text.
func (r *Room) GetText() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.Text
}

// ReaderCount returns the number of connected readers.
func (r *Room) ReaderCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.readers)
}

// HasWriter returns whether a writer is connected.
func (r *Room) HasWriter() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.writer != nil
}

// readerNames returns all reader names. Must be called with r.mu held.
func (r *Room) readerNames() []string {
	names := make([]string, 0, len(r.readers))
	for c := range r.readers {
		names = append(names, c.Name)
	}
	return names
}

// ReaderInfo contains extended information about a reader
type ReaderInfo struct {
	Name       string `json:"name"`
	DeviceType string `json:"deviceType"`
	IsLocal    bool   `json:"isLocal"`
}

// readerInfoList returns extended info for all readers. Must be called with r.mu held.
func (r *Room) readerInfoList() []ReaderInfo {
	list := make([]ReaderInfo, 0, len(r.readers))
	for c := range r.readers {
		list = append(list, ReaderInfo{
			Name:       c.Name,
			DeviceType: c.DeviceType,
			IsLocal:    c.IsLocal,
		})
	}
	return list
}

// sendReaderInfo notifies the writer of the current reader count and details.
func (r *Room) sendReaderInfo(w *Client, count int, names []string) {
	if w == nil {
		return
	}
	// Get extended reader info
	r.mu.RLock()
	readers := r.readerInfoList()
	r.mu.RUnlock()

	info := struct {
		Count   int          `json:"count"`
		Names   []string     `json:"names"`
		Readers []ReaderInfo `json:"readers"`
	}{count, names, readers}
	infoBytes, _ := json.Marshal(info)
	msg := []byte(`{"type":"readers","data":` + string(infoBytes) + `}`)
	select {
	case w.Send <- msg:
	default:
	}
}

func jsonEscapeStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// DetectDeviceType parses User-Agent to determine device type
func DetectDeviceType(ua string) string {
	ua = strings.ToLower(ua)
	if strings.Contains(ua, "mobile") || strings.Contains(ua, "android") && !strings.Contains(ua, "tablet") {
		if strings.Contains(ua, "ipad") || strings.Contains(ua, "tablet") {
			return "tablet"
		}
		return "mobile"
	}
	if strings.Contains(ua, "ipad") || strings.Contains(ua, "tablet") {
		return "tablet"
	}
	if strings.Contains(ua, "windows") || strings.Contains(ua, "macintosh") || strings.Contains(ua, "linux") && !strings.Contains(ua, "android") {
		return "desktop"
	}
	return "unknown"
}

// IsSameSubnet checks if two IPs are in the same /24 subnet (local network)
func IsSameSubnet(ip1, ip2 string) bool {
	// Parse IPs (handle port if present)
	ip1 = extractIP(ip1)
	ip2 = extractIP(ip2)

	parsedIP1 := net.ParseIP(ip1)
	parsedIP2 := net.ParseIP(ip2)

	if parsedIP1 == nil || parsedIP2 == nil {
		return false
	}

	// Convert to IPv4 if needed
	parsedIP1 = parsedIP1.To4()
	parsedIP2 = parsedIP2.To4()

	if parsedIP1 == nil || parsedIP2 == nil {
		return false
	}

	// Compare first 3 octets (/24 subnet)
	return parsedIP1[0] == parsedIP2[0] &&
		parsedIP1[1] == parsedIP2[1] &&
		parsedIP1[2] == parsedIP2[2]
}

// extractIP removes port from IP:port string
func extractIP(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

// GetWriterIP returns the writer's IP address
func (r *Room) GetWriterIP() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.writer != nil {
		return r.writer.IP
	}
	return ""
}
