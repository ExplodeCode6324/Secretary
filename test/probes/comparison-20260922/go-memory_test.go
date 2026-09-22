package engine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/model"
	"testing"
	"time"
)

type auditBoundedModel struct {
	inner model.Client
	calls int
}

func (m *auditBoundedModel) Complete(ctx context.Context, b []byte, purpose string) ([]byte, error) {
	m.calls++
	if m.calls > 30 {
		return nil, context.DeadlineExceeded
	}
	return m.inner.Complete(ctx, b, purpose)
}
func TestAuditLiveMemory(t *testing.T) {
	if os.Getenv("SECRETARY_LIVE_TEST") != "1" {
		t.Skip("explicit paid opt-in")
	}
	b, e := os.ReadFile(os.Getenv("AUDIT_MEMORY_BATTERY"))
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Events       []string `json:"events"`
		CompactAfter []int    `json:"compact_after"`
		Question     string   `json:"question"`
	}
	if e = json.Unmarshal(b, &fixture); e != nil {
		t.Fatal(e)
	}
	cfg := DefaultConfig()
	cfg.DataRoot = filepath.Join(os.Getenv("AUDIT_MEMORY_DATA"), "data")
	cfg.WorkspaceRoot = filepath.Join(os.Getenv("AUDIT_MEMORY_DATA"), "workspaces")
	cfg.ContextBudget = 256000
	cfg.CompactionThreshold = 120000
	client, e := model.New(cfg.Endpoint, os.Getenv("SECRETARY_MAIN_API_KEY"), os.Getenv("SECRETARY_TASK_API_KEY"))
	if e != nil {
		t.Fatal(e)
	}
	m := &auditBoundedModel{inner: client}
	a, e := New(cfg, m, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer func() { a.Close() }()
	if e = a.bootHost(); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	phases := []any{}
	for i, text := range fixture.Events {
		if _, e = a.Accept(d.ID(), []byte(text)); e != nil {
			t.Fatal(e)
		}
		if e = a.runMain(ctx); e != nil {
			t.Fatal(e)
		}
		for _, at := range fixture.CompactAfter {
			if at == i+1 {
				err := a.Compact(ctx, true)
				status := ""
				if err != nil {
					status = err.Error()
				}
				phases = append(phases, d.R{"after": at, "error": status, "consciousness": a.Store.Get("Consciousness", a.ConsciousnessID), "jobs": a.Store.View("CompactionJob")})
			}
		}
	}
	a.Close()
	a, e = New(cfg, m, nil)
	if e != nil {
		t.Fatal(e)
	}
	if e = a.bootHost(); e != nil {
		t.Fatal(e)
	}
	before := len(a.Store.Events())
	if _, e = a.Accept(d.ID(), []byte(fixture.Question)); e != nil {
		t.Fatal(e)
	}
	if e = a.runMain(ctx); e != nil {
		t.Fatal(e)
	}
	messages := []any{}
	for _, ev := range a.Store.Events()[before:] {
		if ev["event_type"] == "model.response" {
			p, e := a.payload(ev)
			if e != nil {
				t.Fatal(e)
			}
			messages = append(messages, d.R{"text": model.Text(d.M(p["response"])), "event_id": ev["event_id"]})
		}
	}
	report := d.R{"implementation": "go", "evidence_level": "LIVE_MODEL", "calls": m.calls, "phase": phases, "messages": messages, "limitations": []string{"short synthetic battery", "logical dates are story labels, not real duration", "256000 conservative byte context budget"}}
	if e = os.WriteFile(os.Getenv("AUDIT_MEMORY_REPORT"), d.Bytes(report), 0600); e != nil {
		t.Fatal(e)
	}
}
