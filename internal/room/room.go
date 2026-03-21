package room

import (
	"encoding/json"
	"sync"
	"time"
)

// Room represents a communication session.
type Room struct {
	ID        string
	CreatedAt time.Time
	Language  string
	Text      string

	mu         sync.RWMutex
	writer     *Client
	readers    map[*Client]bool
	lastActive time.Time
}

// Client represents a connected WebSocket client.
type Client struct {
	Send     chan []byte
	IsWriter bool
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

// AddReader adds a reader client.
func (r *Room) AddReader(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.readers[c] = true
	r.lastActive = time.Now()
}

// RemoveClient removes a client (writer or reader).
func (r *Room) RemoveClient(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c.IsWriter && r.writer == c {
		r.writer = nil
	}
	delete(r.readers, c)
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

func jsonEscapeStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
