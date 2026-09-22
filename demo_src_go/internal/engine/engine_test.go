package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"sync"
	"testing"
	"time"
)

type fakeModel struct {
	mu      sync.Mutex
	calls   int
	task    bool
	entered chan struct{}
	release chan struct{}
}

func (f *fakeModel) Complete(ctx context.Context, b []byte, purpose string) ([]byte, error) {
	f.mu.Lock()
	f.calls++
	n := f.calls
	f.mu.Unlock()
	if f.entered != nil && n == 1 {
		close(f.entered)
		select {
		case <-f.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	var req d.R
	d.Decode(b, &req)
	if purpose == "TASK" {
		found := false
		for _, v := range d.A(req["input"]) {
			if d.M(v)["type"] == "function_call_output" {
				found = true
			}
		}
		if !found {
			return responseTool("write-1", "file_write", d.R{"path": "result.txt", "content": "独立 Go demo"}), nil
		}
		return responseTool("finish-1", "task_finish", d.R{"outcome": "SUCCEEDED", "summary": "文件已写入并返回哈希", "limitations": []any{}}), nil
	}
	return d.Bytes(d.R{"status": "completed", "output": []any{d.R{"type": "message", "role": "assistant", "content": []any{d.R{"type": "output_text", "text": "Master，已收到。"}}}}}), nil
}
func responseTool(id, name string, args d.R) []byte {
	return d.Bytes(d.R{"status": "completed", "output": []any{d.R{"type": "function_call", "id": "fc_" + id, "call_id": id, "name": name, "arguments": string(d.Bytes(args))}}})
}
func testApp(t *testing.T, m *fakeModel) *App {
	t.Helper()
	c := DefaultConfig()
	root := t.TempDir()
	c.DataRoot = filepath.Join(root, "data")
	c.WorkspaceRoot = filepath.Join(root, "workspaces")
	a, e := New(c, m, nil)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { a.Close() })
	if e = a.bootHost(); e != nil {
		t.Fatal(e)
	}
	return a
}
func readyTask(t *testing.T, a *App) string {
	t.Helper()
	receipt, e := a.Propose(d.ID(), d.R{"goal": "write result", "acceptance_criteria": []any{"result.txt exists"}})
	if e != nil {
		t.Fatal(e)
	}
	if e = a.initialize(); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 3; i++ {
		if e = a.Schedule(); e != nil {
			t.Fatal(e)
		}
	}
	xs := a.Store.View("Execution")
	if len(xs) != 1 || xs[0]["state"] != "READY" {
		t.Fatalf("not ready: %#v receipt=%v", xs, receipt)
	}
	return d.S(xs[0]["id"])
}
func approve(t *testing.T, a *App) {
	t.Helper()
	q := a.Store.View("AuthorizationRequest")[0]
	cmd := d.Empty("ApprovalCommand")
	merge(cmd, d.R{"request_id": d.ID(), "authorization_id": q["id"], "expected_revision": q["revision"], "display_hash": q["display_hash"], "decision": "APPROVE"})
	if _, e := a.Approve(cmd); e != nil {
		t.Fatal(e)
	}
	if _, e := a.Approve(cmd); e != nil {
		t.Fatal("exact approval replay failed", e)
	}
}
func TestMainDurableInboxDuringCall(t *testing.T) {
	f := &fakeModel{entered: make(chan struct{}), release: make(chan struct{})}
	a := testApp(t, f)
	id := d.ID()
	one, e := a.Accept(id, []byte("第一条"))
	if e != nil {
		t.Fatal(e)
	}
	duplicate, e := a.Accept(id, []byte("第一条"))
	if e != nil || duplicate["object_id"] != one["object_id"] {
		t.Fatal("input dedupe")
	}
	if _, e = a.Accept(id, []byte("变更")); e == nil {
		t.Fatal("same key different input accepted")
	}
	done := make(chan error, 1)
	go func() { done <- a.runMain(context.Background()) }()
	<-f.entered
	two, e := a.Accept(d.ID(), []byte("第二条"))
	if e != nil {
		t.Fatal(e)
	}
	close(f.release)
	if e = <-done; e != nil {
		t.Fatal(e)
	}
	if a.Store.Get("Input", d.S(two["object_id"]))["state"] != "ACCEPTED" {
		t.Fatal("new input lost or prematurely handled")
	}
	if e = a.runMain(context.Background()); e != nil {
		t.Fatal(e)
	}
	if a.Store.Get("Input", d.S(two["object_id"]))["state"] != "HANDLED" {
		t.Fatal("input not handled")
	}
}
func TestTaskApprovalRestartNoReplay(t *testing.T) {
	f := &fakeModel{}
	a := testApp(t, f)
	id := readyTask(t, a)
	if e := a.runTask(context.Background(), id); !errors.Is(e, ErrWait) {
		t.Fatal("expected auth wait", e)
	}
	x := a.Store.Get("Execution", id)
	file := filepath.Join(a.Cfg.WorkspaceRoot, d.S(x["task_id"]), "work/result.txt")
	if _, e := os.Stat(file); !os.IsNotExist(e) {
		t.Fatal("file written before approval")
	}
	cp := a.Store.Get("Checkpoint", d.S(x["checkpoint_id"]))
	raw, e := a.Store.Read(d.M(cp["raw_context"]))
	if e != nil {
		t.Fatal(e)
	}
	cfg := a.Cfg
	a.Close()
	a, e = New(cfg, f, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	raw2, e := a.Store.Read(d.M(cp["raw_context"]))
	if e != nil || string(raw) != string(raw2) {
		t.Fatal("context not exact after restart")
	}
	approve(t, a)
	if e = a.set("Execution", id, "READY", nil); e != nil {
		t.Fatal(e)
	}
	if e = a.runTask(context.Background(), id); e != nil {
		t.Fatal(e)
	}
	if a.Store.Get("Execution", id)["state"] != "SUCCEEDED" {
		t.Fatal("not successful")
	}
	b, e := os.ReadFile(file)
	if e != nil || string(b) != "独立 Go demo" {
		t.Fatal("missing artifact", e)
	}
	if f.calls != 2 {
		t.Fatalf("model regenerated saved request: %d", f.calls)
	}
	q := a.Store.View("AuthorizationRequest")[0]
	if q["state"] != "CONSUMED" {
		t.Fatal("approval not consumed")
	}
	if e = a.gate(d.S(q["operation_id"])); e == nil {
		t.Fatal("consumed authorization reused")
	}
	before := a.Store.Get("Execution", id)
	if _, e = a.Query("LIST", ""); e != nil {
		t.Fatal(e)
	}
	if a.Store.Get("Execution", id)["revision"] != before["revision"] {
		t.Fatal("list touches TTL")
	}
	if _, e = a.Query("DETAIL", id); e != nil {
		t.Fatal(e)
	}
}
func TestUnknownCannotBeReissued(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	a.runTask(context.Background(), id)
	approve(t, a)
	a.set("Execution", id, "READY", nil)
	a.set("Execution", id, "DISPATCHING", nil)
	a.set("Execution", id, "RUNNING", nil)
	op := a.Store.View("Operation")[0]
	if e := a.gate(d.S(op["id"])); e != nil {
		t.Fatal(e)
	}
	cfg := a.Cfg
	a.Close()
	b, e := New(cfg, &fakeModel{}, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	if b.Store.Get("Operation", d.S(op["id"]))["state"] != "RESULT_UNKNOWN" {
		t.Fatal("unknown not preserved")
	}
	if _, e = b.WriteFile(id, "replacement", d.R{"path": "result.txt", "content": "独立 Go demo"}); e == nil {
		t.Fatal("unknown effect reissued")
	}
}
func TestPathAndRoleBoundaries(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	for _, path := range []string{"../x", "/tmp/x", "a/../../x"} {
		if _, e := a.workPath(id, path); e == nil {
			t.Fatal("escape allowed", path)
		}
	}
	x := a.Store.Get("Execution", id)
	os.Symlink(t.TempDir(), filepath.Join(a.Cfg.WorkspaceRoot, d.S(x["task_id"]), "work/link"))
	if _, e := a.workPath(id, "link/secret"); e == nil {
		t.Fatal("symlink accepted")
	}
	if _, e := a.tool(context.Background(), "MAIN", "", d.ID(), "file_write", d.R{}); e == nil {
		t.Fatal("main execution tool available")
	}
	if _, e := a.tool(context.Background(), "TASK", id, d.ID(), "approve", d.R{}); e == nil {
		t.Fatal("task approval available")
	}
}
func TestCapacityRetainsInput(t *testing.T) {
	a := testApp(t, &fakeModel{})
	a.Cfg.ContextBudget = 1000
	a.Cfg.ContextReserve = 100
	receipt, e := a.Accept(d.ID(), []byte("hold input"))
	if e != nil {
		t.Fatal(e)
	}
	e = a.runMain(context.Background())
	if e == nil {
		t.Fatal("expected capacity block")
	}
	if a.Store.Get("Input", d.S(receipt["object_id"]))["state"] != "CLAIMED" || a.Store.Get("Session", a.SessionID)["state"] != "CAPACITY_BLOCKED" {
		t.Fatal("capacity lost work")
	}
}
func TestTerminalRetentionWaitsForFeedback(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	a.runTask(context.Background(), id)
	approve(t, a)
	a.set("Execution", id, "READY", nil)
	if e := a.runTask(context.Background(), id); e != nil {
		t.Fatal(e)
	}
	a.Now = func() time.Time { return time.Now().Add(72 * time.Hour) }
	if e := a.Retire(); e != nil {
		t.Fatal(e)
	}
	if a.Store.Get("Execution", id)["retention_state"] == "RETIRED" {
		t.Fatal("retired with unhandled feedback")
	}
	if e := a.runMain(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e := a.Retire(); e != nil {
		t.Fatal(e)
	}
	if a.Store.Get("Execution", id)["retention_state"] != "RETIRED" {
		t.Fatal("not retired")
	}
	if _, e := a.Query("DETAIL", id); e == nil {
		t.Fatal("retired detail resurrected")
	}
}
