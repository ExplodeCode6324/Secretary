package engine

import (
	"context"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
	"testing"
)

func auditRunning(t *testing.T, a *App) string {
	t.Helper()
	id := readyTask(t, a)
	if e := a.set("Execution", id, "DISPATCHING", nil); e != nil {
		t.Fatal(e)
	}
	if e := a.set("Execution", id, "RUNNING", nil); e != nil {
		t.Fatal(e)
	}
	return id
}
func auditDecision(t *testing.T, a *App) (string, d.R) {
	t.Helper()
	id := auditRunning(t, a)
	_, e := a.askDecision(id, d.ID(), d.R{"question": "choose", "impact": "wait"})
	if e != ErrWait {
		t.Fatal(e)
	}
	if e = a.set("Execution", id, "WAIT_DECISION", nil); e != nil {
		t.Fatal(e)
	}
	return id, a.Store.View("DecisionRequest")[0]
}

func TestAudit_AUD01(t *testing.T) { TestChangedTargetAndRevokedRule(t) }
func TestAudit_AUD02(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id, q := auditDecision(t, a)
	q["deadline"] = "2000-01-01T00:00:00Z"
	if e := a.Store.Update(func(tx *store.Tx) error { return tx.Save(q) }); e != nil {
		t.Fatal(e)
	}
	x := a.Store.Get("Execution", id)
	_, e := a.Control(d.ID(), d.R{"action": "ANSWER_DECISION", "target_id": id, "expected_revision": x["revision"], "decision_request_id": q["id"], "answer": d.R{"value": "blue"}})
	if e == nil {
		t.Fatal("expired ordinary decision was accepted")
	}
}
func TestAudit_AUD03(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id, q := auditDecision(t, a)
	x := a.Store.Get("Execution", id)
	request := d.ID()
	args := d.R{"action": "ANSWER_DECISION", "target_id": id, "expected_revision": x["revision"], "decision_request_id": q["id"], "answer": d.R{"value": "blue"}}
	if _, e := a.Control(request, args); e != nil {
		t.Fatal(e)
	}
	seq := a.Store.Sequence()
	if _, e := a.Control(request, args); e != nil {
		t.Fatal(e)
	}
	if a.Store.Sequence() != seq {
		t.Fatal("duplicate changed state")
	}
}
func TestAudit_AUD04(t *testing.T) {
	a := testApp(t, &fakeModel{})
	r, e := a.Accept(d.ID(), []byte("baseline"))
	if e != nil {
		t.Fatal(e)
	}
	ref, e := a.Store.Put([]byte("missing"), "text/plain")
	if e != nil {
		t.Fatal(e)
	}
	if e = os.Remove(filepath.Join(a.Cfg.DataRoot, d.S(ref["path"]))); e != nil {
		t.Fatal(e)
	}
	i := a.Store.Get("Input", d.S(r["object_id"]))
	i["payload"] = ref
	file := filepath.Join(a.Cfg.DataRoot, "journal/000001.jsonl")
	before, _ := os.Stat(file)
	if e = a.Store.Update(func(tx *store.Tx) error { return tx.Save(i) }); e == nil {
		t.Fatal("missing reference accepted")
	}
	after, _ := os.Stat(file)
	if before.Size() != after.Size() {
		t.Fatal("failed commit poisoned durable journal")
	}
}
func TestAudit_AUD05(t *testing.T) {
	a := testApp(t, &fakeModel{})
	a.Accept(d.ID(), []byte("context"))
	if e := a.runMain(context.Background()); e != nil {
		t.Fatal(e)
	}
	c := a.Store.View("Context")[0]
	c["provider_profile"] = "mutated"
	if e := a.Store.Update(func(tx *store.Tx) error { return tx.Save(c) }); e == nil {
		t.Fatal("immutable Context record was overwritten")
	}
}
func TestAudit_AUD06(t *testing.T) {
	a := testApp(t, &fakeModel{})
	r, e := a.Accept(d.ID(), []byte("not handled"))
	if e != nil {
		t.Fatal(e)
	}
	i := a.Store.Get("Input", d.S(r["object_id"]))
	i["state"] = "HANDLED"
	if e = a.Store.Update(func(tx *store.Tx) error { return tx.Save(i) }); e == nil {
		t.Fatal("illegal state edge accepted")
	}
}
func TestAudit_AUD07(t *testing.T) {
	a := testApp(t, &fakeModel{})
	r, e := a.Accept(d.ID(), []byte("owned"))
	if e != nil {
		t.Fatal(e)
	}
	i := a.Store.Get("Input", d.S(r["object_id"]))
	i["session_id"] = d.ID()
	if e = a.Store.Update(func(tx *store.Tx) error { return tx.Save(i) }); e == nil {
		t.Fatal("dangling session accepted")
	}
}
func TestAudit_AUD11(t *testing.T) {
	a := testApp(t, &fakeModel{})
	if _, e := a.Notify(d.ID(), "test notification"); e != nil {
		t.Fatal(e)
	}
	if a.Store.View("Notification")[0]["state"] == "SENT" {
		t.Fatal("notification sent without receipt")
	}
}
func TestAudit_AUD12(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	if e := a.runTask(context.Background(), id); e != ErrWait {
		t.Fatal(e)
	}
	approve(t, a)
	for _, s := range []string{"READY", "DISPATCHING", "RUNNING"} {
		if e := a.set("Execution", id, s, nil); e != nil {
			t.Fatal(e)
		}
	}
	op := a.Store.View("Operation")[0]
	op["owner_epoch"] = a.Store.Epoch() + 99
	op["attempt_id"] = d.ID()
	if e := a.Store.Update(func(tx *store.Tx) error { return tx.Save(op) }); e != nil {
		t.Fatal(e)
	}
	if e := a.gate(d.S(op["id"])); e == nil {
		t.Fatal("stale epoch/attempt accepted by final gate")
	}
}
func TestAudit_AUD13(t *testing.T) { TestQueuedOccurrenceNotMistakenForMissed(t) }
func TestAudit_AUD14(t *testing.T) {
	a := testApp(t, &fakeModel{})
	a.Accept(d.ID(), []byte("hello"))
	if e := a.runMain(context.Background()); e != nil {
		t.Fatal(e)
	}
	c := a.Store.View("Context")[0]
	b, e := a.Store.Read(d.M(c["tools_schema"]))
	if e != nil {
		t.Fatal(e)
	}
	var defs []any
	if e = d.Decode(b, &defs); e != nil {
		t.Fatal(e)
	}
	for _, v := range defs {
		if d.M(v)["name"] == "task_propose" {
			return
		}
	}
	t.Fatal("missing tool definitions")
}
func TestAudit_AUD15(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := d.ID()
	raw := []byte("A\r\n中文\x00é")
	r, e := a.Accept(id, raw)
	if e != nil {
		t.Fatal(e)
	}
	i := a.Store.Get("Input", d.S(r["object_id"]))
	b, e := a.Store.Read(d.M(i["payload"]))
	if e != nil || string(b) != string(raw) {
		t.Fatal("bytes changed", e)
	}
	dup, e := a.Accept(id, raw)
	if e != nil || dup["object_id"] != r["object_id"] {
		t.Fatal("dedupe failed", e)
	}
	if _, e = a.Accept(id, append(raw, 'x')); e == nil {
		t.Fatal("conflict accepted")
	}
}

func TestAuditGateValid(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	if e := a.runTask(context.Background(), id); e != ErrWait {
		t.Fatal(e)
	}
	approve(t, a)
	for _, s := range []string{"READY", "DISPATCHING", "RUNNING"} {
		if e := a.set("Execution", id, s, nil); e != nil {
			t.Fatal(e)
		}
	}
	op := a.Store.View("Operation")[0]
	if e := a.Store.Update(func(tx *store.Tx) error { return tx.Save(op) }); e != nil {
		t.Fatal(e)
	}
	if e := a.gate(d.S(op["id"])); e != nil {
		t.Fatal(e)
	}
}

func TestAuditGateEpoch(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	if e := a.runTask(context.Background(), id); e != ErrWait {
		t.Fatal(e)
	}
	approve(t, a)
	for _, s := range []string{"READY", "DISPATCHING", "RUNNING"} {
		if e := a.set("Execution", id, s, nil); e != nil {
			t.Fatal(e)
		}
	}
	op := a.Store.View("Operation")[0]
	op["owner_epoch"] = a.Store.Epoch() + 99
	if e := a.Store.Update(func(tx *store.Tx) error { return tx.Save(op) }); e != nil {
		t.Fatal(e)
	}
	if e := a.gate(d.S(op["id"])); e == nil {
		t.Fatal("stale epoch/attempt accepted by final gate")
	}
}

func TestAuditGateAttempt(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	if e := a.runTask(context.Background(), id); e != ErrWait {
		t.Fatal(e)
	}
	approve(t, a)
	for _, s := range []string{"READY", "DISPATCHING", "RUNNING"} {
		if e := a.set("Execution", id, s, nil); e != nil {
			t.Fatal(e)
		}
	}
	op := a.Store.View("Operation")[0]
	op["attempt_id"] = d.ID()
	if e := a.Store.Update(func(tx *store.Tx) error { return tx.Save(op) }); e != nil {
		t.Fatal(e)
	}
	if e := a.gate(d.S(op["id"])); e == nil {
		t.Fatal("stale epoch/attempt accepted by final gate")
	}
}
