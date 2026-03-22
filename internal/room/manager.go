package room

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"sync"
	"time"

	"github.com/dominikhattrup/one-key-communicator/internal/storage"
)

// Manager handles room lifecycle.
type Manager struct {
	mu              sync.RWMutex
	rooms           map[string]*Room
	db              *storage.DB
	connectedCount  int64 // current WebSocket connections
	connectMu       sync.RWMutex
}

// NewManager creates a room manager with persistence.
func NewManager(db *storage.DB) *Manager {
	return &Manager{
		rooms: make(map[string]*Room),
		db:    db,
	}
}

// Create makes a new room with a cryptographically random ID and PIN.
func (m *Manager) Create(language string) *Room {
	id := generateID()
	pin := generatePIN()

	r := &Room{
		ID:        id,
		PIN:       pin,
		CreatedAt: time.Now(),
		Language:  language,
		Text:      "",
		readers:   make(map[*Client]bool),
	}

	m.mu.Lock()
	m.rooms[id] = r
	m.mu.Unlock()

	// Persist and track stats
	if m.db != nil {
		_ = m.db.SaveRoom(&storage.RoomRecord{
			ID:         id,
			PIN:        pin,
			CreatedAt:  r.CreatedAt,
			LastActive: time.Now(),
			TextState:  "",
			Language:   language,
		})
		_ = m.db.IncrementTotalRooms()
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
		PIN:       rec.PIN,
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
		// First, clear text from rooms inactive for 24+ hours (privacy)
		n, err := m.db.ClearStaleText(24 * time.Hour)
		if err != nil {
			log.Printf("cleanup text: %v", err)
		} else if n > 0 {
			log.Printf("cleared text from %d inactive rooms", n)
		}

		// Then, delete rooms inactive for 24+ hours
		n, err = m.db.DeleteStaleRooms(maxAge)
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
	pin := r.PIN
	r.mu.RUnlock()
	_ = m.db.SaveRoom(&storage.RoomRecord{
		ID:         r.ID,
		PIN:        pin,
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

// generatePIN creates a cryptographically random 6-digit PIN.
func generatePIN() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return fmt.Sprintf("%06d", n.Int64())
}

// Stats represents current system statistics.
type Stats struct {
	ActiveConnections int64            `json:"activeConnections"`
	ActiveRooms       int64            `json:"activeRooms"`
	TotalRoomsCreated int64            `json:"totalRoomsCreated"`
	TotalConnections  int64            `json:"totalConnections"`
	RoomsLast24h      int64            `json:"roomsLast24h"`
	RoomsLast7d       int64            `json:"roomsLast7d"`
	CountryStats      map[string]int64 `json:"countryStats,omitempty"`
}

// IncrementConnections tracks a new WebSocket connection.
func (m *Manager) IncrementConnections() {
	m.connectMu.Lock()
	m.connectedCount++
	m.connectMu.Unlock()
}

// TrackConnection records a new connection with country info.
func (m *Manager) TrackConnection(country string) {
	if m.db != nil {
		_ = m.db.IncrementTotalConnections()
		if country != "" {
			_ = m.db.IncrementCountry(country)
		}
	}
}

// DecrementConnections tracks a closed WebSocket connection.
func (m *Manager) DecrementConnections() {
	m.connectMu.Lock()
	m.connectedCount--
	m.connectMu.Unlock()
}

// GetStats returns current system statistics.
func (m *Manager) GetStats() *Stats {
	m.connectMu.RLock()
	connected := m.connectedCount
	m.connectMu.RUnlock()

	stats := &Stats{
		ActiveConnections: connected,
		CountryStats:      make(map[string]int64),
	}

	if m.db != nil {
		dbStats, err := m.db.GetStats()
		if err == nil {
			stats.TotalRoomsCreated = dbStats.TotalRoomsCreated
			stats.TotalConnections = dbStats.TotalConnections
			stats.ActiveRooms = dbStats.ActiveRooms
			stats.RoomsLast24h = dbStats.RoomsLast24h
			stats.RoomsLast7d = dbStats.RoomsLast7d
			stats.CountryStats = dbStats.CountryStats
		}
	}

	return stats
}
