package world

import (
	"context"
	"os"
	d "secretary_go_demo/internal/domain"
	"testing"
	"time"
)

func TestWorldRepositoryTransactions(t *testing.T) {
	dsn := os.Getenv("SECRETARY_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("use scripts/test-postgres.py")
	}
	ctx := context.Background()
	r, e := Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	if e = r.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	evidence := []any{d.R{"log_event_id": d.ID(), "content": d.R{"path": "objects/aa/" + string(make([]byte, 0)), "sha256": d.Hash([]byte("evidence")), "bytes": 8, "media_type": "text/plain"}}}
	source := d.ID()
	entity := d.ID()
	catalog := func(kind string) d.R {
		c := d.Empty("WorldCatalogChange")
		mergeMap(c, d.R{"request_id": d.ID(), "change_id": d.ID(), "request_hash": d.Hash([]byte(d.ID())), "kind": kind, "evidence": evidence})
		return c
	}
	c := catalog("REGISTER_SOURCE")
	mergeMap(c, d.R{"source_id": source, "source_kind": "MASTER", "source_key": "test-master", "description": "synthetic Master"})
	receipt, e := r.Apply(ctx, c)
	if e != nil || receipt["outcome"] != "APPLIED" {
		t.Fatal("source", receipt, e)
	}
	c = catalog("UPSERT_ENTITY")
	mergeMap(c, d.R{"entity_id": entity, "entity_kind": "PERSON", "display_name": "Synthetic Master"})
	receipt, e = r.Apply(ctx, c)
	if e != nil || receipt["outcome"] != "APPLIED" {
		t.Fatal("entity", receipt, e)
	}
	fact := func(value string, rev int64) d.R {
		c := d.Empty("WorldChange")
		mergeMap(c, d.R{"request_id": d.ID(), "change_id": d.ID(), "request_hash": d.Hash([]byte(d.ID())), "source_id": source, "subject_id": entity, "predicate_key": "person.display_name", "expected_revision": rev, "mode": "ASSERT", "value": value, "assertion_id": d.ID(), "provenance": d.R{"source_kind": "MASTER", "source_id": source, "evidence": evidence, "observed_at": nil, "received_at": d.Now(), "scope": "synthetic test", "epistemic": "REPORTED"}, "valid_from": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)})
		return c
	}
	first := fact("Alpha", 0)
	one, e := r.Apply(ctx, first)
	if e != nil || one["outcome"] != "APPLIED" {
		t.Fatal("assert", one, e)
	}
	again, e := r.Apply(ctx, first)
	if e != nil || d.Hash(d.Bytes(one)) != d.Hash(d.Bytes(again)) {
		t.Fatal("idempotence", again, e)
	}
	alter := d.Clone(first)
	alter["request_hash"] = d.Hash([]byte("different"))
	if _, e = r.Apply(ctx, alter); e == nil {
		t.Fatal("same change different hash accepted")
	}
	stale := fact("Old", 0)
	rr, e := r.Apply(ctx, stale)
	if e != nil || rr["outcome"] != "CONFLICT" {
		t.Fatal("stale revision", rr, e)
	}
	support := fact("Alpha", 1)
	rr, e = r.Apply(ctx, support)
	if e != nil || d.M(rr["result"])["status"] != "SUPPORTING" {
		t.Fatal("support", rr, e)
	}
	conflicting := fact("Beta", 2)
	rr, e = r.Apply(ctx, conflicting)
	if e != nil || d.M(rr["result"])["status"] != "CONTESTED" {
		t.Fatal("conflict", rr, e)
	}
	conflictID := d.M(rr["result"])["conflict_id"]
	pageQuery := d.Empty("WorldQuery")
	mergeMap(pageQuery, d.R{"request_id": d.ID(), "subject_id": entity, "as_of": d.Now(), "limit": 1})
	page, e := r.QueryPage(ctx, pageQuery)
	if e != nil || len(d.A(page["facts"])) != 1 || d.N(page["omitted_count"]) != 2 {
		t.Fatal("pagination", page, e)
	}
	pageQuery["cursor"] = page["next_cursor"]
	page2, e := r.QueryPage(ctx, pageQuery)
	if e != nil || d.M(d.A(page2["facts"])[0])["assertion_id"] == d.M(d.A(page["facts"])[0])["assertion_id"] {
		t.Fatal("pagination cursor", page2, e)
	}

	q, e := r.Query(ctx, "")
	if e != nil {
		t.Fatal(e)
	}
	if len(d.A(q["facts"])) != 3 {
		t.Fatal("conflicts hidden")
	}
	for _, v := range d.A(q["facts"]) {
		if d.M(v)["status"] != "CONTESTED" || d.M(v)["freshness"] != "UNKNOWN" {
			t.Fatal("false certainty/freshness")
		}
	}
	resolve := fact("Gamma", 3)
	mergeMap(resolve, d.R{"mode": "CORRECT", "replaces_assertion_id": first["assertion_id"], "resolve_conflict_id": conflictID, "resolution_note": "Master explicitly corrected all candidates with retained evidence"})
	rr, e = r.Apply(ctx, resolve)
	if e != nil || d.M(rr["result"])["status"] != "ACTIVE" {
		t.Fatal("resolve", rr, e)
	}
	if _, e = r.QueryPage(ctx, pageQuery); e == nil {
		t.Fatal("changed snapshot cursor accepted")
	}
	retract := fact("Gamma", 4)
	mergeMap(retract, d.R{"mode": "RETRACT", "assertion_id": resolve["assertion_id"], "replaces_assertion_id": resolve["assertion_id"]})
	rr, e = r.Apply(ctx, retract)
	if e != nil || d.M(rr["result"])["status"] != "RETRACTED" {
		t.Fatal("retract", rr, e)
	}
	invalid := fact("Wrong", 5)
	invalid["value"] = 42
	if _, e = r.Apply(ctx, invalid); e == nil {
		t.Fatal("predicate wrong value accepted")
	}
	exported := 0
	failOnce := true
	e = r.Export(ctx, func(d.R) error {
		if failOnce {
			failOnce = false
			return context.Canceled
		}
		return nil
	})
	if e == nil {
		t.Fatal("export failure lost")
	}
	e = r.Export(ctx, func(ev d.R) error {
		if ev["event_id"] == nil || ev["payload"] == nil {
			t.Fatal("missing outbox content")
		}
		ev["journal_txn_id"] = d.ID()
		exported++
		return nil
	})
	if e != nil || exported != 8 {
		t.Fatalf("export count %d: %v", exported, e)
	}
	if e = r.Export(ctx, func(d.R) error { t.Fatal("outbox reexported"); return nil }); e != nil {
		t.Fatal(e)
	}
}
func mergeMap(a, b d.R) {
	for k, v := range b {
		a[k] = v
	}
}
