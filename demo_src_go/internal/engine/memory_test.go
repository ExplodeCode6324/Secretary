package engine

import (
	d "secretary_go_demo/internal/domain"
	"testing"
)

func TestCompactionCoverageAndCommitments(t *testing.T) {
	a := testApp(t, &fakeModel{})
	ref, e := a.Store.Put([]byte("original"), "text/plain")
	if e != nil {
		t.Fatal(e)
	}
	ids := []any{d.ID(), d.ID()}
	item := d.Empty("WorkItem")
	merge(item, d.R{"item_id": d.ID(), "tier": "ACTIVE", "summary": "未完成事项", "source_refs": []any{ref}, "last_activity_at": d.Now(), "pending_owner": "MAIN", "unfulfilled_commitments": []any{"必须保留的承诺"}})
	old := d.R{"items": []any{item}}
	groups := map[string][]string{"loop": {d.S(ids[0]), d.S(ids[1])}}
	candidate := d.R{"items": []any{item}, "covered_event_ids": []any{ids[0]}}
	if e = a.validateCandidate(old, candidate, ids, []any{ref}, groups); e == nil {
		t.Fatal("partial tool group removed")
	}
	candidate["covered_event_ids"] = ids
	if e = a.validateCandidate(old, candidate, ids, []any{ref}, groups); e != nil {
		t.Fatal(e)
	}
	changed := d.Clone(item)
	changed["unfulfilled_commitments"] = []any{}
	candidate["items"] = []any{changed}
	if e = a.validateCandidate(old, candidate, ids, []any{ref}, groups); e == nil {
		t.Fatal("unfinished commitment forgotten")
	}
	candidate["items"] = []any{item}
	candidate["covered_event_ids"] = append(ids, d.ID())
	if e = a.validateCandidate(old, candidate, ids, []any{ref}, groups); e == nil {
		t.Fatal("new input covered by old source")
	}
}
