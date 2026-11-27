package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"

	"github.com/coder/websocket"

	"scripta/backend/internal/hub"
	"scripta/backend/internal/store"
)

type Server struct {
	hub   *hub.Hub
	store *store.Store
	log   *slog.Logger
}

func NewServer(h *hub.Hub, st *store.Store, log *slog.Logger) http.Handler {
	s := &Server{hub: h, store: st, log: log}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/network-info", s.handleNetworkInfo)
	mux.HandleFunc("POST /api/pair/create", s.handlePairCreate)
	mux.HandleFunc("POST /api/pair/join", s.handlePairJoin)
	mux.HandleFunc("POST /api/sessions/{sessionId}/devices/{deviceId}/approve", s.handleApproveDevice)
	mux.HandleFunc("POST /api/sessions/{sessionId}/devices/{deviceId}/kick", s.handleKickDevice)
	mux.HandleFunc("GET /api/notebooks", s.handleListNotebooks)
	mux.HandleFunc("POST /api/notebooks", s.handleCreateNotebook)
	mux.HandleFunc("PATCH /api/notebooks/{id}", s.handleRenameNotebook)
	mux.HandleFunc("DELETE /api/notebooks/{id}", s.handleDeleteNotebook)
	mux.HandleFunc("POST /api/notebooks/{id}/pages", s.handleCreatePage)
	mux.HandleFunc("GET /api/pages/{id}", s.handleGetPage)
	mux.HandleFunc("PUT /api/pages/{id}", s.handleSavePage)
	mux.HandleFunc("PATCH /api/pages/{id}", s.handleRenamePage)
	mux.HandleFunc("DELETE /api/pages/{id}", s.handleDeletePage)
	mux.HandleFunc("GET /ws", s.handleWS)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleNetworkInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"lanIp": detectLanIP()})
}

func (s *Server) handlePairCreate(w http.ResponseWriter, _ *http.Request) {
	res, err := s.hub.CreateSession()
	if err != nil {
		s.log.Error("failed to create session", "err", err)
		writeError(w, http.StatusInternalServerError, "could not create pairing session")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handlePairJoin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PairCode    string  `json:"pairCode"`
		AspectRatio float64 `json:"aspectRatio"`
		QrSecret    string  `json:"qrSecret"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	code := strings.ToUpper(strings.TrimSpace(body.PairCode))
	res, err := s.hub.JoinSessionWithSecret(code, body.AspectRatio, strings.TrimSpace(body.QrSecret))
	if err != nil {
		switch {
		case errors.Is(err, hub.ErrInvalidCode):
			writeError(w, http.StatusNotFound, err.Error())
		case errors.Is(err, hub.ErrCodeClaimed):
			writeError(w, http.StatusConflict, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "join failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sessionID := q.Get("sessionId")
	role := hub.Role(q.Get("role"))
	token := q.Get("token")
	deviceID := q.Get("deviceId")
	deviceName := q.Get("deviceName")

	if sessionID == "" || token == "" || (role != hub.RoleDesktop && role != hub.RoleMobile) {
		writeError(w, http.StatusBadRequest, "missing sessionId, role, or token")
		return
	}

	// Note: In production, restrict OriginPatterns to configured domain.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		s.log.Warn("ws accept failed", "err", err)
		return
	}

	if err := s.hub.ServeWSWithDevice(r.Context(), sessionID, role, token, deviceID, deviceName, conn); err != nil {
		if errors.Is(err, hub.ErrSessionGone) || errors.Is(err, hub.ErrUnauthorized) {
			_ = conn.Close(websocket.StatusPolicyViolation, err.Error())
		} else {
			_ = conn.Close(websocket.StatusInternalError, "session closed")
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func detectLanIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "localhost"
	}
	defer conn.Close()
	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok {
		return "localhost"
	}
	return addr.IP.String()
}

func (s *Server) handleApproveDevice(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionId")
	deviceID := r.PathValue("deviceId")
	var body struct {
		Allow bool `json:"allow"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if !s.hub.ApproveDevice(sessionID, deviceID, body.Allow) {
		writeError(w, http.StatusNotFound, "device or session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleKickDevice(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("sessionId")
	deviceID := r.PathValue("deviceId")
	if !s.hub.KickDevice(sessionID, deviceID) {
		writeError(w, http.StatusNotFound, "device or session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleListNotebooks(w http.ResponseWriter, _ *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	nbs, err := s.store.ListNotebooks()
	if err != nil {
		s.log.Error("list notebooks failed", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list notebooks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notebooks": nbs})
}

func (s *Server) handleCreateNotebook(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
	nb, err := s.store.CreateNotebook(strings.TrimSpace(body.Title))
	if err != nil {
		s.log.Error("create notebook failed", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to create notebook")
		return
	}
	writeJSON(w, http.StatusCreated, nb)
}

func (s *Server) handleRenameNotebook(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	title := strings.TrimSpace(body.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	err := s.store.RenameNotebook(r.PathValue("id"), title)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "notebook not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to rename notebook")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "title": title})
}

func (s *Server) handleDeleteNotebook(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	err := s.store.DeleteNotebook(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "notebook not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete notebook")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleCreatePage(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
	pg, err := s.store.CreatePage(r.PathValue("id"), strings.TrimSpace(body.Title))
	if err != nil {
		s.log.Error("create page failed", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to create page")
		return
	}
	writeJSON(w, http.StatusCreated, pg)
}

func (s *Server) handleGetPage(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	pg, err := s.store.GetPage(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		s.log.Error("get page failed", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to load page")
		return
	}
	writeJSON(w, http.StatusOK, pg)
}

func (s *Server) handleRenamePage(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	title := strings.TrimSpace(body.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	err := s.store.RenamePage(r.PathValue("id"), title)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to rename page")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "title": title})
}

func (s *Server) handleSavePage(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	var body struct {
		Title    string            `json:"title"`
		BgType   string            `json:"bgType"`
		Camera   json.RawMessage   `json:"camera"`
		Elements []json.RawMessage `json:"elements"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024*1024)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid page payload")
		return
	}
	err := s.store.SavePage(r.PathValue("id"), strings.TrimSpace(body.Title), body.BgType, body.Camera, body.Elements)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		s.log.Error("save page failed", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to save page")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeletePage(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	err := s.store.DeletePage(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete page")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
