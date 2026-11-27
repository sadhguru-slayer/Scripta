package hub

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	pairAlphabet   = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
	pairCodeLen    = 6
	pairCodeTTL    = 5 * time.Minute
	sendBufferSize = 512
	maxMessageSize = 64 * 1024 // 64 KB per WS frame
)

var (
	ErrInvalidCode  = errors.New("invalid or expired pairing code")
	ErrCodeClaimed  = errors.New("pairing code already claimed")
	ErrSessionGone  = errors.New("session not found")
	ErrUnauthorized = errors.New("invalid role or token")
)

type Role string

const (
	RoleDesktop Role = "desktop"
	RoleMobile  Role = "mobile"
)

type ConnectedDevice struct {
	DeviceID    string `json:"deviceId"`
	Name        string `json:"name"`
	ConnectedAt int64  `json:"connectedAt"`
}

type Client struct {
	role        Role
	deviceID    string
	deviceName  string
	connectedAt int64
	conn        *websocket.Conn
	send        chan []byte
	done        chan struct{}
	once        sync.Once
}

func (c *Client) close() {
	c.once.Do(func() {
		close(c.done)
	})
}

func (c *Client) trySend(data []byte) (sent bool, closed bool) {
	select {
	case <-c.done:
		return false, true
	default:
	}
	select {
	case <-c.done:
		return false, true
	case c.send <- data:
		return true, false
	default:
		return false, false
	}
}

type Session struct {
	ID          string
	PairCode    string
	CodeExpires time.Time
	CodeClaimed bool

	HostToken       string
	MobileToken     string
	QrSecret        string

	mu              sync.Mutex
	desktop         *Client
	mobile          *Client
	aspectRatio     float64
	pendingApproval bool
}

type Hub struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	byCode   map[string]string // pairCode -> sessionID
	log      *slog.Logger
}

func New(log *slog.Logger) *Hub {
	return &Hub{
		sessions: make(map[string]*Session),
		byCode:   make(map[string]string),
		log:      log,
	}
}

type CreateResult struct {
	SessionID string    `json:"sessionId"`
	PairCode  string    `json:"pairCode"`
	HostToken string    `json:"hostToken"`
	QrSecret  string    `json:"qrSecret"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (h *Hub) CreateSession() (CreateResult, error) {
	sessionID, err := randomHex(16)
	if err != nil {
		return CreateResult{}, err
	}
	hostToken, err := randomHex(32)
	if err != nil {
		return CreateResult{}, err
	}
	qrSecret, err := randomHex(16)
	if err != nil {
		return CreateResult{}, err
	}
	code, err := randomPairCode(pairCodeLen)
	if err != nil {
		return CreateResult{}, err
	}

	expires := time.Now().Add(pairCodeTTL)
	sess := &Session{
		ID:          sessionID,
		PairCode:    code,
		CodeExpires: expires,
		HostToken:   hostToken,
		QrSecret:    qrSecret,
	}

	h.mu.Lock()
	// Ensure no collision on active pairCode
	for _, exists := h.byCode[code]; exists; _, exists = h.byCode[code] {
		code, err = randomPairCode(pairCodeLen)
		if err != nil {
			h.mu.Unlock()
			return CreateResult{}, err
		}
		sess.PairCode = code
	}
	h.sessions[sessionID] = sess
	h.byCode[code] = sessionID
	h.mu.Unlock()

	return CreateResult{
		SessionID: sessionID,
		PairCode:  code,
		HostToken: hostToken,
		QrSecret:  qrSecret,
		ExpiresAt: expires,
	}, nil
}

type JoinResult struct {
	SessionID       string `json:"sessionId"`
	MobileToken     string `json:"mobileToken"`
	PendingApproval bool   `json:"pendingApproval"`
}

func (h *Hub) JoinSession(pairCode string, aspectRatio float64) (JoinResult, error) {
	return h.joinSession(pairCode, aspectRatio, false, "")
}

func (h *Hub) JoinSessionWithSecret(pairCode string, aspectRatio float64, qrSecret string) (JoinResult, error) {
	return h.joinSession(pairCode, aspectRatio, true, qrSecret)
}

func (h *Hub) joinSession(pairCode string, aspectRatio float64, checkSecret bool, qrSecret string) (JoinResult, error) {
	h.mu.RLock()
	sessionID, ok := h.byCode[pairCode]
	sess := h.sessions[sessionID]
	h.mu.RUnlock()

	if !ok || sess == nil {
		return JoinResult{}, ErrInvalidCode
	}

	mobileToken, err := randomHex(32)
	if err != nil {
		return JoinResult{}, err
	}

	sess.mu.Lock()
	if time.Now().After(sess.CodeExpires) {
		sess.mu.Unlock()
		return JoinResult{}, ErrInvalidCode
	}
	if sess.CodeClaimed {
		sess.mu.Unlock()
		return JoinResult{}, ErrCodeClaimed
	}
	sess.CodeClaimed = true
	sess.MobileToken = mobileToken
	if aspectRatio > 0.1 {
		sess.aspectRatio = aspectRatio
	}
	needsApproval := false
	if checkSecret {
		needsApproval = qrSecret == "" || subtle.ConstantTimeCompare([]byte(qrSecret), []byte(sess.QrSecret)) != 1
	}
	sess.pendingApproval = needsApproval
	sess.mu.Unlock()

	return JoinResult{
		SessionID:       sess.ID,
		MobileToken:     mobileToken,
		PendingApproval: needsApproval,
	}, nil
}

// ServeWS authenticates the client, attaches it to the session, and blocks until the connection closes.
func (h *Hub) ServeWS(ctx context.Context, sessionID string, role Role, token string, conn *websocket.Conn) error {
	return h.ServeWSWithDevice(ctx, sessionID, role, token, "", "", conn)
}

// ServeWSWithDevice authenticates the client with optional device metadata and blocks until closed.
func (h *Hub) ServeWSWithDevice(ctx context.Context, sessionID string, role Role, token, deviceID, deviceName string, conn *websocket.Conn) error {
	h.mu.RLock()
	sess := h.sessions[sessionID]
	h.mu.RUnlock()
	if sess == nil {
		return ErrSessionGone
	}

	sess.mu.Lock()
	var expected string
	switch role {
	case RoleDesktop:
		expected = sess.HostToken
	case RoleMobile:
		expected = sess.MobileToken
	default:
		sess.mu.Unlock()
		return ErrUnauthorized
	}

	if expected == "" || subtle.ConstantTimeCompare([]byte(token), []byte(expected)) != 1 {
		sess.mu.Unlock()
		return ErrUnauthorized
	}

	if role == RoleMobile {
		if deviceID == "" {
			deviceID = "phone-1"
		}
		if deviceName == "" {
			deviceName = "Phone"
		}
	}

	client := &Client{
		role:        role,
		deviceID:    deviceID,
		deviceName:  deviceName,
		connectedAt: time.Now().UnixMilli(),
		conn:        conn,
		send:        make(chan []byte, sendBufferSize),
		done:        make(chan struct{}),
	}

	var oldClient *Client
	var peer *Client
	var desktopClient *Client
	var aspect float64
	if role == RoleDesktop {
		oldClient = sess.desktop
		sess.desktop = client
		desktopClient = client
		peer = sess.mobile
		aspect = sess.aspectRatio
	} else {
		oldClient = sess.mobile
		sess.mobile = client
		peer = sess.desktop
		desktopClient = sess.desktop
		aspect = sess.aspectRatio
	}
	devices := connectedDevicesLocked(sess)
	pendingApproval := sess.pendingApproval
	sess.mu.Unlock()

	if oldClient != nil {
		oldClient.close()
	}

	conn.SetReadLimit(maxMessageSize)

	// Send session.ready to this client
	h.enqueueControl(client, "session.ready", map[string]any{"role": role})

	if pendingApproval {
		if role == RoleMobile {
			h.enqueueControl(client, "session.pending", map[string]any{"deviceId": deviceID, "deviceName": deviceName})
			if desktopClient != nil {
				h.enqueueControl(desktopClient, "session.pending", map[string]any{"deviceId": deviceID, "deviceName": deviceName})
			}
		} else if peer != nil {
			h.enqueueControl(client, "session.pending", map[string]any{"deviceId": peer.deviceID, "deviceName": peer.deviceName})
		}
	} else {
		if desktopClient != nil {
			h.enqueueControl(desktopClient, "session.devices", map[string]any{"devices": devices})
		}

		// Notify both peers if both are present
		if peer != nil {
			if role == RoleMobile {
				h.enqueueControl(peer, "peer.connected", map[string]any{
					"role": RoleMobile, "aspectRatio": aspect, "deviceId": deviceID, "deviceName": deviceName,
				})
				h.enqueueControl(client, "peer.connected", map[string]any{"role": RoleDesktop})
			} else {
				h.enqueueControl(peer, "peer.connected", map[string]any{"role": RoleDesktop})
				h.enqueueControl(client, "peer.connected", map[string]any{
					"role": RoleMobile, "aspectRatio": aspect, "deviceId": peer.deviceID, "deviceName": peer.deviceName,
				})
			}
		}
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	go h.writePump(ctx, client)
	h.readPump(ctx, sess, client)

	// Cleanup on disconnect
	client.close()
	sess.mu.Lock()
	var remainingPeer *Client
	if role == RoleDesktop && sess.desktop == client {
		sess.desktop = nil
		remainingPeer = sess.mobile
	} else if role == RoleMobile && sess.mobile == client {
		sess.mobile = nil
		remainingPeer = sess.desktop
	}
	devicesAfter := connectedDevicesLocked(sess)
	desktopAfter := sess.desktop
	sess.mu.Unlock()

	if remainingPeer != nil {
		h.enqueueControl(remainingPeer, "peer.disconnected", map[string]any{"role": role, "deviceId": deviceID})
	}
	if desktopAfter != nil {
		h.enqueueControl(desktopAfter, "session.devices", map[string]any{"devices": devicesAfter})
	}
	return nil
}

// ApproveDevice approves or denies a pending mobile connection.
func (h *Hub) ApproveDevice(sessionID, deviceID string, allow bool) bool {
	h.mu.RLock()
	sess := h.sessions[sessionID]
	h.mu.RUnlock()
	if sess == nil {
		return false
	}

	sess.mu.Lock()
	m := sess.mobile
	d := sess.desktop
	if m == nil || (deviceID != "" && m.deviceID != deviceID) {
		sess.mu.Unlock()
		return false
	}
	if !allow {
		sess.mobile = nil
		sess.MobileToken = ""
		sess.pendingApproval = false
		sess.mu.Unlock()
		h.enqueueControl(m, "session.denied", map[string]any{"reason": "Connection denied by desktop"})
		go func() {
			time.Sleep(50 * time.Millisecond)
			m.close()
		}()
		return true
	}

	sess.pendingApproval = false
	aspect := sess.aspectRatio
	devices := connectedDevicesLocked(sess)
	sess.mu.Unlock()

	h.enqueueControl(m, "session.approved", map[string]any{"deviceId": m.deviceID})
	if d != nil {
		h.enqueueControl(d, "session.devices", map[string]any{"devices": devices})
		h.enqueueControl(d, "peer.connected", map[string]any{
			"role": RoleMobile, "aspectRatio": aspect, "deviceId": m.deviceID, "deviceName": m.deviceName,
		})
		h.enqueueControl(m, "peer.connected", map[string]any{"role": RoleDesktop})
	}
	return true
}

// KickDevice disconnects a mobile device from the session by deviceId.
func (h *Hub) KickDevice(sessionID, deviceID string) bool {
	h.mu.RLock()
	sess := h.sessions[sessionID]
	h.mu.RUnlock()
	if sess == nil {
		return false
	}

	sess.mu.Lock()
	m := sess.mobile
	if m == nil || (deviceID != "" && m.deviceID != deviceID) {
		sess.mu.Unlock()
		return false
	}
	sess.mobile = nil
	desktop := sess.desktop
	devices := connectedDevicesLocked(sess)
	sess.mu.Unlock()

	h.enqueueControl(m, "session.kicked", map[string]any{"reason": "Disconnected by desktop"})
	go func() {
		time.Sleep(50 * time.Millisecond)
		m.close()
	}()
	if desktop != nil {
		h.enqueueControl(desktop, "peer.disconnected", map[string]any{"role": RoleMobile, "deviceId": m.deviceID})
		h.enqueueControl(desktop, "session.devices", map[string]any{"devices": devices})
	}
	return true
}

func connectedDevicesLocked(sess *Session) []ConnectedDevice {
	if sess.mobile == nil {
		return []ConnectedDevice{}
	}
	return []ConnectedDevice{{
		DeviceID:    sess.mobile.deviceID,
		Name:        sess.mobile.deviceName,
		ConnectedAt: sess.mobile.connectedAt,
	}}
}

func (h *Hub) readPump(ctx context.Context, sess *Session, client *Client) {
	for {
		msgType, data, err := client.conn.Read(ctx)
		if err != nil {
			return
		}
		if msgType != websocket.MessageText {
			continue
		}

		sess.mu.Lock()
		if client.role == RoleMobile && sess.pendingApproval {
			sess.mu.Unlock()
			continue
		}
		var target *Client
		if client.role == RoleDesktop {
			target = sess.mobile
		} else {
			target = sess.desktop
		}
		sess.mu.Unlock()

		if target == nil {
			continue
		}

		if sent, closed := target.trySend(data); !sent && !closed {
			// Drop burst if slow consumer rather than blocking the sender
			h.log.Warn("dropping ws frame due to full send buffer", "targetRole", target.role)
		}
	}
}

func (h *Hub) writePump(ctx context.Context, client *Client) {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-client.done:
			_ = client.conn.Close(websocket.StatusNormalClosure, "replaced or closed")
			return
		case msg := <-client.send:
			wCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := client.conn.Write(wCtx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-ticker.C:
			pCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := client.conn.Ping(pCtx)
			cancel()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func (h *Hub) enqueueControl(target *Client, msgType string, payload any) {
	raw, err := json.Marshal(map[string]any{
		"v":       1,
		"type":    msgType,
		"seq":     0,
		"ts":      time.Now().UnixMilli(),
		"payload": payload,
	})
	if err != nil {
		return
	}
	target.trySend(raw)
}

func randomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func randomPairCode(length int) (string, error) {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, length)
	for i := range b {
		out[i] = pairAlphabet[int(b[i])%len(pairAlphabet)]
	}
	return string(out), nil
}
