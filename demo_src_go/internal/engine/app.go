// Package engine implements the host, scheduler and authorization services.
// The single Store transaction coordinator is the only authority for state writes.
package engine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/model"
	"secretary_go_demo/internal/store"
	"sort"
	"sync"
	"time"
)

type Config struct {
	DataRoot            string `json:"data_root"`
	WorkspaceRoot       string `json:"workspace_root"`
	Listen              string `json:"listen"`
	Model               string `json:"model"`
	Endpoint            string `json:"endpoint"`
	ContextBudget       int    `json:"context_budget"`
	ContextReserve      int    `json:"context_reserve"`
	CompactionThreshold int    `json:"compaction_threshold"`
	MaxWorkers          int    `json:"max_workers"`
	MaxInputBytes       int    `json:"max_input_bytes"`
	MaxFrameBytes       int    `json:"max_frame_bytes"`
	RetentionSeconds    int    `json:"retention_seconds"`
}

func DefaultConfig() Config {
	return Config{".local/data", ".local/workspaces", "127.0.0.1:8787", "gpt-5.6-luna", "https://opencode.ai/zen/go/v1/responses", 64000, 8000, 24000, 2, 24000, 32 << 20, 172800}
}
func (c *Config) Validate() error {
	if c.ContextBudget <= c.ContextReserve || c.ContextReserve <= 0 || c.CompactionThreshold <= 0 || c.CompactionThreshold >= c.ContextBudget-c.ContextReserve || c.MaxWorkers < 1 || c.MaxWorkers > 16 || c.MaxInputBytes < 1 || c.MaxInputBytes >= c.ContextBudget-c.ContextReserve || c.MaxFrameBytes < 1024 || c.RetentionSeconds < 1 {
		return errors.New("invalid budgets or limits")
	}
	var e error
	c.DataRoot, e = filepath.Abs(c.DataRoot)
	if e != nil {
		return e
	}
	c.WorkspaceRoot, e = filepath.Abs(c.WorkspaceRoot)
	if e != nil {
		return e
	}
	if c.DataRoot == c.WorkspaceRoot {
		return errors.New("data and workspace roots must differ")
	}
	return nil
}

type World interface {
	Validate(context.Context, d.R) error
	Apply(context.Context, d.R) (d.R, error)
	Query(context.Context, string) (d.R, error)
	Export(context.Context, func(d.R) error) error
}
type App struct {
	Cfg                                      Config
	Store                                    *store.Store
	Model                                    model.Client
	World                                    World
	SessionID, ConsciousnessID, SafetyID     string
	mu                                       sync.Mutex
	tickMu                                   sync.Mutex
	closeOnce                                sync.Once
	closing                                  bool
	mainRunning, compactRunning, mainBlocked bool
	taskBlocked                              map[string]bool
	workers                                  map[string]bool
	wg                                       sync.WaitGroup
	lastErr                                  string
	lastCompaction                           time.Time
	ctx                                      context.Context
	cancel                                   context.CancelFunc
	Now                                      func() time.Time
}

func New(c Config, m model.Client, w World) (*App, error) {
	if e := c.Validate(); e != nil {
		return nil, e
	}
	s, e := store.Open(c.DataRoot, c.MaxFrameBytes)
	if e != nil {
		return nil, e
	}
	a := &App{Cfg: c, Store: s, Model: m, World: w, workers: map[string]bool{}, taskBlocked: map[string]bool{}, Now: time.Now}
	a.ctx, a.cancel = context.WithCancel(context.Background())
	if e = a.recover(); e != nil {
		s.Close()
		return nil, e
	}
	return a, nil
}
func (a *App) Error(e error) {
	if e != nil {
		a.mu.Lock()
		a.lastErr = e.Error()
		a.mu.Unlock()
	}
}
func (a *App) Status() d.R {
	a.mu.Lock()
	defer a.mu.Unlock()
	return d.R{"error": a.lastErr, "main_running": a.mainRunning, "main_blocked": a.mainBlocked, "blocked_tasks": len(a.taskBlocked), "compaction_running": a.compactRunning, "workers": len(a.workers), "world_available": a.World != nil}
}
func (a *App) Close() error {
	a.closeOnce.Do(func() {
		a.cancel()
		a.mu.Lock()
		a.closing = true
		a.mu.Unlock()
		a.tickMu.Lock()
		a.tickMu.Unlock()
		a.wg.Wait()
		a.Store.Close()
	})
	return nil
}
func (a *App) Run(ctx context.Context) {
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.ctx.Done():
			return
		case <-ticker.C:
			a.Tick()
		}
	}
}
func (a *App) Tick() {
	a.tickMu.Lock()
	defer a.tickMu.Unlock()
	a.mu.Lock()
	closing := a.closing
	a.mu.Unlock()
	if closing {
		return
	}
	a.Error(a.initialize())
	a.Error(a.expireAuthorizations())
	a.Error(a.Schedule())
	a.Error(a.processWorld())
	a.Error(a.Retire())
	a.startMain()
	a.startWorkers()
	a.startCompaction(false)
}
func (a *App) recover() error {
	for _, cp := range a.Store.View("Checkpoint") {
		if cp["executor_kind"] == "AGENT" && (cp["adapter_version"] != model.AdapterVersion || cp["provider_profile"] != a.Cfg.Model) {
			return errors.New("RECOVERY_BLOCKED incompatible saved agent context profile")
		}
	}
	sessions := a.Store.View("Session")
	if len(sessions) > 1 {
		return errors.New("RECOVERY_BLOCKED multiple sessions")
	}
	if len(sessions) == 0 {
		return a.Store.Update(func(t *store.Tx) error {
			s := d.New("Session")
			c := d.New("Consciousness")
			safe := d.New("SafetyRule")
			a.SessionID = d.S(s["id"])
			a.ConsciousnessID = d.S(c["id"])
			a.SafetyID = d.S(safe["id"])
			s["state"] = "STOPPED"
			s["owner_epoch"] = a.Store.Epoch()
			s["consciousness_id"] = c["id"]
			c["session_id"] = s["id"]
			safe["created_by"] = "MASTER_UI"
			if e := t.Save(s); e != nil {
				return e
			}
			if e := t.Save(c); e != nil {
				return e
			}
			return t.Save(safe)
		})
	}
	s := sessions[0]
	a.SessionID = d.S(s["id"])
	a.ConsciousnessID = d.S(s["consciousness_id"])
	safe := a.Store.View("SafetyRule")
	if len(safe) != 1 {
		return errors.New("RECOVERY_BLOCKED safety rule missing")
	}
	a.SafetyID = d.S(safe[0]["id"])
	// Model transport is repeatable, external effects are not. Preserve complete responses.
	for _, c := range a.Store.View("ModelCall") {
		if c["state"] == "IN_FLIGHT" {
			if e := a.set("ModelCall", d.S(c["id"]), "INTERRUPTED", d.R{"error": "process interrupted before complete response"}); e != nil {
				return e
			}
		}
	}
	for _, op := range a.Store.View("Operation") {
		if op["state"] == "DISPATCHED" && d.M(op["action"])["action"] != "world.change" {
			if e := a.set("Operation", d.S(op["id"]), "RESULT_UNKNOWN", d.R{"effect": "UNKNOWN", "error": "process interrupted after dispatch; do not repeat"}); e != nil {
				return e
			}
		}
	}
	for _, job := range a.Store.View("CompactionJob") {
		if job["state"] == "SUMMARIZING" || job["state"] == "VALIDATING" {
			if e := a.set("CompactionJob", d.S(job["id"]), "FAILED", d.R{"validation_errors": []any{"process interrupted; raw material retained"}}); e != nil {
				return e
			}
		}
	}
	for _, e := range a.Store.View("Execution") {
		if e["state"] == "DISPATCHING" || e["state"] == "RUNNING" || e["state"] == "CANCEL_REQUESTED" {
			unknown := false
			for _, op := range a.Store.View("Operation") {
				if d.M(op["scope"])["execution_id"] == e["id"] && op["state"] == "RESULT_UNKNOWN" {
					unknown = true
				}
			}
			if unknown || d.M(a.Store.Get("TaskPlan", d.S(e["task_id"]))["executor"])["kind"] == "PROGRAM" {
				if err := a.set("Execution", d.S(e["id"]), "RESULT_UNKNOWN", nil); err != nil {
					return err
				}
				a.Error(a.feedback(d.S(e["id"]), "UNKNOWN", "执行中断，外部结果待核验", nil))
			} else if e["state"] == "DISPATCHING" {
				if err := a.set("Execution", d.S(e["id"]), "RUNNING", nil); err != nil {
					return err
				}
			}
		}
	}
	return a.Store.Update(func(t *store.Tx) error {
		s := t.Get("Session", a.SessionID)
		s["owner_epoch"] = a.Store.Epoch()
		return t.Save(s)
	})
}
func (a *App) set(typ, id, state string, fields d.R) error {
	return a.Store.Update(func(t *store.Tx) error {
		r := t.Get(typ, id)
		if r == nil {
			return errors.New("NOT_FOUND " + typ)
		}
		if state != "" {
			r["state"] = state
		}
		for k, v := range fields {
			r[k] = v
		}
		return t.Save(r)
	})
}
func (a *App) bootHost() error {
	s := a.Store.Get("Session", a.SessionID)
	if s["state"] == "STOPPED" {
		if e := a.set("Session", a.SessionID, "RECOVERING", nil); e != nil {
			return e
		}
		return a.set("Session", a.SessionID, "IDLE", nil)
	}
	return nil
}
func (a *App) scope(execution string) d.R {
	if execution == "" {
		return d.Scope(a.SessionID, "", "")
	}
	e := a.Store.Get("Execution", execution)
	return d.Scope("", d.S(e["task_id"]), execution)
}
func (a *App) Accept(request string, raw []byte) (out d.R, err error) {
	if request == "" || len(raw) == 0 || len(raw) > a.Cfg.MaxInputBytes {
		return nil, errors.New("invalid input size/request_id")
	}
	if e := d.Validate("ID", request); e != nil {
		return nil, e
	}
	hash := d.Hash(raw)
	err = a.Store.Update(func(t *store.Tx) error {
		var e error
		if out, e = t.Existing(request, hash); e != nil || out != nil {
			return e
		}
		ref, e := a.Store.Put(raw, "text/plain; charset=utf-8")
		if e != nil {
			return e
		}
		i := d.New("Input")
		i["session_id"] = a.SessionID
		i["dedupe_key"] = request
		i["producer"] = "MASTER"
		i["state"] = "ACCEPTED"
		i["payload"] = ref
		i["received_at"] = d.Now()
		if e = t.Save(i); e != nil {
			return e
		}
		if _, e = t.Log("input.accepted", "MASTER_UI", a.scope(""), d.S(i["id"]), d.R{"input_id": i["id"], "text": string(raw)}); e != nil {
			return e
		}
		out, e = t.Receipt(request, hash, d.S(i["id"]))
		return e
	})
	return
}
func sorted(rs []d.R, field string) {
	sort.Slice(rs, func(i, j int) bool { return d.S(rs[i][field]) < d.S(rs[j][field]) })
}
func (a *App) Notify(request, message string) (out d.R, err error) {
	raw := d.Bytes(d.R{"message": message})
	err = a.Store.Update(func(t *store.Tx) error {
		var e error
		if out, e = t.Existing(request, d.Hash(raw)); e != nil || out != nil {
			return e
		}
		ref, e := a.Store.Put([]byte(message), "text/plain; charset=utf-8")
		if e != nil {
			return e
		}
		n := d.New("Notification")
		n["state"] = "QUEUED"
		n["session_id"] = a.SessionID
		n["channel"] = "LOCAL_UI"
		n["message"] = ref
		n["delivery_key"] = request
		n["requested_at"] = d.Now()
		if e = t.Save(n); e != nil {
			return e
		}
		if _, e = t.Log("notification.queued", "MAIN", a.scope(""), request, d.R{"text": message, "notification_id": n["id"]}); e != nil {
			return e
		}
		out, e = t.Receipt(request, d.Hash(raw), d.S(n["id"]))
		return e
	})
	return
}
func (a *App) initialize() error {
	if err := a.bootHost(); err != nil {
		return err
	}
	for _, p := range a.Store.View("TaskPlan") {
		if p["state"] != "INITIALIZING" {
			continue
		}
		root := filepath.Join(a.Cfg.WorkspaceRoot, d.S(p["id"]))
		manifest := filepath.Join(root, "workspace.json")
		if b, e := os.ReadFile(manifest); e == nil {
			var v d.R
			if d.Decode(b, &v) != nil || v["task_id"] != p["id"] {
				return errors.New("workspace ownership mismatch")
			}
		} else if os.IsNotExist(e) {
			if e = store.Atomic(manifest, d.Bytes(d.R{"schema_version": 1, "task_id": p["id"], "created_at": d.Now()})); e != nil {
				a.set("TaskPlan", d.S(p["id"]), "INIT_FAILED", d.R{"initialization_error": e.Error()})
				continue
			}
		} else {
			return e
		}
		if e := os.MkdirAll(filepath.Join(root, "work"), 0700); e != nil {
			return e
		}
		if e := a.set("TaskPlan", d.S(p["id"]), "ACTIVE", nil); e != nil {
			return e
		}
	}
	return nil
}
func (a *App) payload(ev d.R) (d.R, error) {
	b, e := a.Store.Read(d.M(ev["payload"]))
	if e != nil {
		return nil, e
	}
	var r d.R
	e = d.Decode(b, &r)
	return r, e
}
func isTerminal(s string) bool {
	return s == "SUCCEEDED" || s == "FAILED" || s == "CANCELLED" || s == "EXPIRED"
}
func merge(dst, src d.R) d.R {
	for k, v := range src {
		dst[k] = v
	}
	return dst
}
func nonempty(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

var ErrWait = errors.New("durable wait")

func (a *App) debug(s string, v ...any) { a.Error(fmt.Errorf(s, v...)) }

func (a *App) scopeTx(t *store.Tx, execution string) d.R {
	if execution == "" {
		return d.Scope(a.SessionID, "", "")
	}
	x := t.Get("Execution", execution)
	return d.Scope("", d.S(x["task_id"]), execution)
}

func (a *App) AcknowledgeNotification(id string) error {
	n := a.Store.Get("Notification", id)
	if n == nil {
		return errors.New("NOT_FOUND notification")
	}
	if n["state"] == "SENT" {
		return nil
	}
	if n["state"] == "QUEUED" {
		if e := a.set("Notification", id, "SENDING", nil); e != nil {
			return e
		}
	}
	return a.Store.Update(func(t *store.Tx) error {
		n := t.Get("Notification", id)
		if n["state"] == "SENT" {
			return nil
		}
		ref, e := t.Object(d.R{"channel": "LOCAL_UI", "delivery_key": n["delivery_key"], "acknowledged_at": d.Now()})
		if e != nil {
			return e
		}
		n["state"] = "SENT"
		n["receipt"] = ref
		if e = t.Save(n); e != nil {
			return e
		}
		_, e = t.Log("notification.result", "MASTER_UI", a.scope(""), d.S(n["delivery_key"]), d.R{"notification_id": id, "receipt": ref})
		return e
	})
}
func (a *App) persistManifest(id string) error {
	x := a.Store.Get("Execution", id)
	if x == nil {
		return nil
	}
	m := d.R{"schema_version": 1, "task_id": x["task_id"], "execution_id": id, "checkpoint_id": x["checkpoint_id"], "result_id": x["result_id"], "state": x["state"], "objects": []any{}}
	if cp := a.Store.Get("Checkpoint", d.S(x["checkpoint_id"])); cp != nil {
		m["objects"] = []any{cp["raw_context"], cp["continuation"]}
	}
	if r := a.Store.Get("TaskResult", d.S(x["result_id"])); r != nil {
		m["objects"] = append(d.A(m["objects"]), r["detail_ref"])
	}
	return store.Atomic(filepath.Join(a.Cfg.WorkspaceRoot, d.S(x["task_id"]), "executions", id, "manifest.json"), d.Bytes(m))
}
