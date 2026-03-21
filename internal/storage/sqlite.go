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
			created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
			last_active DATETIME NOT NULL DEFAULT (datetime('now')),
			text_state  TEXT NOT NULL DEFAULT '',
			language    TEXT NOT NULL DEFAULT 'de'
		);
		CREATE INDEX IF NOT EXISTS idx_rooms_last_active ON rooms(last_active);
	`)
	return err
}

// SaveRoom creates or updates a room record.
func (db *DB) SaveRoom(r *RoomRecord) error {
	_, err := db.conn.Exec(`
		INSERT INTO rooms (id, created_at, last_active, text_state, language)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			last_active = excluded.last_active,
			text_state  = excluded.text_state
	`, r.ID, r.CreatedAt, r.LastActive, r.TextState, r.Language)
	return err
}

// GetRoom retrieves a room by ID.
func (db *DB) GetRoom(id string) (*RoomRecord, error) {
	row := db.conn.QueryRow(`SELECT id, created_at, last_active, text_state, language FROM rooms WHERE id = ?`, id)
	r := &RoomRecord{}
	if err := row.Scan(&r.ID, &r.CreatedAt, &r.LastActive, &r.TextState, &r.Language); err != nil {
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
