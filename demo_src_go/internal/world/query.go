package world

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"secretary_go_demo/assets"
	d "secretary_go_demo/internal/domain"
	"strings"
	"time"
)

type pageCursor struct {
	Filter    string `json:"filter"`
	Snapshot  string `json:"snapshot"`
	Slot      string `json:"slot"`
	Assertion string `json:"assertion"`
}

func (r *Repository) QueryPage(ctx context.Context, q d.R) (d.R, error) {
	if e := d.Validate("WorldQuery", q); e != nil {
		return nil, e
	}
	filter := d.Clone(q)
	delete(filter, "request_id")
	delete(filter, "cursor")
	filterHash := d.Hash(d.Bytes(filter))
	tx, e := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	var revs string
	e = tx.QueryRow(ctx, "SELECT COALESCE(string_agg(slot_id::text||':'||revision::text,',' ORDER BY slot_id),'') FROM wm.fact_slot WHERE ($1::uuid IS NULL OR subject_id=$1::uuid) AND ($2::text IS NULL OR predicate_key=$2::text)", q["subject_id"], q["predicate_key"]).Scan(&revs)
	if e != nil {
		return nil, e
	}
	digest := d.Hash([]byte(revs))
	cursor := pageCursor{Filter: filterHash, Snapshot: digest}
	var lastSlot, lastAssertion any
	if q["cursor"] != nil {
		b, e := base64.RawURLEncoding.DecodeString(d.S(q["cursor"]))
		if e != nil {
			return nil, e
		}
		if e = d.Decode(b, &cursor); e != nil {
			return nil, e
		}
		if cursor.Filter != filterHash || cursor.Snapshot != digest {
			return nil, errors.New("CONFLICT world cursor snapshot/filter changed; restart query")
		}
		if d.Validate("ID", cursor.Slot) != nil || d.Validate("ID", cursor.Assertion) != nil {
			return nil, errors.New("invalid cursor boundary")
		}
		lastSlot = cursor.Slot
		lastAssertion = cursor.Assertion
	}
	queryBytes, _ := assets.Files.ReadFile("world-query.sql")
	sql := strings.Replace(string(queryBytes), "SELECT s.subject_id", "SELECT s.slot_id AS pagination_slot,count(*) OVER() AS remaining_count,s.subject_id", 1)
	now := time.Now().UTC()
	rows, e := tx.Query(ctx, "SELECT to_jsonb(page) FROM ("+sql+") page", q["subject_id"], q["predicate_key"], d.Time(q["as_of"]), now, q["include_history"], int(d.N(q["limit"])), lastSlot, lastAssertion)
	if e != nil {
		return nil, e
	}
	out := d.Empty("WorldReadResult")
	out["request_id"] = q["request_id"]
	out["observed_db_at"] = now.Format(time.RFC3339Nano)
	facts := []any{}
	var remaining int64
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			rows.Close()
			return nil, e
		}
		var f d.R
		if e = json.Unmarshal(b, &f); e != nil {
			rows.Close()
			return nil, e
		}
		remaining = d.N(f["remaining_count"])
		cursor.Slot = d.S(f["pagination_slot"])
		cursor.Assertion = d.S(f["assertion_id"])
		delete(f, "remaining_count")
		delete(f, "pagination_slot")
		facts = append(facts, normalizeTime(f))
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return nil, e
	}
	out["facts"] = facts
	omitted := remaining - int64(len(facts))
	if omitted > 0 {
		out["omitted_count"] = omitted
		out["next_cursor"] = base64.RawURLEncoding.EncodeToString(d.Bytes(cursor))
	}
	if len(facts) == 0 {
		out["missing_reason"] = "FILTERED"
	}
	if e = d.Validate("WorldReadResult", out); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return out, nil
}
