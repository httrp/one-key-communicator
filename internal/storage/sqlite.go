package storage

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// DB wraps the SQLite database connection.
type DB struct {
	conn *sql.DB
}

// RoomRecord represents a persisted room.
type RoomRecord struct {
	ID         string
	PIN        string
	CreatedAt  time.Time
	LastActive time.Time
	TextState  string
	Language   string
}

// Open creates or opens the SQLite database in the given directory.
func Open(dataDir string) (*DB, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	dbPath := filepath.Join(dataDir, "okc.db")
	conn, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}

	db := &DB{conn: conn}
	if err := db.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

// Close closes the database connection.
func (db *DB) Close() error {
	return db.conn.Close()
}

func (db *DB) migrate() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS rooms (
			id          TEXT PRIMARY KEY,
			pin         TEXT NOT NULL DEFAULT '',
			created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
			last_active DATETIME NOT NULL DEFAULT (datetime('now')),
			text_state  TEXT NOT NULL DEFAULT '',
			language    TEXT NOT NULL DEFAULT 'de'
		);
		CREATE INDEX IF NOT EXISTS idx_rooms_last_active ON rooms(last_active);
		
		CREATE TABLE IF NOT EXISTS stats (
			key   TEXT PRIMARY KEY,
			value INTEGER NOT NULL DEFAULT 0
		);
		INSERT OR IGNORE INTO stats (key, value) VALUES ('total_rooms_created', 0);
		INSERT OR IGNORE INTO stats (key, value) VALUES ('total_connections', 0);
		
		CREATE TABLE IF NOT EXISTS country_stats (
			country TEXT PRIMARY KEY,
			count   INTEGER NOT NULL DEFAULT 0
		);
	`)
	if err != nil {
		return err
	}
	// Add PIN column if it doesn't exist (migration for existing DBs)
	_, _ = db.conn.Exec(`ALTER TABLE rooms ADD COLUMN pin TEXT NOT NULL DEFAULT ''`)
	return nil
}

// SaveRoom creates or updates a room record.
func (db *DB) SaveRoom(r *RoomRecord) error {
	_, err := db.conn.Exec(`
		INSERT INTO rooms (id, pin, created_at, last_active, text_state, language)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			last_active = excluded.last_active,
			text_state  = excluded.text_state
	`, r.ID, r.PIN, r.CreatedAt, r.LastActive, r.TextState, r.Language)
	return err
}

// GetRoom retrieves a room by ID.
func (db *DB) GetRoom(id string) (*RoomRecord, error) {
	row := db.conn.QueryRow(`SELECT id, pin, created_at, last_active, text_state, language FROM rooms WHERE id = ?`, id)
	r := &RoomRecord{}
	if err := row.Scan(&r.ID, &r.PIN, &r.CreatedAt, &r.LastActive, &r.TextState, &r.Language); err != nil {
		return nil, err
	}
	return r, nil
}

// TouchRoom updates the last_active timestamp.
func (db *DB) TouchRoom(id string) error {
	_, err := db.conn.Exec(`UPDATE rooms SET last_active = datetime('now') WHERE id = ?`, id)
	return err
}

// DeleteStaleRooms removes rooms inactive for longer than the given duration.
func (db *DB) DeleteStaleRooms(maxAge time.Duration) (int64, error) {
	cutoff := time.Now().Add(-maxAge)
	res, err := db.conn.Exec(`DELETE FROM rooms WHERE last_active < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ClearStaleText clears text_state for rooms inactive longer than the given duration.
// The room itself is kept, only the text content is deleted for privacy.
func (db *DB) ClearStaleText(maxAge time.Duration) (int64, error) {
	cutoff := time.Now().Add(-maxAge)
	res, err := db.conn.Exec(`UPDATE rooms SET text_state = '' WHERE last_active < ? AND text_state != ''`, cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// IncrementTotalRooms increments the total rooms created counter.
func (db *DB) IncrementTotalRooms() error {
	_, err := db.conn.Exec(`UPDATE stats SET value = value + 1 WHERE key = 'total_rooms_created'`)
	return err
}

// IncrementTotalConnections increments the all-time connections counter.
func (db *DB) IncrementTotalConnections() error {
	_, err := db.conn.Exec(`UPDATE stats SET value = value + 1 WHERE key = 'total_connections'`)
	return err
}

// IncrementCountry increments the connection count for a country.
func (db *DB) IncrementCountry(country string) error {
	_, err := db.conn.Exec(`
		INSERT INTO country_stats (country, count) VALUES (?, 1)
		ON CONFLICT(country) DO UPDATE SET count = count + 1
	`, country)
	return err
}

// Stats returns statistics from the database.
type Stats struct {
	TotalRoomsCreated    int64
	TotalConnections     int64
	ActiveRooms          int64
	RoomsLast24h         int64
	RoomsLast7d          int64
	CountryStats         map[string]int64
}

func (db *DB) GetStats() (*Stats, error) {
	s := &Stats{
		CountryStats: make(map[string]int64),
	}

	// Total rooms ever created
	row := db.conn.QueryRow(`SELECT value FROM stats WHERE key = 'total_rooms_created'`)
	_ = row.Scan(&s.TotalRoomsCreated)

	// Total connections ever
	row = db.conn.QueryRow(`SELECT value FROM stats WHERE key = 'total_connections'`)
	_ = row.Scan(&s.TotalConnections)

	// Active rooms (currently in DB)
	row = db.conn.QueryRow(`SELECT COUNT(*) FROM rooms`)
	_ = row.Scan(&s.ActiveRooms)

	// Rooms active in last 24h
	row = db.conn.QueryRow(`SELECT COUNT(*) FROM rooms WHERE last_active > datetime('now', '-1 day')`)
	_ = row.Scan(&s.RoomsLast24h)

	// Rooms active in last 7 days
	row = db.conn.QueryRow(`SELECT COUNT(*) FROM rooms WHERE last_active > datetime('now', '-7 days')`)
	_ = row.Scan(&s.RoomsLast7d)

	// Country stats (top 10)
	rows, err := db.conn.Query(`SELECT country, count FROM country_stats ORDER BY count DESC LIMIT 10`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var country string
			var count int64
			if rows.Scan(&country, &count) == nil {
				s.CountryStats[country] = count
			}
		}
	}

	return s, nil
}
