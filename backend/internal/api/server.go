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
)

type Server struct {
	hub *hub.Hub
	log *slog.Logger
}

func NewServer(h *hub.Hub, log *slog.Logger) http.Handler {
	s := &Server{hub: h, log: log}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/network-info", s.handleNetworkInfo)
	mux.HandleFunc("POST /api/pair/create", s.handlePairCreate)
	mux.HandleFunc("POST /api/pair/join", s.handlePairJoin)
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
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	code := strings.ToUpper(strings.TrimSpace(body.PairCode))
	res, err := s.hub.JoinSession(code, body.AspectRatio)
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

	if err := s.hub.ServeWS(r.Context(), sessionID, role, token, conn); err != nil {
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
