package engine

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"testing"
	"time"
)

func TestProgramRegistrationAndAuthorization(t *testing.T) {
	a := testApp(t, &fakeModel{})
	binary := filepath.Join(t.TempDir(), "report")
	cmd := exec.Command("go", "build", "-o", binary, "../../programs/report.go")
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatal(string(b), e)
	}
	reg, e := a.ImportProgram(d.R{"name": "Synthetic report", "description": "No external side effects; JSON stdout only", "entrypoint": binary, "parameters_schema": d.R{"type": "object", "properties": d.R{"title": d.R{"type": "string"}}, "required": []any{"title"}, "additionalProperties": false}, "result_schema": d.R{"type": "object", "required": []any{"title", "status", "generated_at"}}})
	if e != nil {
		t.Fatal(e)
	}
	if e = a.EnableProgram(d.S(reg["id"]), true); e != nil {
		t.Fatal(e)
	}
	_, e = a.Propose(d.ID(), d.R{"goal": "Run registered report", "acceptance_criteria": []any{"valid report"}, "kind": "PROGRAM", "program_id": reg["id"], "parameters": d.R{"title": "Synthetic"}})
	if e != nil {
		t.Fatal(e)
	}
	a.initialize()
	for i := 0; i < 3; i++ {
		if e = a.Schedule(); e != nil {
			t.Fatal(e)
		}
	}
	x := a.Store.View("Execution")[0]
	id := d.S(x["id"])
	if e = a.runTask(context.Background(), id); e != ErrWait {
		t.Fatal("program ran before authorization", e)
	}
	approve(t, a)
	a.set("Execution", id, "READY", nil)
	if e = a.runTask(context.Background(), id); e != nil {
		t.Fatal(e)
	}
	if a.Store.Get("Execution", id)["state"] != "SUCCEEDED" {
		t.Fatal("program failed")
	}
	result := a.Store.Get("TaskResult", d.S(a.Store.Get("Execution", id)["result_id"]))
	b, e := a.Store.Read(d.M(result["detail_ref"]))
	if e != nil {
		t.Fatal(e)
	}
	var detail d.R
	d.Decode(b, &detail)
	stdout, e := a.Store.Read(d.M(detail["stdout_ref"]))
	if e != nil || len(stdout) == 0 {
		t.Fatal("original stdout missing")
	}
}
func TestSchedulingAndUnknownPrecondition(t *testing.T) {
	a := testApp(t, &fakeModel{})
	now := time.Now().UTC()
	a.Now = func() time.Time { return now }
	r, e := a.Propose(d.ID(), d.R{"goal": "scheduled", "acceptance_criteria": []any{"later"}, "trigger": "AT", "at": now.Add(time.Hour).Format(time.RFC3339Nano), "missed_policy": "REPORT_ONLY"})
	if e != nil {
		t.Fatal(e)
	}
	a.initialize()
	a.Schedule()
	if len(a.Store.View("Execution")) != 0 {
		t.Fatal("early trigger")
	}
	now = now.Add(2 * time.Hour)
	if e = a.Schedule(); e != nil {
		t.Fatal(e)
	}
	if len(a.Store.View("Execution")) != 0 || a.Store.Get("TaskPlan", d.S(r["object_id"]))["next_due_at"] != nil {
		t.Fatal("missed REPORT_ONLY executed")
	}
	if len(a.Store.View("Input")) != 1 {
		t.Fatal("missed trigger not reported")
	}
	r, e = a.Propose(d.ID(), d.R{"goal": "unknown device", "acceptance_criteria": []any{"device ready"}, "preconditions": []any{d.R{"condition_id": d.ID(), "kind": "DEVICE_AVAILABLE", "target": "UNREGISTERED", "required_revision": nil}}})
	if e != nil {
		t.Fatal(e)
	}
	a.initialize()
	for i := 0; i < 3; i++ {
		if e = a.Schedule(); e != nil {
			t.Fatal(e)
		}
	}
	x := a.Store.View("Execution")[0]
	if x["state"] != "WAIT_PRECONDITION" {
		t.Fatal("unknown prerequisite treated MET")
	}
	now = now.Add(10 * 24 * time.Hour)
	a.Retire()
	if a.Store.Get("Execution", d.S(x["id"]))["retention_state"] != "HOT" {
		t.Fatal("waiting work retired")
	}
}
func TestChangedTargetAndRevokedRule(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	a.runTask(context.Background(), id)
	approve(t, a)
	x := a.Store.Get("Execution", id)
	path := filepath.Join(a.Cfg.WorkspaceRoot, d.S(x["task_id"]), "work/result.txt")
	os.WriteFile(path, []byte("changed after approval"), 0600)
	a.set("Execution", id, "READY", nil)
	a.set("Execution", id, "DISPATCHING", nil)
	a.set("Execution", id, "RUNNING", nil)
	op := a.Store.View("Operation")[0]
	if e := a.gate(d.S(op["id"])); e == nil {
		t.Fatal("stale target version accepted")
	}
	b, _ := os.ReadFile(path)
	if string(b) != "changed after approval" {
		t.Fatal("external file overwritten")
	}
}
func TestQueuedOccurrenceNotMistakenForMissed(t *testing.T) {
	a := testApp(t, &fakeModel{})
	now := time.Now().UTC()
	a.Now = func() time.Time { return now }
	r, e := a.Propose(d.ID(), d.R{"goal": "repeat", "acceptance_criteria": []any{"complete"}, "trigger": "INTERVAL", "interval_seconds": 60, "overlap_policy": "QUEUE", "missed_policy": "REPORT_ONLY"})
	if e != nil {
		t.Fatal(e)
	}
	a.initialize()
	a.Schedule()
	id := d.S(a.Store.View("Execution")[0]["id"])
	now = now.Add(time.Minute)
	if e = a.Schedule(); e != nil {
		t.Fatal(e)
	}
	p := a.Store.Get("TaskPlan", d.S(r["object_id"]))
	if len(d.A(p["pending_occurrences"])) != 1 {
		t.Fatal("overlap not queued")
	}
	if e = a.cancelExecution(id); e != nil {
		t.Fatal(e)
	}
	now = now.Add(10 * time.Second)
	if e = a.Schedule(); e != nil {
		t.Fatal(e)
	}
	if len(a.Store.View("Execution")) != 2 {
		t.Fatal("queued occurrence incorrectly skipped as missed")
	}
}
func TestSamePlanFollowupKeepsTerminalHistory(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	a.runTask(context.Background(), id)
	approve(t, a)
	a.set("Execution", id, "READY", nil)
	if e := a.runTask(context.Background(), id); e != nil {
		t.Fatal(e)
	}
	old := a.Store.Get("Execution", id)
	args := d.R{"goal": "write result", "acceptance_criteria": []any{"result.txt exists"}, "parent_execution_id": id, "reuse_task_id": old["task_id"]}
	receipt, e := a.Propose(d.ID(), args)
	if e != nil {
		t.Fatal(e)
	}
	next := a.Store.Get("Execution", d.S(receipt["object_id"]))
	if next == nil || next["id"] == id || next["continuation_of"] != id {
		t.Fatal("missing independent followup execution")
	}
	if a.Store.Get("Execution", id)["state"] != "SUCCEEDED" {
		t.Fatal("terminal history resurrected")
	}
	if len(a.Store.View("TaskPlan")) != 1 {
		t.Fatal("same-plan followup created another plan")
	}
	args["goal"] = "different scope"
	if _, e = a.Propose(d.ID(), args); e == nil {
		t.Fatal("changed scope reused old plan")
	}
}
