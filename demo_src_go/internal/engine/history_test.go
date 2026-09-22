package engine

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
)

func historyInput(t *testing.T, a *App, text string) {
	t.Helper()
	if _, err := a.Accept(d.ID(), []byte(text)); err != nil {
		t.Fatal(err)
	}
	if err := a.runMain(context.Background()); err != nil {
		t.Fatal(err)
	}
}
func TestForgottenIdentityOriginalRecallAfterRestart(t *testing.T) {
	a := testApp(t, &fakeModel{})
	historyInput(t, a, "P-A 与 P-B 都叫林宁，P-A 是 Orion 设计联系人，P-B 是 Lyra 财务联系人；不是同一人。")
	historyInput(t, a, "Orion 发布日候选 D20 / D22，尚未解决分歧。")
	covered := []any{}
	for _, ev := range a.Store.Events() {
		if ev["event_type"] == "input.loaded" || ev["event_type"] == "model.response" {
			covered = append(covered, ev["event_id"])
		}
	}
	// Deterministically reproduce the failed model summary: ordinary identity item
	// has exited Consciousness, while raw events remain in durable history.
	if err := a.Store.Update(func(tx *store.Tx) error {
		cs := tx.Get("Consciousness", a.ConsciousnessID)
		cs["covered_event_ids"] = covered
		cs["items"] = []any{}
		return tx.Save(cs)
	}); err != nil {
		t.Fatal(err)
	}
	cfg := a.Cfg
	a.Close()
	b, err := New(cfg, &fakeModel{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if err = b.bootHost(); err != nil {
		t.Fatal(err)
	}
	result, err := b.Memory(context.Background(), d.R{"source": "OPERATION_LOG", "query": "林宁 Orion Lyra"})
	if err != nil {
		t.Fatal(err)
	}
	text := string(d.Bytes(result))
	for _, want := range []string{"P-A", "P-B", "设计联系人", "财务联系人"} {
		if !strings.Contains(text, want) {
			t.Fatal("forgotten original not retrieved", want)
		}
	}
	historyInput(t, b, "Orion 的 P-A 和 P-B 分别是什么角色？")
	contexts := b.Store.View("Context")
	found := false
	for _, c := range contexts {
		raw, err := b.Store.Read(d.M(c["raw_context"]))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "Retrieved original history") {
			found = true
			for _, want := range []string{"设计联系人", "财务联系人"} {
				if !strings.Contains(string(raw), want) {
					t.Fatal("auto recall missing identity", want)
				}
			}
		}
	}
	if !found {
		t.Fatal("no original recall in actual immutable model Context")
	}
	if len(d.A(b.Store.Get("Consciousness", b.ConsciousnessID)["items"])) != 0 {
		t.Fatal("retrieval silently recreated permanent memory")
	}
}
func TestHistoryPaginationSnapshotAndMissingIsNotNeverProvided(t *testing.T) {
	a := testApp(t, &fakeModel{})
	for _, s := range []string{"Orion older statement", "Orion newer conflicting statement", "unrelated"} {
		historyInput(t, a, s)
	}
	first, err := a.searchHistory(context.Background(), d.R{"query": "ORION", "limit": 1}, nil, 16000)
	if err != nil {
		t.Fatal(err)
	}
	if d.N(first["matched_count"]) != 2 || first["next_cursor"] == nil {
		t.Fatal(first)
	}
	firstID := d.M(d.M(d.A(first["records"])[0])["event"])["event_id"]
	historyInput(t, a, "Orion third statement after cursor")
	second, err := a.searchHistory(context.Background(), d.R{"query": "ORION", "limit": 1, "cursor": first["next_cursor"]}, nil, 16000)
	if err != nil {
		t.Fatal(err)
	}
	if d.N(second["matched_count"]) != 2 || d.M(d.M(d.A(second["records"])[0])["event"])["event_id"] == firstID {
		t.Fatal("cursor repeated or leaked later event")
	}
	if _, err = a.searchHistory(context.Background(), d.R{"query": "changed", "cursor": first["next_cursor"]}, nil, 16000); err == nil {
		t.Fatal("cursor accepted another query")
	}
	empty, err := a.searchHistory(context.Background(), d.R{"query": "absent-nonexistent-term"}, nil, 16000)
	if err != nil || len(d.A(empty["records"])) != 0 || !strings.Contains(d.S(empty["search_limitations"]), "does not mean") {
		t.Fatal("empty search lost uncertainty", err)
	}
}

func TestHistoryExactCompoundEntityIDs(t *testing.T) {
	a := testApp(t, &fakeModel{})
	historyInput(t, a, "P-A 是 Orion 设计联系人。")
	historyInput(t, a, "P-B 是 Lyra 财务联系人。")
	for query, want := range map[string]string{"P-A": "Orion", "p-b": "Lyra"} {
		result, err := a.searchHistory(context.Background(), d.R{"query": query, "event_type": "input.loaded"}, nil, 16000)
		if err != nil {
			t.Fatal(err)
		}
		if d.N(result["matched_count"]) != 1 || !strings.Contains(string(d.Bytes(result)), want) {
			t.Fatalf("exact entity %q did not select its own original: %v", query, result)
		}
	}
}

func TestBroadMemoryBatteryRecallsLowRankedIdentity(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/memory-battery.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Events   []string `json:"events"`
		Question string   `json:"question"`
	}
	if err = d.Decode(raw, &fixture); err != nil {
		// The fixture also contains controller-only gold; decode selected fields without
		// feeding or consulting gold in this production-context regression.
		if err = json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
	}
	a := testApp(t, &fakeModel{})
	for _, text := range fixture.Events {
		historyInput(t, a, text)
	}
	if err = a.Store.Update(func(tx *store.Tx) error {
		cs := tx.Get("Consciousness", a.ConsciousnessID)
		ids := []any{}
		for _, ev := range a.Store.EventsUnsafe(tx) {
			if ev["event_type"] == "input.loaded" || ev["event_type"] == "model.response" {
				ids = append(ids, ev["event_id"])
			}
		}
		cs["items"] = []any{}
		cs["covered_event_ids"] = ids
		return tx.Save(cs)
	}); err != nil {
		t.Fatal(err)
	}
	historyInput(t, a, fixture.Question)
	cs := a.Store.Get("Session", a.SessionID)
	c := a.Store.Get("Context", d.S(cs["last_context_id"]))
	request, err := a.Store.Read(d.M(c["raw_context"]))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(request), "P-A是Orion设计联系人") || !strings.Contains(string(request), "P-B是Lyra财务联系人") {
		t.Fatal("broad compound question lost low-ranked identity evidence to retrieval cutoff")
	}
}
