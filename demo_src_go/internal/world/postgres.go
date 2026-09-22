// Package world is the PostgreSQL-only long-term World Model repository.
package world

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"secretary_go_demo/assets"
	d "secretary_go_demo/internal/domain"
	"strings"
	"time"
)

type Repository struct{ Pool *pgxpool.Pool }

func Open(ctx context.Context, dsn string) (*Repository, error) {
	p, e := pgxpool.New(ctx, dsn)
	if e != nil {
		return nil, e
	}
	if e = p.Ping(ctx); e != nil {
		p.Close()
		return nil, fmt.Errorf("World Model database unavailable")
	}
	return &Repository{p}, nil
}
func (r *Repository) Close() { r.Pool.Close() }
func (r *Repository) Migrate(ctx context.Context) error {
	var exists bool
	if e := r.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='wm')").Scan(&exists); e != nil {
		return e
	}
	if exists {
		var v int
		if e := r.Pool.QueryRow(ctx, "SELECT max(version) FROM wm.schema_version").Scan(&v); e != nil {
			return e
		}
		if v != 1 {
			return errors.New("unsupported world schema")
		}
		return nil
	}
	for _, f := range []string{"001_world_model.sql", "002_predicates.sql"} {
		b, e := assets.Files.ReadFile(f)
		if e != nil {
			return e
		}
		if _, e = r.Pool.Exec(ctx, string(b)); e != nil {
			return e
		}
	}
	return nil
}
func (r *Repository) Validate(ctx context.Context, c d.R) error {
	if e := d.Validate(d.S(c["record_type"]), c); e != nil {
		return e
	}
	if c["record_type"] == "WorldCatalogChange" {
		if c["kind"] == "UPSERT_ENTITY" && (c["entity_id"] == nil || c["entity_kind"] == nil || c["display_name"] == nil) {
			return errors.New("entity fields required")
		}
		if c["kind"] == "REGISTER_SOURCE" && (c["source_id"] == nil || c["source_kind"] == nil || c["source_key"] == nil || c["description"] == nil) {
			return errors.New("source fields required")
		}
		return nil
	}
	p := d.M(c["provenance"])
	if p["source_id"] != c["source_id"] {
		return errors.New("source mismatch")
	}
	var sourceKind string
	if e := r.Pool.QueryRow(ctx, "SELECT kind FROM wm.source WHERE source_id=$1 AND retired_at IS NULL", c["source_id"]).Scan(&sourceKind); e != nil {
		return errors.New("source not registered")
	}
	if sourceKind != p["source_kind"] {
		return errors.New("provenance kind mismatch")
	}
	if sourceKind == "MODEL_INFERENCE" && p["epistemic"] != "INFERRED" && p["epistemic"] != "UNRESOLVED" {
		return errors.New("model inference cannot claim observed/reported")
	}
	if p["epistemic"] == "OBSERVED" && p["observed_at"] == nil {
		return errors.New("observation time required")
	}
	var schema []byte
	var typ string
	if e := r.Pool.QueryRow(ctx, "SELECT value_schema,value_type FROM wm.predicate WHERE predicate_key=$1", c["predicate_key"]).Scan(&schema, &typ); e != nil {
		return errors.New("predicate not registered")
	}

	var subjectKind, cardinality string
	var allowedKinds []string
	if e := r.Pool.QueryRow(ctx, "SELECT e.kind,p.subject_kinds,p.cardinality FROM wm.entity e CROSS JOIN wm.predicate p WHERE e.entity_id=$1 AND e.retired_at IS NULL AND p.predicate_key=$2", c["subject_id"], c["predicate_key"]).Scan(&subjectKind, &allowedKinds, &cardinality); e != nil {
		return errors.New("subject/predicate not available")
	}
	kindAllowed := false
	for _, k := range allowedKinds {
		if k == subjectKind {
			kindAllowed = true
		}
	}
	if !kindAllowed {
		return errors.New("subject kind incompatible with predicate")
	}
	if cardinality == "SINGLE" && d.S(c["scope_key"]) != "" || cardinality == "MULTI" && d.S(c["scope_key"]) == "" {
		return errors.New("scope incompatible with predicate cardinality")
	}
	if c["valid_to"] != nil && !d.Time(c["valid_to"]).After(d.Time(c["valid_from"])) {
		return errors.New("invalid fact validity interval")
	}
	if c["fresh_until"] != nil && d.Time(c["fresh_until"]).Before(d.Time(c["valid_from"])) {
		return errors.New("fresh_until predates validity")
	}
	if typ == "ENTITY" {
		if c["object_entity_id"] == nil || c["value"] != nil {
			return errors.New("relationship requires entity only")
		}
		var targetExists bool
		if e := r.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM wm.entity WHERE entity_id=$1 AND retired_at IS NULL)", c["object_entity_id"]).Scan(&targetExists); e != nil {
			return e
		}
		if !targetExists {
			return errors.New("relationship object entity missing")
		}
	} else if c["mode"] != "RETRACT" {
		if c["object_entity_id"] != nil || c["value"] == nil {
			return errors.New("scalar requires value only")
		}
		var s any
		json.Unmarshal(schema, &s)
		if e := d.ValidateSchema(s, c["value"]); e != nil {
			return e
		}
	}
	if c["mode"] == "CORRECT" || c["mode"] == "RETRACT" {
		if c["replaces_assertion_id"] == nil {
			return errors.New("correction/retraction must identify original assertion")
		}
	}
	if c["resolve_conflict_id"] != nil && (c["mode"] != "CORRECT" || strings.TrimSpace(d.S(c["resolution_note"])) == "") {
		return errors.New("conflict resolution requires correction and reason")
	}
	return nil
}
func (r *Repository) Apply(ctx context.Context, c d.R) (d.R, error) {
	tx, e := r.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", d.S(c["change_id"])); e != nil {
		return nil, e
	}
	var hash, outcome string
	var result []byte
	e = tx.QueryRow(ctx, "SELECT request_hash,outcome,result FROM wm.change_receipt WHERE change_id=$1", c["change_id"]).Scan(&hash, &outcome, &result)
	if e == nil {
		if hash != d.S(c["request_hash"]) {
			return nil, errors.New("CONFLICT change_id different request")
		}
		var v d.R
		json.Unmarshal(result, &v)
		return d.R{"outcome": outcome, "result": v, "change_id": c["change_id"]}, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	if e = r.Validate(ctx, c); e != nil {
		return nil, e
	}
	if _, e = tx.Exec(ctx, "SAVEPOINT mutation"); e != nil {
		return nil, e
	}
	var res d.R
	if c["record_type"] == "WorldCatalogChange" {
		outcome, res, e = r.catalog(ctx, tx, c)
	} else {
		outcome, res, e = r.fact(ctx, tx, c)
	}
	if e != nil {
		if _, rollback := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT mutation"); rollback != nil {
			return nil, rollback
		}
		outcome = "REJECTED"
		res = d.R{"reason": "database rejected world mutation", "detail": e.Error()}
	}
	receipt := d.R{"change_id": c["change_id"], "outcome": outcome, "result": res}
	if _, e = tx.Exec(ctx, "INSERT INTO wm.change_receipt(change_id,request_id,request_hash,outcome,result) VALUES($1,$2,$3,$4,$5)", c["change_id"], c["request_id"], c["request_hash"], outcome, d.Bytes(res)); e != nil {
		return nil, e
	}
	payload := d.R{"change": c, "receipt": receipt, "after": res}
	if _, e = tx.Exec(ctx, "INSERT INTO wm.audit_outbox(event_id,change_id,payload) VALUES($1,$2,$3)", d.Stable(d.S(c["change_id"])+":outbox"), c["change_id"], d.Bytes(payload)); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, fmt.Errorf("world commit not confirmed: %w", e)
	}
	return receipt, nil
}
func (r *Repository) catalog(ctx context.Context, tx pgx.Tx, c d.R) (string, d.R, error) {
	if c["kind"] == "REGISTER_SOURCE" {
		var count int
		if e := tx.QueryRow(ctx, "SELECT count(*) FROM wm.source WHERE source_id=$1 OR source_key=$2", c["source_id"], c["source_key"]).Scan(&count); e != nil {
			return "", nil, e
		}
		if count > 0 || d.N(c["expected_revision"]) != 0 {
			return "CONFLICT", d.R{"reason": "source already exists or invalid revision"}, nil
		}
		_, e := tx.Exec(ctx, "INSERT INTO wm.source(source_id,kind,source_key,description) VALUES($1,$2,$3,$4)", c["source_id"], c["source_kind"], c["source_key"], c["description"])
		return "APPLIED", d.R{"source_id": c["source_id"]}, e
	}
	var rev int64
	var kind string
	e := tx.QueryRow(ctx, "SELECT revision,kind FROM wm.entity WHERE entity_id=$1 FOR UPDATE", c["entity_id"]).Scan(&rev, &kind)
	if errors.Is(e, pgx.ErrNoRows) {
		if d.N(c["expected_revision"]) != 0 {
			return "CONFLICT", d.R{"reason": "entity absent"}, nil
		}
		_, e = tx.Exec(ctx, "INSERT INTO wm.entity(entity_id,kind,display_name,external_key) VALUES($1,$2,$3,$4)", c["entity_id"], c["entity_kind"], c["display_name"], c["external_key"])
		return "APPLIED", d.R{"entity_id": c["entity_id"], "revision": 1}, e
	}
	if e != nil {
		return "", nil, e
	}
	if rev != d.N(c["expected_revision"]) || kind != c["entity_kind"] {
		return "CONFLICT", d.R{"entity_id": c["entity_id"], "revision": rev}, nil
	}
	_, e = tx.Exec(ctx, "UPDATE wm.entity SET display_name=$2,external_key=$3,revision=revision+1,updated_at=now() WHERE entity_id=$1", c["entity_id"], c["display_name"], c["external_key"])
	return "APPLIED", d.R{"entity_id": c["entity_id"], "revision": rev + 1}, e
}
func nullableTime(v any) any {
	if v == nil {
		return nil
	}
	return d.Time(v)
}
func (r *Repository) fact(ctx context.Context, tx pgx.Tx, c d.R) (string, d.R, error) {
	slot := d.ID()
	if _, e := tx.Exec(ctx, "INSERT INTO wm.fact_slot(slot_id,subject_id,predicate_key,scope_key) VALUES($1,$2,$3,$4) ON CONFLICT(subject_id,predicate_key,scope_key) DO NOTHING", slot, c["subject_id"], c["predicate_key"], c["scope_key"]); e != nil {
		return "", nil, e
	}
	var rev int64
	if e := tx.QueryRow(ctx, "SELECT slot_id::text,revision FROM wm.fact_slot WHERE subject_id=$1 AND predicate_key=$2 AND scope_key=$3 FOR UPDATE", c["subject_id"], c["predicate_key"], c["scope_key"]).Scan(&slot, &rev); e != nil {
		return "", nil, e
	}
	if rev != d.N(c["expected_revision"]) {
		return "CONFLICT", d.R{"slot_id": slot, "revision": rev}, nil
	}
	rows, e := tx.Query(ctx, "SELECT a.assertion_id::text,s.status,a.value,a.object_entity_id::text FROM wm.assertion a JOIN wm.assertion_state s USING(assertion_id,slot_id) WHERE a.slot_id=$1 AND s.status IN ('ACTIVE','SUPPORTING','CONTESTED') ORDER BY a.assertion_id", slot)
	if e != nil {
		return "", nil, e
	}
	type candidate struct {
		id, state string
		value     []byte
		obj       *string
	}
	var before []candidate
	beforeJSON := []any{}
	for rows.Next() {
		var x candidate
		if e = rows.Scan(&x.id, &x.state, &x.value, &x.obj); e != nil {
			rows.Close()
			return "", nil, e
		}
		before = append(before, x)
		beforeJSON = append(beforeJSON, d.R{"assertion_id": x.id, "status": x.state, "value": json.RawMessage(x.value), "object_entity_id": x.obj})
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return "", nil, e
	}
	mode := d.S(c["mode"])
	oldID := d.S(c["replaces_assertion_id"])
	if mode != "ASSERT" {
		found := false
		for _, x := range before {
			if x.id == oldID {
				found = true
			}
		}
		if !found {
			return "REJECTED", d.R{"reason": "replaced assertion is not an active candidate in this slot"}, nil
		}
	}
	if _, e = tx.Exec(ctx, "UPDATE wm.fact_slot SET revision=revision+1 WHERE slot_id=$1", slot); e != nil {
		return "", nil, e
	}
	rev++
	setState := func(id, status string) error {
		_, e := tx.Exec(ctx, "UPDATE wm.assertion_state SET status=$2,revision=revision+1,changed_by=$3,changed_at=now() WHERE assertion_id=$1", id, status, c["change_id"])
		return e
	}
	if mode == "RETRACT" {
		if c["assertion_id"] != c["replaces_assertion_id"] {
			return "", nil, errors.New("retraction assertion mismatch")
		}
		if e = setState(oldID, "RETRACTED"); e != nil {
			return "", nil, e
		}
		return "APPLIED", d.R{"slot_id": slot, "revision": rev, "assertion_id": oldID, "status": "RETRACTED", "before": beforeJSON}, nil
	}
	status := "ACTIVE"
	var openConflict string
	e = tx.QueryRow(ctx, "SELECT conflict_id::text FROM wm.conflict WHERE slot_id=$1 AND status='OPEN'", slot).Scan(&openConflict)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return "", nil, e
	}
	resolve := d.S(c["resolve_conflict_id"])
	if resolve != "" {
		if resolve != openConflict {
			return "", nil, errors.New("conflict not open in slot")
		}
		for _, x := range before {
			if e = setState(x.id, "SUPERSEDED"); e != nil {
				return "", nil, e
			}
		}
		if _, e = tx.Exec(ctx, "UPDATE wm.conflict SET status='RESOLVED',resolved_by=$2,resolution_note=$3 WHERE conflict_id=$1", resolve, c["change_id"], c["resolution_note"]); e != nil {
			return "", nil, e
		}
		openConflict = ""
		before = nil
	} else if mode == "CORRECT" {
		if e = setState(oldID, "SUPERSEDED"); e != nil {
			return "", nil, e
		}
		kept := []candidate{}
		for _, x := range before {
			if x.id != oldID {
				kept = append(kept, x)
			}
		}
		before = kept
	}
	equivalent := func(x candidate) bool {
		if x.obj != nil {
			return *x.obj == d.S(c["object_entity_id"])
		}
		var v any
		json.Unmarshal(x.value, &v)
		return d.Hash(d.Bytes(v)) == d.Hash(d.Bytes(c["value"]))
	}
	if len(before) > 0 {
		allEqual := true
		hasActive := false
		for _, x := range before {
			if !equivalent(x) || x.state == "CONTESTED" {
				allEqual = false
			}
			if x.state == "ACTIVE" {
				hasActive = true
			}
		}
		if mode == "ASSERT" && allEqual && hasActive && openConflict == "" {
			status = "SUPPORTING"
		} else {
			status = "CONTESTED"
			for _, x := range before {
				if e = setState(x.id, "CONTESTED"); e != nil {
					return "", nil, e
				}
			}
		}
	}
	if openConflict != "" && resolve == "" {
		status = "CONTESTED"
	}
	p := d.M(c["provenance"])
	var val any
	if c["value"] != nil {
		val = d.Bytes(c["value"])
	}
	_, e = tx.Exec(ctx, `INSERT INTO wm.assertion(assertion_id,slot_id,slot_revision,source_id,change_id,value,object_entity_id,epistemic,observed_at,received_at,valid_from,valid_to,fresh_until,scope_description,replaces_assertion_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, c["assertion_id"], slot, rev, c["source_id"], c["change_id"], val, c["object_entity_id"], p["epistemic"], nullableTime(p["observed_at"]), d.Time(p["received_at"]), d.Time(c["valid_from"]), nullableTime(c["valid_to"]), nullableTime(c["fresh_until"]), p["scope"], c["replaces_assertion_id"])
	if e != nil {
		return "", nil, e
	}
	_, e = tx.Exec(ctx, "INSERT INTO wm.assertion_state(assertion_id,slot_id,status,changed_by) VALUES($1,$2,$3,$4)", c["assertion_id"], slot, status, c["change_id"])
	if e != nil {
		return "", nil, e
	}
	for _, v := range d.A(p["evidence"]) {
		ev := d.M(v)
		ref := d.M(ev["content"])
		eid := d.Stable(d.S(ev["log_event_id"]) + d.S(ref["sha256"]))
		_, e = tx.Exec(ctx, "INSERT INTO wm.evidence(evidence_id,log_event_id,object_path,sha256,media_type,byte_count) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(log_event_id,sha256) DO NOTHING", eid, ev["log_event_id"], ref["path"], ref["sha256"], ref["media_type"], d.N(ref["bytes"]))
		if e != nil {
			return "", nil, e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO wm.assertion_evidence(assertion_id,evidence_id) SELECT $1,evidence_id FROM wm.evidence WHERE log_event_id=$2 AND sha256=$3", c["assertion_id"], ev["log_event_id"], ref["sha256"]); e != nil {
			return "", nil, e
		}
	}
	if status == "CONTESTED" {
		if openConflict == "" {
			openConflict = d.ID()
			if _, e = tx.Exec(ctx, "INSERT INTO wm.conflict(conflict_id,slot_id,status,opened_by) VALUES($1,$2,'OPEN',$3)", openConflict, slot, c["change_id"]); e != nil {
				return "", nil, e
			}
		}
		if _, e = tx.Exec(ctx, "INSERT INTO wm.conflict_member(conflict_id,slot_id,assertion_id) SELECT $1,slot_id,assertion_id FROM wm.assertion_state WHERE slot_id=$2 AND status='CONTESTED' ON CONFLICT DO NOTHING", openConflict, slot); e != nil {
			return "", nil, e
		}
	}
	return "APPLIED", d.R{"slot_id": slot, "revision": rev, "assertion_id": c["assertion_id"], "status": status, "conflict_id": openConflict, "before": beforeJSON}, nil
}
func (r *Repository) Query(ctx context.Context, query string) (d.R, error) {
	if strings.HasPrefix(strings.TrimSpace(query), "{") {
		var q d.R
		if e := d.Decode([]byte(query), &q); e != nil {
			return nil, e
		}
		return r.QueryPage(ctx, q)
	}
	out := d.R{"observed_db_at": d.Now(), "facts": []any{}, "entities": []any{}, "sources": []any{}, "predicates": []any{}, "limit": 100, "truncated": false, "write_contracts": d.R{"WorldChange": d.Empty("WorldChange"), "WorldCatalogChange": d.Empty("WorldCatalogChange")}}
	for _, spec := range []struct{ key, sql string }{{"entities", "SELECT to_jsonb(e) FROM wm.entity e WHERE $1='' OR display_name ILIKE '%'||$1||'%' ORDER BY entity_id LIMIT 101"}, {"sources", "SELECT to_jsonb(s) FROM wm.source s WHERE $1='' OR description ILIKE '%'||$1||'%' ORDER BY source_id LIMIT 101"}, {"predicates", "SELECT to_jsonb(p) FROM wm.predicate p WHERE $1='' OR predicate_key ILIKE '%'||$1||'%' ORDER BY predicate_key LIMIT 101"}, {"facts", `SELECT jsonb_build_object('assertion_id',a.assertion_id,'slot_id',a.slot_id,'subject_id',f.subject_id,'predicate_key',f.predicate_key,'scope_key',f.scope_key,'slot_revision',f.revision,'value',a.value,'object_entity_id',a.object_entity_id,'status',s.status,'epistemic',a.epistemic,'source_id',a.source_id,'observed_at',a.observed_at,'valid_from',a.valid_from,'valid_to',a.valid_to,'fresh_until',a.fresh_until,'freshness',CASE WHEN a.fresh_until IS NULL THEN 'UNKNOWN' WHEN a.fresh_until>now() THEN 'CURRENT' ELSE 'STALE' END,'evidence',(SELECT jsonb_agg(to_jsonb(e)) FROM wm.evidence e JOIN wm.assertion_evidence ae USING(evidence_id) WHERE ae.assertion_id=a.assertion_id)) FROM wm.assertion a JOIN wm.assertion_state s USING(assertion_id,slot_id) JOIN wm.fact_slot f USING(slot_id) JOIN wm.entity en ON en.entity_id=f.subject_id WHERE s.status IN ('ACTIVE','SUPPORTING','CONTESTED') AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now()) AND ($1='' OR en.display_name ILIKE '%'||$1||'%' OR f.predicate_key ILIKE '%'||$1||'%') ORDER BY a.slot_id,a.assertion_id LIMIT 101`}} {
		rows, e := r.Pool.Query(ctx, spec.sql, query)
		if e != nil {
			return nil, e
		}
		items := []any{}
		for rows.Next() {
			var b []byte
			if e = rows.Scan(&b); e != nil {
				rows.Close()
				return nil, e
			}
			var v any
			json.Unmarshal(b, &v)
			if len(items) < 100 {
				items = append(items, normalizeTime(v))
			} else {
				out["truncated"] = true
			}
		}
		rows.Close()
		if e = rows.Err(); e != nil {
			return nil, e
		}
		out[spec.key] = items
	}
	return out, nil
}
func normalizeTime(v any) any {
	switch x := v.(type) {
	case map[string]any:
		for k, v := range x {
			x[k] = normalizeTime(v)
		}
	case []any:
		for i, v := range x {
			x[i] = normalizeTime(v)
		}
	case string:
		if t, e := time.Parse(time.RFC3339Nano, x); e == nil {
			return t.UTC().Format(time.RFC3339Nano)
		}
	}
	return v
}
func (r *Repository) Export(ctx context.Context, save func(d.R) error) error {
	rows, e := r.Pool.Query(ctx, "SELECT event_id::text,payload FROM wm.audit_outbox WHERE exported_at IS NULL ORDER BY created_at,event_id LIMIT 100")
	if e != nil {
		return e
	}
	pending := []d.R{}
	for rows.Next() {
		var id string
		var b []byte
		if e = rows.Scan(&id, &b); e != nil {
			rows.Close()
			return e
		}
		var payload d.R
		json.Unmarshal(b, &payload)
		pending = append(pending, d.R{"event_id": id, "payload": payload})
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return e
	}
	for _, v := range pending {
		if e = save(v); e != nil {
			return e
		}
		if d.S(v["journal_txn_id"]) == "" {
			return errors.New("durable journal transaction identity required")
		}
		if _, e = r.Pool.Exec(ctx, "UPDATE wm.audit_outbox SET exported_at=now(),exported_journal_txn=$2 WHERE event_id=$1 AND exported_at IS NULL", v["event_id"], d.S(v["journal_txn_id"])); e != nil {
			return e
		}
	}
	return nil
}
