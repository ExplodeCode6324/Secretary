package engine

import (
	"context"
	"errors"
	"fmt"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/model"
	"secretary_go_demo/internal/store"
	"strings"
	"time"
)

func (a *App) Memory(ctx context.Context, args d.R) (any, error) {
	switch args["source"] {
	case "WORLD":
		if a.World == nil {
			return nil, errors.New("World Model unavailable: configure PostgreSQL")
		}
		if args["world_query"] != nil {
			return a.World.Query(ctx, string(d.Bytes(args["world_query"])))
		}
		return a.World.Query(ctx, d.S(args["query"]))
	case "CONSCIOUSNESS":
		return a.Store.Get("Consciousness", a.ConsciousnessID), nil
	case "OBJECT":
		ref := d.M(args["ref"])
		known := a.Store.KnownRef(ref)
		if !known {
			return nil, errors.New("object is not referenced by committed records")
		}
		b, e := a.Store.Read(ref)
		return d.R{"text": string(b), "ref": ref}, e
	case "OPERATION_LOG":
		out := []any{}
		query := d.S(args["query"])
		id := d.S(args["event_id"])
		events := a.Store.Events()
		for i := len(events) - 1; i >= 0 && len(out) < 30; i-- {
			ev := events[i]
			if id != "" && id != d.S(ev["event_id"]) {
				continue
			}
			b, e := a.Store.Read(d.M(ev["payload"]))
			if e != nil {
				return nil, e
			}
			if query != "" && !strings.Contains(string(b), query) && !strings.Contains(string(d.Bytes(ev)), query) {
				continue
			}
			out = append(out, d.R{"event": ev, "original": string(b)})
		}
		return d.R{"records": out, "limit": 30, "more_possible": len(out) == 30}, nil
	}
	return nil, errors.New("invalid memory source")
}
func (a *App) startCompaction(force bool) {
	a.mu.Lock()
	if a.closing || a.compactRunning || !force && time.Since(a.lastCompaction) < time.Minute {
		a.mu.Unlock()
		return
	}
	a.compactRunning = true
	a.lastCompaction = time.Now()
	a.wg.Add(1)
	a.mu.Unlock()
	go func() {
		defer a.wg.Done()
		defer func() { a.mu.Lock(); a.compactRunning = false; a.mu.Unlock() }()
		a.Error(a.Compact(a.ctx, force))
	}()
}
func (a *App) Maintain() { a.startCompaction(true) }
func (a *App) Compact(ctx context.Context, force bool) error {
	cs := a.Store.Get("Consciousness", a.ConsciousnessID)
	handled := map[string]bool{}
	for _, i := range a.Store.View("Input") {
		if i["state"] == "HANDLED" {
			handled[d.S(i["loop_id"])] = true
		}
	}
	refs := []any{}
	ids := []any{}
	sources := []any{}
	groups := map[string][]string{}
	size := 0
	for _, ev := range a.Store.Events() {
		if d.M(ev["scope"])["session_id"] != a.SessionID || d.Has(cs["covered_event_ids"], d.S(ev["event_id"])) || !handled[d.S(ev["correlation_id"])] {
			continue
		}
		kind := ev["event_type"]
		if kind != "input.loaded" && kind != "model.response" && kind != "tool.result" {
			continue
		}
		b, e := a.Store.Read(d.M(ev["payload"]))
		if e != nil {
			return e
		}
		size += len(b)
		id := d.S(ev["event_id"])
		ids = append(ids, id)
		refs = append(refs, ev["payload"])
		sources = append(sources, d.R{"event_id": id, "loop_id": ev["correlation_id"], "ref": ev["payload"], "original": string(b)})
		groups[d.S(ev["correlation_id"])] = append(groups[d.S(ev["correlation_id"])], id)
	}
	if len(refs) == 0 || !force && size < a.Cfg.CompactionThreshold {
		return nil
	}
	job := d.New("CompactionJob")
	merge(job, d.R{"state": "QUEUED", "session_id": a.SessionID, "base_revision": d.N(cs["revision"]) + 1, "source_event_ids": ids, "source_refs": refs})
	if e := a.Store.Update(func(t *store.Tx) error {
		current := t.Get("Consciousness", a.ConsciousnessID)
		if d.N(current["revision"]) != d.N(cs["revision"]) {
			return errors.New("CONFLICT consciousness changed before source handoff")
		}
		seen := map[string]bool{}
		for _, r := range d.A(current["pending_raw_refs"]) {
			seen[d.S(d.M(r)["sha256"])] = true
		}
		for _, r := range refs {
			if !seen[d.S(d.M(r)["sha256"])] {
				current["pending_raw_refs"] = append(d.A(current["pending_raw_refs"]), r)
			}
		}
		if e := t.Save(current); e != nil {
			return e
		}
		return t.Save(job)
	}); e != nil {
		return e
	}
	jid := d.S(job["id"])
	if e := a.set("CompactionJob", jid, "SUMMARIZING", nil); e != nil {
		return e
	}
	prompt := `Organize Secretary Consciousness by work item, independently from task state. Return ONLY JSON {"items":[WorkItem...],"covered_event_ids":[...]}. WorkItem fields: item_id UUID, tier ACTIVE|QUIET|MINIMAL, summary nonempty, goals/constraints/decisions/open_questions/unfulfilled_commitments arrays of strings, task_refs UUID array, source_event_ids nonempty array of event_id strings copied exactly from the source list (the host resolves immutable references; DO NOT write source_refs or copy hashes), last_activity_at RFC3339, pending_owner MAIN|SCHEDULER|null. Merge related material into the same item. Preserve explicit Master constraints, unresolved decisions, unknown effects, commitments and original evidence references. Do not convert proposals into facts or summaries into authorization. Do not drop unresolved MAIN commitments. Classification depends on relevance and activity, not elapsed time alone. Existing items may be shortened or removed only when no unfulfilled obligation is lost. For an existing item, retain its existing source_refs unchanged and add source_event_ids for new material. Cover only complete loop groups from supplied source IDs. Do not execute tools or create tasks.`
	req := d.R{"model": a.Cfg.Model, "instructions": prompt, "input": []any{d.R{"role": "user", "content": string(d.Bytes(d.R{"now": d.Now(), "base_revision": job["base_revision"], "existing_items": cs["items"], "source": sources}))}}, "store": false, "max_output_tokens": 8192, "text": d.R{"format": d.R{"type": "json_object"}}}
	raw := d.Bytes(req)
	rawRef, e := a.Store.Put(raw, "application/json")
	if e != nil {
		return e
	}
	if e := a.Store.Update(func(t *store.Tx) error {
		_, e := t.Log("consciousness.request", "HOST", a.scope(""), jid, d.R{"job_id": jid, "request": rawRef})
		return e
	}); e != nil {
		return e
	}
	resp, e := a.Model.Complete(ctx, raw, "COMPACTION")
	if e != nil {
		a.set("CompactionJob", jid, "FAILED", d.R{"validation_errors": []any{e.Error()}})
		return e
	}

	responseRef, e := a.Store.Put(resp, "application/json")
	if e != nil {
		return e
	}
	if e = a.Store.Update(func(t *store.Tx) error {
		_, e := t.Log("consciousness.response", "HOST", a.scope(""), jid, d.R{"job_id": jid, "response": responseRef})
		return e
	}); e != nil {
		return e
	}
	var response d.R
	if e = d.Decode(resp, &response); e != nil {
		return e
	}
	text := model.Text(response)
	var candidate d.R
	if e = d.Decode([]byte(text), &candidate); e != nil {
		a.set("CompactionJob", jid, "FAILED", d.R{"validation_errors": []any{"invalid summary JSON"}})
		return e
	}
	ref, e := responseRef, error(nil)
	if e != nil {
		return e
	}
	if e = a.set("CompactionJob", jid, "VALIDATING", d.R{"candidate_ref": ref}); e != nil {
		return e
	}
	if e = a.resolveCandidateReferences(candidate, ids, refs); e != nil {
		a.set("CompactionJob", jid, "FAILED", d.R{"validation_errors": []any{e.Error()}})
		return e
	}
	if e = a.validateCandidate(cs, candidate, ids, refs, groups); e != nil {
		a.set("CompactionJob", jid, "FAILED", d.R{"validation_errors": []any{e.Error()}})
		return e
	}
	e = a.Store.Update(func(t *store.Tx) error {
		current := t.Get("Consciousness", a.ConsciousnessID)
		j := t.Get("CompactionJob", jid)
		if d.N(current["revision"]) != d.N(job["base_revision"]) {
			j["state"] = "STALE"
			return t.Save(j)
		}
		current["items"] = candidate["items"]
		current["covered_event_ids"] = append(d.A(current["covered_event_ids"]), d.A(candidate["covered_event_ids"])...)
		current["last_job_id"] = jid
		coveredRefs := map[string]bool{}
		for i, id := range ids {
			if d.Has(candidate["covered_event_ids"], d.S(id)) {
				coveredRefs[d.S(d.M(refs[i])["sha256"])] = true
			}
		}
		pending := []any{}
		for _, r := range d.A(current["pending_raw_refs"]) {
			if !coveredRefs[d.S(d.M(r)["sha256"])] {
				pending = append(pending, r)
			}
		}
		current["pending_raw_refs"] = pending
		j["state"] = "COMMITTED"
		j["covered_event_ids"] = candidate["covered_event_ids"]
		if e := t.Save(current); e != nil {
			return e
		}
		if e := t.Save(j); e != nil {
			return e
		}
		_, e := t.Log("consciousness.committed", "HOST", a.scope(""), jid, d.R{"job_id": jid, "candidate": candidate, "semantic_quality": "NOT_INDEPENDENTLY_VERIFIED"})
		return e
	})
	if e != nil {
		return e
	}
	s := a.Store.Get("Session", a.SessionID)
	if s["state"] == "CAPACITY_BLOCKED" {
		if _, _, e = a.build("MAIN", "", d.S(s["active_loop_id"])); e == nil {
			a.set("Session", a.SessionID, "RUNNING", d.R{"recovery_error": nil})
			a.Retry()
		}
	}
	return nil
}
func (a *App) validateCandidate(old, candidate d.R, ids, refs []any, groups map[string][]string) error {
	if len(candidate) != 2 || candidate["items"] == nil || candidate["covered_event_ids"] == nil {
		return errors.New("summary requires only items and covered_event_ids")
	}
	allowed := map[string]bool{}
	for _, r := range refs {
		allowed[d.S(d.M(r)["sha256"])] = true
	}
	for _, v := range d.A(old["items"]) {
		for _, r := range d.A(d.M(v)["source_refs"]) {
			allowed[d.S(d.M(r)["sha256"])] = true
		}
	}
	seenItems := map[string]d.R{}
	for _, v := range d.A(candidate["items"]) {
		item := d.M(v)
		if e := d.Validate("WorkItem", item); e != nil {
			return e
		}
		id := d.S(item["item_id"])
		if seenItems[id] != nil {
			return errors.New("duplicate item")
		}
		seenItems[id] = item
		for _, r := range d.A(item["source_refs"]) {
			if !allowed[d.S(d.M(r)["sha256"])] {
				return errors.New("summary invented evidence")
			}
			if _, e := a.Store.Read(d.M(r)); e != nil {
				return e
			}
		}
	}
	for _, v := range d.A(old["items"]) {
		item := d.M(v)
		if item["pending_owner"] == "MAIN" || len(d.A(item["unfulfilled_commitments"])) > 0 {
			next := seenItems[d.S(item["item_id"])]
			if next == nil {
				return errors.New("cannot remove unresolved commitments")
			}
			for _, c := range d.A(item["unfulfilled_commitments"]) {
				if !d.Has(next["unfulfilled_commitments"], d.S(c)) {
					return errors.New("unfulfilled commitment missing; explicit resolution required")
				}
			}
		}
	}
	seen := map[string]bool{}
	for _, id := range d.A(candidate["covered_event_ids"]) {
		s := d.S(id)
		if seen[s] || !d.Has(ids, s) {
			return errors.New("invalid or duplicate coverage")
		}
		seen[s] = true
	}
	if len(seen) == 0 {
		return errors.New("no confirmed coverage")
	}
	for _, g := range groups {
		n := 0
		for _, id := range g {
			if seen[id] {
				n++
			}
		}
		if n != 0 && n != len(g) {
			return fmt.Errorf("partial tool interaction group cannot be removed")
		}
	}
	if len(d.A(candidate["items"])) == 0 {
		return errors.New("empty summary cannot cover material")
	}
	return nil
}

func (a *App) resolveCandidateReferences(candidate d.R, ids, refs []any) error {
	mapping := map[string]any{}
	for i, id := range ids {
		mapping[d.S(id)] = refs[i]
	}
	for _, v := range d.A(candidate["items"]) {
		item := d.M(v)
		if eventIDs, ok := item["source_event_ids"]; ok {
			resolved := d.A(item["source_refs"])
			if resolved == nil {
				resolved = []any{}
			}
			for _, eventID := range d.A(eventIDs) {
				ref, ok := mapping[d.S(eventID)]
				if !ok {
					return errors.New("summary invented source event ID")
				}
				resolved = append(resolved, ref)
			}
			delete(item, "source_event_ids")
			item["source_refs"] = resolved
		}
	}
	return nil
}
