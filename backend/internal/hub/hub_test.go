package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func newTestHub() *Hub {
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestPairingSingleUse(t *testing.T) {
	h := newTestHub()
	created, err := h.CreateSession()
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	if len(created.PairCode) != pairCodeLen {
		t.Fatalf("expected pair code len %d, got %d", pairCodeLen, len(created.PairCode))
	}

	joined, err := h.JoinSession(created.PairCode, 0.5)
	if err != nil {
		t.Fatalf("JoinSession failed: %v", err)
	}
	if joined.SessionID != created.SessionID || joined.MobileToken == "" {
		t.Fatalf("unexpected join result: %+v", joined)
	}

	// Second join with same code must fail
	if _, err := h.JoinSession(created.PairCode, 0.5); err != ErrCodeClaimed {
		t.Fatalf("expected ErrCodeClaimed, got %v", err)
	}
}

func TestWSRelayDesktopAndMobile(t *testing.T) {
	h := newTestHub()
	created, err := h.CreateSession()
	if err != nil {
		t.Fatal(err)
	}
	joined, err := h.JoinSession(created.PairCode, 0.5625)
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			t.Errorf("accept failed: %v", err)
			return
		}
		q := r.URL.Query()
		_ = h.ServeWS(r.Context(), q.Get("sessionId"), Role(q.Get("role")), q.Get("token"), conn)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dConn, _, err := websocket.Dial(ctx, wsURL+"?sessionId="+created.SessionID+"&role=desktop&token="+created.HostToken, nil)
	if err != nil {
		t.Fatalf("desktop dial failed: %v", err)
	}
	defer dConn.Close(websocket.StatusNormalClosure, "")

	mConn, _, err := websocket.Dial(ctx, wsURL+"?sessionId="+joined.SessionID+"&role=mobile&token="+joined.MobileToken, nil)
	if err != nil {
		t.Fatalf("mobile dial failed: %v", err)
	}
	defer mConn.Close(websocket.StatusNormalClosure, "")

	// Drain initial control messages on desktop until peer.connected
	for {
		_, data, err := dConn.Read(ctx)
		if err != nil {
			t.Fatalf("desktop read failed: %v", err)
		}
		var env struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &env); err == nil && env.Type == "peer.connected" {
			break
		}
	}

	// Mobile sends stroke.start -> Desktop must receive it intact
	sample := `{"v":1,"type":"stroke.start","seq":1,"ts":100,"payload":{"strokeId":"s1"}}`
	if err := mConn.Write(ctx, websocket.MessageText, []byte(sample)); err != nil {
		t.Fatalf("mobile write failed: %v", err)
	}

	_, got, err := dConn.Read(ctx)
	if err != nil {
		t.Fatalf("desktop read stroke failed: %v", err)
	}
	if string(got) != sample {
		t.Fatalf("expected %s, got %s", sample, string(got))
	}
}

func TestWSBurstRelayNoDrops(t *testing.T) {
	h := newTestHub()
	created, err := h.CreateSession()
	if err != nil {
		t.Fatal(err)
	}
	joined, err := h.JoinSession(created.PairCode, 0.5625)
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		q := r.URL.Query()
		_ = h.ServeWS(r.Context(), q.Get("sessionId"), Role(q.Get("role")), q.Get("token"), conn)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dConn, _, err := websocket.Dial(ctx, wsURL+"?sessionId="+created.SessionID+"&role=desktop&token="+created.HostToken, nil)
	if err != nil {
		t.Fatalf("desktop dial failed: %v", err)
	}
	defer dConn.Close(websocket.StatusNormalClosure, "")

	mConn, _, err := websocket.Dial(ctx, wsURL+"?sessionId="+joined.SessionID+"&role=mobile&token="+joined.MobileToken, nil)
	if err != nil {
		t.Fatalf("mobile dial failed: %v", err)
	}
	defer mConn.Close(websocket.StatusNormalClosure, "")

	for {
		_, data, err := dConn.Read(ctx)
		if err != nil {
			t.Fatalf("desktop read failed: %v", err)
		}
		var env struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &env); err == nil && env.Type == "peer.connected" {
			break
		}
	}

	const totalFrames = 550
	errCh := make(chan error, 1)
	go func() {
		for i := 0; i < totalFrames; i++ {
			msg := fmt.Sprintf(`{"v":1,"type":"stroke.points","seq":%d,"ts":%d,"payload":{"strokeId":"burst","points":[{"x":0.5,"y":0.5,"p":0.5,"dt":%d}]}}`, i+1, i+1000, i)
			if err := mConn.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
				errCh <- err
				return
			}
		}
		errCh <- nil
	}()

	for i := 0; i < totalFrames; i++ {
		_, data, err := dConn.Read(ctx)
		if err != nil {
			t.Fatalf("desktop read frame %d failed: %v", i, err)
		}
		var env struct {
			Seq int `json:"seq"`
		}
		if err := json.Unmarshal(data, &env); err != nil {
			t.Fatalf("unmarshal frame %d failed: %v", i, err)
		}
		if env.Seq != i+1 {
			t.Fatalf("expected seq %d, got %d (dropped or out-of-order)", i+1, env.Seq)
		}
	}

	if writeErr := <-errCh; writeErr != nil {
		t.Fatalf("mobile burst write failed: %v", writeErr)
	}
}

func TestWSConcurrentDisconnectAndReconnectNoPanic(t *testing.T) {
	h := newTestHub()
	created, err := h.CreateSession()
	if err != nil {
		t.Fatal(err)
	}
	joined, err := h.JoinSession(created.PairCode, 0.5625)
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		q := r.URL.Query()
		_ = h.ServeWS(r.Context(), q.Get("sessionId"), Role(q.Get("role")), q.Get("token"), conn)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	mConn, _, err := websocket.Dial(ctx, wsURL+"?sessionId="+joined.SessionID+"&role=mobile&token="+joined.MobileToken, nil)
	if err != nil {
		t.Fatalf("mobile dial failed: %v", err)
	}
	defer mConn.Close(websocket.StatusNormalClosure, "")

	var wg sync.WaitGroup
	stopStream := make(chan struct{})

	// Rapidly stream from mobile while desktop repeatedly replaces/disconnects
	wg.Add(1)
	go func() {
		defer wg.Done()
		seq := 0
		for {
			select {
			case <-stopStream:
				return
			default:
				seq++
				msg := fmt.Sprintf(`{"v":1,"type":"stroke.points","seq":%d,"ts":100,"payload":{"strokeId":"s","points":[{"x":0.2,"y":0.3,"p":0.5,"dt":1}]}}`, seq)
				_ = mConn.Write(ctx, websocket.MessageText, []byte(msg))
			}
		}
	}()

	for i := 0; i < 12; i++ {
		dConn, _, err := websocket.Dial(ctx, wsURL+"?sessionId="+created.SessionID+"&role=desktop&token="+created.HostToken, nil)
		if err != nil {
			t.Fatalf("desktop reconnect %d failed: %v", i, err)
		}
		time.Sleep(15 * time.Millisecond)
		if i%2 == 0 {
			_ = dConn.Close(websocket.StatusNormalClosure, "bye")
		} else {
			// Leave open briefly so the next dial triggers oldClient.close() replacement
			go func(c *websocket.Conn) {
				time.Sleep(30 * time.Millisecond)
				_ = c.Close(websocket.StatusNormalClosure, "cleanup")
			}(dConn)
		}
	}

	close(stopStream)
	wg.Wait()
}
