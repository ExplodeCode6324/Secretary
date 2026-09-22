package engine

import (
	"context"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/world"
	"testing"
)

func TestWorldApprovalCommitRecoveryBridge(t *testing.T) {
	dsn := os.Getenv("SECRETARY_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("temporary PostgreSQL required")
	}
	ctx := context.Background()
	repo, e := world.Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer repo.Close()
	if e = repo.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	cfg := DefaultConfig()
	root := t.TempDir()
	cfg.DataRoot = filepath.Join(root, "data")
	cfg.WorkspaceRoot = filepath.Join(root, "workspace")
	a, e := New(cfg, &fakeModel{}, repo)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if _, e = a.Accept(d.ID(), []byte("Register this synthetic Master source for the integration test.")); e != nil {
		t.Fatal(e)
	}
	ev := a.Store.Events()[0]
	c := d.Empty("WorldCatalogChange")
	merge(c, d.R{"kind": "REGISTER_SOURCE", "source_id": d.ID(), "source_kind": "MASTER", "source_key": "bridge-" + d.ID(), "description": "synthetic source", "evidence": []any{d.R{"log_event_id": ev["event_id"], "content": ev["payload"]}}})
	receipt, e := a.ProposeWorld(ctx, d.ID(), c)
	if e != nil {
		t.Fatal(e)
	}
	w := a.Store.Get("WorldCommand", d.S(receipt["object_id"]))
	if w["state"] != "WAIT_AUTH" {
		t.Fatal("world bypassed authorization")
	}
	approve(t, a)
	if e = a.set("WorldCommand", d.S(w["id"]), "READY", nil); e != nil {
		t.Fatal(e)
	}
	if e = a.gate(d.S(w["operation_id"])); e != nil {
		t.Fatal(e)
	}
	if e = a.set("WorldCommand", d.S(w["id"]), "APPLYING", nil); e != nil {
		t.Fatal(e)
	}
	pgReceipt, e := repo.Apply(ctx, d.M(w["change"]))
	if e != nil || pgReceipt["outcome"] != "APPLIED" {
		t.Fatal(pgReceipt, e)
	}
	a.Close()
	a, e = New(cfg, &fakeModel{}, repo)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if e = a.processWorld(); e != nil {
		t.Fatal(e)
	}
	w = a.Store.Get("WorldCommand", d.S(w["id"]))
	if w["state"] != "COMMITTED" {
		t.Fatal("PG/journal bridge did not recover")
	}
	outboxID := d.Stable(d.S(w["id"]) + ":outbox")
	var txn string
	if e = repo.Pool.QueryRow(ctx, "SELECT exported_journal_txn::text FROM wm.audit_outbox WHERE event_id=$1", outboxID).Scan(&txn); e != nil {
		t.Fatal(e)
	}
	if txn == "" || txn != a.Store.TransactionForRequest(outboxID) {
		t.Fatal("outbox does not point at actual journal transaction")
	}
	before := a.Store.Sequence()
	if e = a.processWorld(); e != nil {
		t.Fatal(e)
	}
	if before != a.Store.Sequence() {
		t.Fatal("bridge replay duplicated audit")
	}
}
