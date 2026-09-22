package engine

import (
	"context"
	"errors"
	d "secretary_go_demo/internal/domain"
	"testing"
)

type compactionModel struct {
	app  *App
	fail bool
}

func (m *compactionModel) Complete(ctx context.Context, b []byte, purpose string) ([]byte, error) {
	if purpose != "COMPACTION" {
		return (&fakeModel{}).Complete(ctx, b, purpose)
	}
	cs := m.app.Store.Get("Consciousness", m.app.ConsciousnessID)
	if len(d.A(cs["pending_raw_refs"])) == 0 {
		return nil, errors.New("raw responsibility not durably handed off")
	}
	if m.fail {
		return nil, errors.New("synthetic compaction failure")
	}
	var req d.R
	d.Decode(b, &req)
	var materials d.R
	d.Decode([]byte(d.S(d.M(d.A(req["input"])[0])["content"])), &materials)
	ids := []any{}
	refs := []any{}
	for _, v := range d.A(materials["source"]) {
		s := d.M(v)
		ids = append(ids, s["event_id"])
		refs = append(refs, s["ref"])
	}
	item := d.Empty("WorkItem")
	merge(item, d.R{"item_id": d.ID(), "tier": "ACTIVE", "summary": "合成测试事项", "source_refs": refs, "last_activity_at": d.Now()})
	text := string(d.Bytes(d.R{"items": []any{item}, "covered_event_ids": ids}))
	return d.Bytes(d.R{"status": "completed", "output": []any{d.R{"type": "message", "content": []any{d.R{"type": "output_text", "text": text}}}}}), nil
}
func TestCompactionFailureRetainsPendingRawThenAtomicHandoff(t *testing.T) {
	a := testApp(t, &fakeModel{})
	if _, e := a.Accept(d.ID(), []byte("请保留这条合成事项")); e != nil {
		t.Fatal(e)
	}
	if e := a.runMain(context.Background()); e != nil {
		t.Fatal(e)
	}
	m := &compactionModel{app: a, fail: true}
	a.Model = m
	if e := a.Compact(context.Background(), true); e == nil {
		t.Fatal("synthetic failure not returned")
	}
	cs := a.Store.Get("Consciousness", a.ConsciousnessID)
	if len(d.A(cs["pending_raw_refs"])) == 0 || len(d.A(cs["covered_event_ids"])) > 0 {
		t.Fatal("failed handoff lost raw")
	}
	m.fail = false
	if e := a.Compact(context.Background(), true); e != nil {
		t.Fatal(e)
	}
	cs = a.Store.Get("Consciousness", a.ConsciousnessID)
	if len(d.A(cs["pending_raw_refs"])) != 0 || len(d.A(cs["covered_event_ids"])) == 0 {
		t.Fatal("successful handoff not atomic")
	}
	if a.Store.Get("Session", a.SessionID)["state"] != "IDLE" {
		t.Fatal("maintenance spuriously woke main")
	}
}
