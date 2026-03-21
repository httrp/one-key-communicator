package room

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"sync"
	"time"

	"github.com/dominikhattrup/one-key-communicator/internal/storage"
)

// Manager handles room lifecycle.
type Manager struct {
	mu    sync.RWMutex
	rooms map[string]*Room
	db    *storage.DB
}

// NewManager creates a room manager with persistence.
func NewManager(db *storage.DB) *Manager {
	return &Manager{
		rooms: make(map[string]*Room),
		db:    db,
	}
}

// Create makes a new room with a cryptographically random ID.
func (m *Manager) Create(language string) *Room {
	id := generateID()

	r := &Room{
		ID:        id,
		CreatedAt: time.Now(),
		Language:  language,
		Text:      "",
		readers:   make(map[*Client]bool),
	}

	m.mu.Lock()
	m.rooms[id] = r
	m.mu.Unlock()

	// Persist
	if m.db != nil {
		_ = m.db.SaveRoom(&storage.RoomRecord{
			ID:         id,
			CreatedAt:  r.CreatedAt,
			LastActive: time.Now(),
			TextState:  "",
			Language:   language,
		})
	}

	return r
}

// Get returns a room by ID, loading from DB if necessary.
func (m *Manager) Get(id string) *Room {
	m.mu.RLock()
	r, ok := m.rooms[id]
	m.mu.RUnlock()
	if ok {
		return r
	}

	// Try loading from DB
	if m.db == nil {
		return nil
	}
	rec, err := m.db.GetRoom(id)
	if err != nil {
		return nil
	}

	r = &Room{
		ID:        rec.ID,
		CreatedAt: rec.CreatedAt,
		Language:  rec.Language,
		Text:      rec.TextState,
		readers:   make(map[*Client]bool),
	}

	m.mu.Lock()
	m.rooms[id] = r
	m.mu.Unlock()

	return r
}

// Cleanup removes rooms that have been inactive.
func (m *Manager) Cleanup(maxAge time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for id, r := range m.rooms {
		r.mu.RLock()
		inactive := r.lastActive.Before(cutoff)
		r.mu.RUnlock()
		if inactive {
			r.mu.Lock()
			for c := range r.readers {
				close(c.Send)
			}
			r.readers = nil
			r.mu.Unlock()
			delete(m.rooms, id)
		}
	}

	if m.db != nil {
		n, err := m.db.DeleteStaleRooms(maxAge)
		if err != nil {
			log.Printf("cleanup DB: %v", err)
		} else if n > 0 {
			log.Printf("cleaned %d stale rooms from DB", n)
		}
	}
}

// Save persists the current text state of a room.
func (m *Manager) Save(r *Room) {
	if m.db == nil {
		return
	}
	r.mu.RLock()
	text := r.Text
	r.mu.RUnlock()
	_ = m.db.SaveRoom(&storage.RoomRecord{
		ID:         r.ID,
		CreatedAt:  r.CreatedAt,
		LastActive: time.Now(),
		TextState:  text,
		Language:   r.Language,
	})
}

// StartCleanupLoop runs periodic cleanup in the background.
func (m *Manager) StartCleanupLoop(interval, maxAge time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			m.Cleanup(maxAge)
		}
	}()
}

func generateID() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}
