package engine

import (
	"context"
	"errors"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
)

func (a *App) ProposeWorld(ctx context.Context, request string, change d.R) (d.R, error) {
	if a.World == nil {
		return nil, errors.New("World Model unavailable")
	}
	c := d.Clone(change)
	typ := d.S(c["record_type"])
	if typ != "WorldChange" && typ != "WorldCatalogChange" {
		return nil, errors.New("canonical WorldChange or WorldCatalogChange required")
	}
	c["schema_version"] = 1
	c["request_id"] = request
	c["change_id"] = d.Stable(request + ":change")
	delete(c, "request_hash")
	c["request_hash"] = d.Hash(d.Bytes(c))
	if e := a.World.Validate(ctx, c); e != nil {
		return nil, e
	}
	evidence := d.A(c["evidence"])
	if typ == "WorldChange" {
		evidence = d.A(d.M(c["provenance"])["evidence"])
	}
	for _, v := range evidence {
		ev := d.M(v)
		found := false
		for _, log := range a.Store.Events() {
			if log["event_id"] == ev["log_event_id"] && d.Hash(d.Bytes(log["payload"])) == d.Hash(d.Bytes(ev["content"])) {
				found = true
				if d.M(c["provenance"])["source_kind"] == "MASTER" && log["actor"] != "MASTER_UI" {
					return nil, errors.New("Master provenance requires original Master input evidence")
				}
			}
		}
		if !found {
			return nil, errors.New("evidence must identify an existing original log payload")
		}
		if _, e := a.Store.Read(d.M(ev["content"])); e != nil {
			return nil, e
		}
	}
	id := d.S(c["change_id"])
	opID := d.Stable(request + ":world-operation")
	op, e := a.operation(opID, "", "world.change", "world/"+nonempty(d.S(c["subject_id"]), nonempty(d.S(c["entity_id"]), d.S(c["source_id"]))), c)
	if e != nil {
		return nil, e
	}
	var out d.R
	e = a.Store.Update(func(t *store.Tx) error {
		var e error
		if out, e = t.Existing(request, d.S(c["request_hash"])); e != nil || out != nil {
			return e
		}
		w := d.New("WorldCommand")
		w["id"] = id
		merge(w, d.R{"state": "RECEIVED", "change": c, "operation_id": op["id"]})
		if e = t.Save(w); e != nil {
			return e
		}
		out, e = t.Receipt(request, d.S(c["request_hash"]), id)
		return e
	})
	if e != nil {
		return nil, e
	}
	if a.Store.Get("WorldCommand", id)["state"] == "RECEIVED" {
		e = a.set("WorldCommand", id, "WAIT_AUTH", nil)
	}
	return out, e
}
func (a *App) processWorld() error {
	if a.World == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(a.ctx, 10e9)
	defer cancel()
	for _, w := range a.Store.View("WorldCommand") {
		id := d.S(w["id"])
		o := a.Store.Get("Operation", d.S(w["operation_id"]))
		if w["state"] == "WAIT_AUTH" {
			if o["state"] == "CANCELLED" {
				if e := a.set("WorldCommand", id, "REJECTED", d.R{"error": "Master rejected operation"}); e != nil {
					return e
				}
				continue
			}
			if o["state"] != "AUTHORIZED" {
				continue
			}
			if e := a.set("WorldCommand", id, "READY", nil); e != nil {
				return e
			}
			w = a.Store.Get("WorldCommand", id)
		}
		if w["state"] == "READY" {
			if o["state"] == "AUTHORIZED" {
				if e := a.gate(d.S(o["id"])); e != nil {
					return e
				}
			}
			if e := a.set("WorldCommand", id, "APPLYING", nil); e != nil {
				return e
			}
			w = a.Store.Get("WorldCommand", id)
		}
		if w["state"] != "APPLYING" && w["state"] != "RETRYABLE_ERROR" {
			continue
		}
		if w["state"] == "RETRYABLE_ERROR" {
			if e := a.set("WorldCommand", id, "APPLYING", nil); e != nil {
				return e
			}
		}
		receipt, e := a.World.Apply(ctx, d.M(w["change"]))
		if e != nil {
			return a.failState(e, "WorldCommand", id, "RETRYABLE_ERROR", d.R{"error": e.Error()})
		}
		if e = a.saveWorldReceipt(id, receipt); e != nil {
			return e
		}
	}
	return a.World.Export(ctx, func(event d.R) error {
		request := d.S(event["event_id"])
		err := a.Store.Update(func(t *store.Tx) error {
			if old, e := t.Existing(request, d.Hash(d.Bytes(event))); e != nil || old != nil {
				return e
			}
			if _, e := t.Log("world.change_committed", "SCHEDULER", d.Scope("", "", ""), request, event); e != nil {
				return e
			}
			_, e := t.Receipt(request, d.Hash(d.Bytes(event)), request)
			return e
		})
		if err == nil {
			event["journal_txn_id"] = a.Store.TransactionForRequest(request)
		}
		return err
	})
}
func (a *App) saveWorldReceipt(id string, receipt d.R) error {
	return a.Store.Update(func(t *store.Tx) error {
		w := t.Get("WorldCommand", id)
		o := t.Get("Operation", d.S(w["operation_id"]))
		ref, e := t.Object(receipt)
		if e != nil {
			return e
		}
		w["receipt_ref"] = ref
		w["error"] = nil
		w["state"] = "COMMITTED"
		o["state"] = "SUCCEEDED"
		o["effect"] = "APPLIED"
		if receipt["outcome"] != "APPLIED" {
			w["state"] = receipt["outcome"]
			o["state"] = "FAILED"
			o["effect"] = "NOT_APPLIED"
		}
		o["receipt"] = ref
		if e = t.Save(w); e != nil {
			return e
		}
		return t.Save(o)
	})
}
