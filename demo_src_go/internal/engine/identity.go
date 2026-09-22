package engine

import (
	"fmt"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
)

// DispatchIdentity is a host-issued fence, not an editable model argument.
// A resumed execution gets a new attempt; an operation can follow it only through
// the host's explicit, journalled NOT_STARTED handoff, never inside the final gate.
type DispatchIdentity struct {
	Epoch   int64
	Attempt string
}

func identity(r d.R) DispatchIdentity {
	return DispatchIdentity{d.N(r["owner_epoch"]), d.S(r["attempt_id"])}
}
func (a *App) validateDispatchIdentity(t *store.Tx, o d.R) error {
	got := identity(o)
	if got.Epoch != a.Store.Epoch() {
		return fmt.Errorf("dispatch owner epoch mismatch")
	}
	scope := d.M(o["scope"])
	if id := d.S(scope["execution_id"]); id != "" {
		x := t.Get("Execution", id)
		if x == nil || x["task_id"] != scope["task_id"] || got.Attempt == "" || got != identity(x) {
			return fmt.Errorf("dispatch execution/attempt identity mismatch")
		}
	} else {
		s := t.Get("Session", a.SessionID)
		if scope["session_id"] != a.SessionID || got.Attempt != "" || d.N(s["owner_epoch"]) != got.Epoch {
			return fmt.Errorf("dispatch session identity mismatch")
		}
	}
	return nil
}
func (a *App) rebindPendingOperations(t *store.Tx, scope d.R, from, to DispatchIdentity, reason string) error {
	for _, o := range t.List("Operation") {
		if d.Hash(d.Bytes(o["scope"])) != d.Hash(d.Bytes(scope)) {
			continue
		}
		if o["state"] != "PREPARED" && o["state"] != "WAIT_AUTH" && o["state"] != "AUTHORIZED" {
			continue
		}
		if o["effect"] != "NOT_STARTED" || identity(o) != from {
			return fmt.Errorf("RECOVERY_BLOCKED operation identity/effect mismatch before handoff")
		}
		o["owner_epoch"] = to.Epoch
		if to.Attempt == "" {
			o["attempt_id"] = nil
		} else {
			o["attempt_id"] = to.Attempt
		}
		if err := t.Save(o); err != nil {
			return err
		}
		if _, err := t.Log("operation.rebound", "HOST", scope, d.S(o["id"]), d.R{"operation_id": o["id"], "from": from, "to": to, "reason": reason, "effect": "NOT_STARTED"}); err != nil {
			return err
		}
	}
	return nil
}
func (a *App) adoptRecoveredExecutions(t *store.Tx) error {
	for _, x := range t.List("Execution") {
		if isTerminal(d.S(x["state"])) {
			continue
		}
		from := identity(x)
		to := DispatchIdentity{a.Store.Epoch(), from.Attempt}
		if from == to {
			continue
		}
		if err := a.rebindPendingOperations(t, d.Scope("", d.S(x["task_id"]), d.S(x["id"])), from, to, "exclusive owner restart; no dispatched effects rebound"); err != nil {
			return err
		}
		x["owner_epoch"] = to.Epoch
		if err := t.Save(x); err != nil {
			return err
		}
	}
	s := t.Get("Session", a.SessionID)
	return a.rebindPendingOperations(t, d.Scope(a.SessionID, "", ""), identity(s), DispatchIdentity{Epoch: a.Store.Epoch()}, "exclusive main-session owner restart")
}
