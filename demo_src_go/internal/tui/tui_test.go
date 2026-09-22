package tui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gdamore/tcell/v2"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/engine"
	"secretary_go_demo/internal/transport"
)

func syncUI(t *testing.T, u *UI, fn func()) {
	t.Helper()
	done := make(chan struct{})
	u.post(func() { fn(); close(done) })
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("terminal event loop stalled")
	}
}
func waitUI(t *testing.T, u *UI, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		ok := false
		syncUI(t, u, func() { ok = condition() })
		if ok {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("terminal condition timed out")
}
func startUI(t *testing.T, c *Client) (*UI, tcell.SimulationScreen) {
	t.Helper()
	u := New(c)
	screen := tcell.NewSimulationScreen("UTF-8")
	u.app.SetScreen(screen)
	screen.SetSize(120, 36)
	done := make(chan error, 1)
	go func() { done <- u.Run() }()
	t.Cleanup(func() {
		u.cancel()
		u.app.Stop()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(5 * time.Second):
			t.Error("TUI did not stop")
		}
	})
	return u, screen
}
func key(u *UI, k tcell.Key) { u.app.QueueEvent(tcell.NewEventKey(k, 0, tcell.ModNone)) }
func confirmKeyboard(u *UI)  { key(u, tcell.KeyTab); key(u, tcell.KeyTab); key(u, tcell.KeyEnter) }
func capture(t *testing.T, u *UI, screen tcell.SimulationScreen, name string) string {
	t.Helper()
	var text string
	syncUI(t, u, func() {
		u.app.ForceDraw()
		w, h := screen.Size()
		var out strings.Builder
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				r, combining, _, width := screen.GetContent(x, y)
				if r == 0 {
					r = ' '
				}
				out.WriteRune(r)
				out.WriteString(string(combining))
				if width > 1 {
					x += width - 1
				}
			}
			out.WriteByte('\n')
		}
		text = out.String()
	})
	if dir := os.Getenv("TUI_REPORT_DIR"); dir != "" {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name+".txt"), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return text
}

type syntheticModel struct{}

func (syntheticModel) Complete(context.Context, []byte, string) ([]byte, error) {
	return d.Bytes(d.R{"status": "completed", "output": []any{d.R{"type": "message", "content": []any{d.R{"type": "output_text", "text": "合成验收已收到。"}}}}}), nil
}
func actualClient(t *testing.T) (*Client, *engine.App) {
	t.Helper()
	cfg := engine.DefaultConfig()
	cfg.DataRoot = filepath.Join(t.TempDir(), "data")
	cfg.WorkspaceRoot = t.TempDir()
	a, err := engine.New(cfg, syntheticModel{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(nil)
	host := server.Listener.Addr().String()
	server.Config.Handler = (&transport.Server{App: a, Token: "synthetic-terminal-test-token-not-secret", Host: host}).Handler()
	server.Start()
	ctx, cancel := context.WithCancel(context.Background())
	go a.Run(ctx)
	t.Cleanup(func() { server.Close(); cancel(); a.Close() })
	c, err := NewClient(host, "synthetic-terminal-test-token-not-secret")
	if err != nil {
		t.Fatal(err)
	}
	return c, a
}

func TestTerminalConversationApprovalAndResult(t *testing.T) {
	c, a := actualClient(t)
	binary := filepath.Join(t.TempDir(), "report")
	if out, err := exec.Command("go", "build", "-o", binary, "../../programs/report.go").CombinedOutput(); err != nil {
		t.Fatal(string(out), err)
	}
	reg, err := a.ImportProgram(d.R{"name": "Synthetic terminal report", "description": "JSON stdout only", "entrypoint": binary, "parameters_schema": d.R{"type": "object", "properties": d.R{"title": d.R{"type": "string"}}, "required": []any{"title"}}, "result_schema": d.R{"type": "object", "required": []any{"title", "status", "generated_at"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.EnableProgram(d.S(reg["id"]), true); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Propose(d.ID(), d.R{"goal": "Terminal approval acceptance", "acceptance_criteria": []any{"report returned"}, "kind": "PROGRAM", "program_id": reg["id"], "parameters": d.R{"title": "TUI synthetic"}}); err != nil {
		t.Fatal(err)
	}
	u, screen := startUI(t, c)
	waitUI(t, u, func() bool { return u.online })
	// Bracketed paste is text. Embedded newline must not send until explicit Ctrl+S.
	u.app.QueueEvent(tcell.NewEventPaste(true))
	for _, r := range "中文测试\n第二行" {
		if r == '\n' {
			key(u, tcell.KeyEnter)
		} else {
			u.app.QueueEvent(tcell.NewEventKey(tcell.KeyRune, r, tcell.ModNone))
		}
	}
	u.app.QueueEvent(tcell.NewEventPaste(false))
	waitUI(t, u, func() bool { return u.compose.GetText() == "中文测试\n第二行" })
	if len(a.Store.View("Input")) != 0 {
		t.Fatal("paste sent without explicit action")
	}
	key(u, tcell.KeyCtrlS)
	waitUI(t, u, func() bool { return u.pending == nil && u.compose.GetText() == "" })
	waitUI(t, u, func() bool { return strings.Contains(u.chatText, "合成验收已收到") })
	chat := capture(t, u, screen, "conversation")
	if !strings.Contains(chat, "中文测试") || !strings.Contains(chat, "第二行") {
		t.Fatal("Chinese multiline conversation missing")
	}
	key(u, tcell.KeyF3)
	waitUI(t, u, func() bool { return len(u.entries) == 1 && u.entries[0].kind == "approval" })
	if a.Store.View("Execution")[0]["state"] == "SUCCEEDED" {
		t.Fatal("program ran before approval")
	}
	// Focus moves list -> detail -> first action, then a scrollable confirmation.
	key(u, tcell.KeyTab)
	key(u, tcell.KeyTab)
	key(u, tcell.KeyEnter)
	waitUI(t, u, func() bool { return u.modal })
	confirmation := capture(t, u, screen, "approval")
	if !strings.Contains(confirmation, "program.run") {
		t.Fatal("scope not visible")
	}
	for _, q := range a.Store.View("AuthorizationRequest") {
		if q["state"] != "PENDING" {
			t.Fatal("opening approval confirmed it")
		}
	}
	// Refresh underneath the dialog must leave its target and key focus intact.
	syncUI(t, u, func() { u.apply(u.state) })
	confirmKeyboard(u)
	waitUI(t, u, func() bool { xs := a.Store.View("Execution"); return len(xs) == 1 && xs[0]["state"] == "SUCCEEDED" })
	key(u, tcell.KeyF1)
	syncUI(t, u, func() { u.compose.SetText("draft preserved while inspecting task", true) })
	key(u, tcell.KeyCtrlT)
	waitUI(t, u, func() bool { return u.board.HasFocus() && len(u.boardIDs) > 0 })
	key(u, tcell.KeyEnter)
	waitUI(t, u, func() bool { return strings.Contains(u.detail.GetText(false), "stdout_ref") })
	syncUI(t, u, func() { u.apply(u.state) })
	result := capture(t, u, screen, "result")
	if !strings.Contains(result, "SUCCEEDED") {
		t.Fatal("task result absent")
	}
	key(u, tcell.KeyEscape)
	waitUI(t, u, func() bool { return u.tab == 0 })
	syncUI(t, u, func() {
		if u.compose.GetText() != "draft preserved while inspecting task" {
			t.Error("task inspection lost chat draft")
		}
	})
	capture(t, u, screen, "main-task-board")
	key(u, tcell.KeyF4)
	waitUI(t, u, func() bool { return u.tab == 3 })
	memory := capture(t, u, screen, "consciousness")
	if !strings.Contains(memory, "Consciousness") {
		t.Fatal("memory page absent")
	}
	screen.SetSize(90, 28)
	u.app.QueueEvent(tcell.NewEventResize(90, 28))
	capture(t, u, screen, "narrow-terminal")
}

func TestAmbiguousSendRetriesExactRequestAndPreservesDraft(t *testing.T) {
	var mu sync.Mutex
	var requests [][]byte
	fail := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/inputs" {
			body, _ := io.ReadAll(r.Body)
			mu.Lock()
			requests = append(requests, body)
			first := fail
			fail = false
			mu.Unlock()
			if first {
				http.Error(w, "synthetic response lost after acceptance", 503)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"status":"ACCEPTED"}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/session":
			fmt.Fprint(w, `{"session":{"state":"IDLE"},"runtime":{},"consciousness":{}}`)
		case "/v1/tasks":
			fmt.Fprint(w, `{"plans":[],"executions":[],"decisions":[],"goals":{}}`)
		case "/v1/events":
			fmt.Fprint(w, `{"events":[],"next":0}`)
		default:
			fmt.Fprint(w, `[]`)
		}
	}))
	defer server.Close()
	c, _ := NewClient(strings.TrimPrefix(server.URL, "http://"), "synthetic-token")
	u, _ := startUI(t, c)
	waitUI(t, u, func() bool { return u.online })
	syncUI(t, u, func() { u.compose.SetText("original message", true); u.send() })
	waitUI(t, u, func() bool { return !u.busy && u.pending != nil })
	var original []byte
	syncUI(t, u, func() {
		original = append([]byte(nil), u.pending.body...)
		u.compose.SetText("new draft being typed", true)
		u.send()
	})
	mu.Lock()
	count := len(requests)
	mu.Unlock()
	if count != 1 {
		t.Fatal("new command escaped pending request")
	}
	key(u, tcell.KeyCtrlR)
	waitUI(t, u, func() bool { return u.pending == nil })
	syncUI(t, u, func() {
		if u.compose.GetText() != "new draft being typed" {
			t.Error("successful old send erased newer draft")
		}
	})
	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 2 || !bytes.Equal(requests[0], original) || !bytes.Equal(requests[0], requests[1]) {
		t.Fatal("retry changed request identity or bytes")
	}
}

func TestSnapshotSelectionAndFrozenApproval(t *testing.T) {
	var sent d.R
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			_ = json.NewDecoder(r.Body).Decode(&sent)
		}
		fmt.Fprint(w, `{}`)
	}))
	defer server.Close()
	c, _ := NewClient(strings.TrimPrefix(server.URL, "http://"), "test-token")
	// No poll goroutine: drive snapshots explicitly while the real event loop handles keys.
	u := New(c)
	screen := tcell.NewSimulationScreen("UTF-8")
	u.app.SetScreen(screen)
	screen.SetSize(120, 36)
	done := make(chan error, 1)
	go func() { done <- u.app.Run() }()
	defer func() { u.cancel(); u.app.Stop(); <-done }()
	entry := func(id string, rev int) d.R {
		return d.R{"request": d.R{"id": id, "revision": rev, "state": "PENDING", "display_hash": "shown-hash", "action": d.R{"action": "file.write"}}, "display": d.R{"path": "synthetic.txt", "content": "reviewed bytes"}}
	}
	syncUI(t, u, func() {
		u.online = true
		u.state.approvals = []d.R{entry("first", 1), entry("second", 2)}
		u.switchTab(2)
		u.list.SetCurrentItem(1)
		u.approve(u.current().value, "APPROVE")
		u.state.approvals = []d.R{entry("second", 3), entry("first", 1)}
		u.renderList()
		if u.selected != "approval:second" {
			t.Error("selection changed after reorder")
		}
	})
	confirmKeyboard(u)
	waitUI(t, u, func() bool { return u.pending == nil && !u.modal })
	syncUI(t, u, func() {
		if sent["authorization_id"] != "second" || d.N(sent["expected_revision"]) != 2 || sent["display_hash"] != "shown-hash" {
			t.Error("confirmation changed its target or revision", sent)
		}
	})
}

func TestClientAndTerminalTextBoundaries(t *testing.T) {
	for _, address := range []string{"example.com:8787", "localhost:8787", "127.0.0.1:8787/path", "127.0.0.1:8787@evil.example"} {
		if _, err := NewClient(address, "token"); err == nil {
			t.Fatal("nonlocal address", address)
		}
	}
	if strings.ContainsRune(safe("hello\x1b[31m\x07\n中文"), '\x1b') {
		t.Fatal("terminal escape passed")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200); fmt.Fprint(w, `{"incomplete"`) }))
	defer server.Close()
	c, _ := NewClient(strings.TrimPrefix(server.URL, "http://"), "token")
	if err := c.Call(context.Background(), "/v1/inputs", []byte(`{}`), nil); err == nil {
		t.Fatal("invalid reply acknowledged as success")
	}
}
