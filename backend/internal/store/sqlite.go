package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	db *sql.DB
}

type PageSummary struct {
	ID         string `json:"id"`
	NotebookID string `json:"notebookId"`
	Title      string `json:"title"`
	SortOrder  int    `json:"sortOrder"`
	BgType     string `json:"bgType"`
	UpdatedAt  int64  `json:"updatedAt"`
}

type NotebookSummary struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	CreatedAt int64         `json:"createdAt"`
	UpdatedAt int64         `json:"updatedAt"`
	Pages     []PageSummary `json:"pages"`
}

type PageDetail struct {
	ID         string            `json:"id"`
	NotebookID string            `json:"notebookId"`
	Title      string            `json:"title"`
	BgType     string            `json:"bgType"`
	Camera     json.RawMessage   `json:"camera"`
	Elements   []json.RawMessage `json:"elements"`
	UpdatedAt  int64             `json:"updatedAt"`
}

type ElementInput struct {
	ID        string          `json:"id"`
	DeviceID  string          `json:"deviceId,omitempty"`
	CreatedAt int64           `json:"createdAt"`
	Raw       json.RawMessage `json:"-"`
}

func Open(dbPath string) (*Store, error) {
	if dbPath != ":memory:" {
		if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("mkdir db dir: %w", err)
			}
		}
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	// Single connection keeps SQLite memory footprint minimal and avoids write lock contention.
	db.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA cache_size = -2000;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA foreign_keys = ON;",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("exec %s: %w", p, err)
		}
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  bg_type TEXT NOT NULL DEFAULT 'dots',
  camera_json TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS elements (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  device_id TEXT,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pages_notebook ON pages(notebook_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_elements_page ON elements(page_id, created_at);
`
	_, err := s.db.Exec(schema)
	return err
}

func (s *Store) ListNotebooks() ([]NotebookSummary, error) {
	rows, err := s.db.Query(`SELECT id, title, created_at, updated_at FROM notebooks ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	var list []NotebookSummary
	byID := make(map[string]int)
	for rows.Next() {
		var nb NotebookSummary
		if err := rows.Scan(&nb.ID, &nb.Title, &nb.CreatedAt, &nb.UpdatedAt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		nb.Pages = []PageSummary{}
		byID[nb.ID] = len(list)
		list = append(list, nb)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	if len(list) == 0 {
		nb, err := s.CreateNotebook("My Notebook")
		if err != nil {
			return nil, err
		}
		return []NotebookSummary{nb}, nil
	}

	pRows, err := s.db.Query(`SELECT id, notebook_id, title, sort_order, bg_type, updated_at FROM pages ORDER BY sort_order ASC, updated_at ASC`)
	if err != nil {
		return nil, err
	}
	defer pRows.Close()
	for pRows.Next() {
		var p PageSummary
		if err := pRows.Scan(&p.ID, &p.NotebookID, &p.Title, &p.SortOrder, &p.BgType, &p.UpdatedAt); err != nil {
			return nil, err
		}
		if idx, ok := byID[p.NotebookID]; ok {
			list[idx].Pages = append(list[idx].Pages, p)
		}
	}
	return list, pRows.Err()
}

func (s *Store) CreateNotebook(title string) (NotebookSummary, error) {
	if title == "" {
		title = "Untitled Notebook"
	}
	now := time.Now().UnixMilli()
	nbID := newID("nb")
	pageID := newID("pg")

	tx, err := s.db.Begin()
	if err != nil {
		return NotebookSummary{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(
		`INSERT INTO notebooks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		nbID, title, now, now,
	); err != nil {
		return NotebookSummary{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO pages (id, notebook_id, title, sort_order, bg_type, camera_json, updated_at) VALUES (?, ?, ?, 0, 'dots', '{"x":0,"y":0,"zoom":1}', ?)`,
		pageID, nbID, "Page 1", now,
	); err != nil {
		return NotebookSummary{}, err
	}
	if err := tx.Commit(); err != nil {
		return NotebookSummary{}, err
	}

	return NotebookSummary{
		ID:        nbID,
		Title:     title,
		CreatedAt: now,
		UpdatedAt: now,
		Pages: []PageSummary{
			{ID: pageID, NotebookID: nbID, Title: "Page 1", SortOrder: 0, BgType: "dots", UpdatedAt: now},
		},
	}, nil
}

func (s *Store) DeleteNotebook(id string) error {
	res, err := s.db.Exec(`DELETE FROM notebooks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CreatePage(notebookID, title string) (PageSummary, error) {
	now := time.Now().UnixMilli()
	var maxOrder sql.NullInt64
	if err := s.db.QueryRow(`SELECT MAX(sort_order) FROM pages WHERE notebook_id = ?`, notebookID).Scan(&maxOrder); err != nil {
		return PageSummary{}, err
	}
	nextOrder := 0
	if maxOrder.Valid {
		nextOrder = int(maxOrder.Int64) + 1
	}
	if title == "" {
		title = fmt.Sprintf("Page %d", nextOrder+1)
	}
	pageID := newID("pg")
	if _, err := s.db.Exec(
		`INSERT INTO pages (id, notebook_id, title, sort_order, bg_type, camera_json, updated_at) VALUES (?, ?, ?, ?, 'dots', '{"x":0,"y":0,"zoom":1}', ?)`,
		pageID, notebookID, title, nextOrder, now,
	); err != nil {
		return PageSummary{}, err
	}
	_, _ = s.db.Exec(`UPDATE notebooks SET updated_at = ? WHERE id = ?`, now, notebookID)
	return PageSummary{
		ID:         pageID,
		NotebookID: notebookID,
		Title:      title,
		SortOrder:  nextOrder,
		BgType:     "dots",
		UpdatedAt:  now,
	}, nil
}

func (s *Store) DeletePage(id string) error {
	res, err := s.db.Exec(`DELETE FROM pages WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetPage(id string) (PageDetail, error) {
	var p PageDetail
	var camStr string
	err := s.db.QueryRow(
		`SELECT id, notebook_id, title, bg_type, camera_json, updated_at FROM pages WHERE id = ?`,
		id,
	).Scan(&p.ID, &p.NotebookID, &p.Title, &p.BgType, &camStr, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PageDetail{}, ErrNotFound
	}
	if err != nil {
		return PageDetail{}, err
	}
	p.Camera = json.RawMessage(camStr)
	p.Elements = []json.RawMessage{}

	rows, err := s.db.Query(`SELECT data_json FROM elements WHERE page_id = ? ORDER BY created_at ASC`, id)
	if err != nil {
		return PageDetail{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return PageDetail{}, err
		}
		p.Elements = append(p.Elements, json.RawMessage(raw))
	}
	return p, rows.Err()
}

func (s *Store) SavePage(id, title, bgType string, camera json.RawMessage, elements []json.RawMessage) error {
	now := time.Now().UnixMilli()
	if bgType == "" {
		bgType = "dots"
	}
	if len(camera) == 0 {
		camera = json.RawMessage(`{"x":0,"y":0,"zoom":1}`)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var res sql.Result
	if title != "" {
		res, err = tx.Exec(
			`UPDATE pages SET title = ?, bg_type = ?, camera_json = ?, updated_at = ? WHERE id = ?`,
			title, bgType, string(camera), now, id,
		)
	} else {
		res, err = tx.Exec(
			`UPDATE pages SET bg_type = ?, camera_json = ?, updated_at = ? WHERE id = ?`,
			bgType, string(camera), now, id,
		)
	}
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}

	if _, err := tx.Exec(`DELETE FROM elements WHERE page_id = ?`, id); err != nil {
		return err
	}

	if len(elements) > 0 {
		stmt, err := tx.Prepare(`INSERT INTO elements (id, page_id, device_id, data_json, created_at) VALUES (?, ?, ?, ?, ?)`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for i, raw := range elements {
			var meta struct {
				ID        string `json:"id"`
				DeviceID  string `json:"deviceId"`
				CreatedAt int64  `json:"createdAt"`
			}
			_ = json.Unmarshal(raw, &meta)
			if meta.ID == "" {
				meta.ID = fmt.Sprintf("el_%d_%d", now, i)
			}
			if meta.CreatedAt == 0 {
				meta.CreatedAt = now + int64(i)
			}
			if _, err := stmt.Exec(meta.ID, id, meta.DeviceID, string(raw), meta.CreatedAt); err != nil {
				return err
			}
		}
	}

	_, _ = tx.Exec(`UPDATE notebooks SET updated_at = ? WHERE id = (SELECT notebook_id FROM pages WHERE id = ?)`, now, id)
	return tx.Commit()
}

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}
