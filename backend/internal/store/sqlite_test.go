package store

import (
	"encoding/json"
	"testing"
)

func TestStoreNotebookPageLifecycle(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer s.Close()

	// ListNotebooks auto-creates default notebook + Page 1
	nbs, err := s.ListNotebooks()
	if err != nil {
		t.Fatalf("ListNotebooks failed: %v", err)
	}
	if len(nbs) != 1 || len(nbs[0].Pages) != 1 {
		t.Fatalf("expected 1 default notebook with 1 page, got %+v", nbs)
	}

	pageID := nbs[0].Pages[0].ID
	el := json.RawMessage(`{"id":"s1","kind":"stroke","deviceId":"dev_1","createdAt":1000}`)
	cam := json.RawMessage(`{"x":10,"y":20,"zoom":1.5}`)
	if err := s.SavePage(pageID, "Lecture 1", "grid", cam, []json.RawMessage{el}); err != nil {
		t.Fatalf("SavePage failed: %v", err)
	}

	detail, err := s.GetPage(pageID)
	if err != nil {
		t.Fatalf("GetPage failed: %v", err)
	}
	if detail.Title != "Lecture 1" || detail.BgType != "grid" || len(detail.Elements) != 1 {
		t.Fatalf("unexpected page detail: %+v", detail)
	}

	p2, err := s.CreatePage(nbs[0].ID, "Lecture 2")
	if err != nil {
		t.Fatalf("CreatePage failed: %v", err)
	}
	if p2.SortOrder != 1 {
		t.Fatalf("expected sortOrder 1, got %d", p2.SortOrder)
	}

	if err := s.DeletePage(p2.ID); err != nil {
		t.Fatalf("DeletePage failed: %v", err)
	}
}
