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

// Explicit opt-in only. Approvals are restricted to synthetic files in a temporary workspace.
func TestLiveMainTaskAndConsciousness(t *testing.T) {
	if os.Getenv("SECRETARY_LIVE_TEST") != "1" {
		t.Skip("live model test is opt-in")
	}
	c := DefaultConfig()
	c.CompactionThreshold = 50000
	root := t.TempDir()
	c.DataRoot = filepath.Join(root, "data")
	c.WorkspaceRoot = filepath.Join(root, "workspaces")
	client, e := model.New(c.Endpoint, os.Getenv("SECRETARY_MAIN_API_KEY"), os.Getenv("SECRETARY_TASK_API_KEY"))
	if e != nil {
		t.Fatal(e)
	}
	a, e := New(c, client, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if e = a.bootHost(); e != nil {
		t.Fatal(e)
	}
	start := time.Now()
	_, e = a.Accept(d.ID(), []byte("这是一项合成验收测试。请立即委派任务 agent，在它自己的工作目录中创建 go-live-proof.txt，文件内容必须恰好为 Secretary_go_demo live proof（不需要换行）。验收标准：文件存在且内容完全一致。请使用 task_propose，执行授权会由测试界面单独处理。收到任务反馈后查详情并向我汇报。"))
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()
	go a.Run(ctx)
	approved := false
	var xid string
	for ctx.Err() == nil {
		for _, entry := range a.Store.View("AuthorizationRequest") {
			if entry["state"] != "PENDING" {
				continue
			}
			action := d.M(entry["action"])
			b, e := a.Store.Read(d.M(action["parameters_ref"]))
			if e != nil {
				t.Fatal(e)
			}
			var params d.R
			d.Decode(b, &params)
			if action["action"] != "file.write" || params["path"] != "go-live-proof.txt" || params["content"] != "Secretary_go_demo live proof" {
				t.Fatalf("unexpected live test action %s", action["action"])
			}
			cmd := d.Empty("ApprovalCommand")
			merge(cmd, d.R{"request_id": d.ID(), "authorization_id": entry["id"], "expected_revision": entry["revision"], "display_hash": entry["display_hash"], "decision": "APPROVE"})
			if _, e = a.Approve(cmd); e != nil {
				t.Fatal(e)
			}
			approved = true
		}
		for _, x := range a.Store.View("Execution") {
			if x["state"] == "FAILED" {
				t.Fatalf("live task failed: %+v", a.Store.Get("TaskResult", d.S(x["result_id"])))
			}
			if x["state"] == "SUCCEEDED" {
				xid = d.S(x["id"])
			}
		}
		if xid != "" {
			allHandled := true
			for _, i := range a.Store.View("Input") {
				if i["state"] != "HANDLED" {
					allHandled = false
				}
			}
			if allHandled {
				break
			}
		}
		if a.Status()["main_blocked"] == true || d.N(a.Status()["blocked_tasks"]) > 0 {
			t.Fatal(a.Status())
		}
		time.Sleep(100 * time.Millisecond)
	}
	cancel()
	if xid == "" || !approved {
		t.Fatalf("live chain incomplete %v", a.Status())
	}
	x := a.Store.Get("Execution", xid)
	b, e := os.ReadFile(filepath.Join(c.WorkspaceRoot, d.S(x["task_id"]), "work/go-live-proof.txt"))
	if e != nil || string(b) != "Secretary_go_demo live proof" {
		t.Fatal("artifact mismatch", e)
	}
	compactionAttempts := 0
	for compactionAttempts < 3 {
		compactionAttempts++
		e = a.Compact(context.Background(), true)
		if e == nil {
			break
		}
	}
	if e != nil {
		t.Fatal("live consciousness (raw retained)", e)
	}
	cs := a.Store.Get("Consciousness", a.ConsciousnessID)
	if len(d.A(cs["items"])) == 0 || len(d.A(cs["covered_event_ids"])) == 0 {
		t.Fatal("compaction not committed")
	}
	calls := d.R{"MAIN": 0, "TASK": 0}
	for _, c := range a.Store.View("Context") {
		key := d.S(c["purpose"])
		calls[key] = d.N(calls[key]) + 1
	}
	report := d.R{"evidence_level": "LIVE_MODEL", "model": a.Cfg.Model, "endpoint": a.Cfg.Endpoint, "main_task_distinct_credentials": true, "duration_seconds": time.Since(start).Seconds(), "artifact_sha256": d.Hash(b), "artifact_exact": true, "execution_outcome": x["state"], "model_contexts": calls, "consciousness_items": len(d.A(cs["items"])), "compaction_attempts": compactionAttempts, "covered_events": len(d.A(cs["covered_event_ids"])), "limitations": []string{"synthetic task; not Master's REAL_USE review", "summary semantic fidelity not independently proven"}}
	if target := os.Getenv("SECRETARY_LIVE_EVIDENCE"); target != "" {
		a.Close()
		if e = os.MkdirAll(target, 0700); e != nil {
			t.Fatal(e)
		}
		if e = os.CopyFS(target, os.DirFS(a.Cfg.DataRoot)); e != nil {
			t.Fatal(e)
		}
		report["retained_evidence"] = "local verification directory (not committed)"
	}
	out := os.Getenv("SECRETARY_LIVE_REPORT")
	if out != "" {
		raw, _ := json.MarshalIndent(report, "", "  ")
		if e = os.WriteFile(out, append(raw, '\n'), 0600); e != nil {
			t.Fatal(e)
		}
	}
	t.Logf("live main/task/approval/artifact/feedback/consciousness passed in %.1fs", time.Since(start).Seconds())
}
