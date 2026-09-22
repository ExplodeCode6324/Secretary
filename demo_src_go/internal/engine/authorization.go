package engine

import (
	"errors"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
	"strings"
	"time"
)

func (a *App) operation(id, execution, action, resource string, params d.R) (out d.R, err error) {
	raw := d.Bytes(params)
	hash := d.Hash(raw)
	err = a.Store.Update(func(t *store.Tx) error {
		if old := t.Get("Operation", id); old != nil {
			if d.M(old["action"])["parameters_hash"] != hash || d.M(old["action"])["resource"] != resource {
				return errors.New("CONFLICT immutable action changed")
			}
			out = old
			return nil
		}
		scope := d.Scope(a.SessionID, "", "")
		var attempt any
		if execution != "" {
			x := t.Get("Execution", execution)
			if x == nil || x["state"] != "RUNNING" && x["state"] != "READY" {
				return errors.New("execution cannot request operations")
			}
			scope = d.Scope("", d.S(x["task_id"]), execution)
			attempt = x["attempt_id"]
		}
		for _, old := range t.List("Operation") {
			s := d.M(old["action"])
			if s["action"] == action && s["resource"] == resource && d.M(old["scope"])["execution_id"] == scope["execution_id"] && (old["state"] == "RESULT_UNKNOWN" || old["state"] == "DISPATCHED") {
				return errors.New("RESULT_UNKNOWN: prior intent unresolved; no replacement action")
			}
		}
		ref, e := t.Object(params)
		if e != nil {
			return e
		}
		o := d.New("Operation")
		o["id"] = id
		act := d.Empty("ActionScope")
		merge(act, d.R{"action": action, "resource": resource, "parameters_ref": ref, "parameters_hash": hash, "intent_id": id})
		if action == "file.write" {
			old, readErr := os.ReadFile(resource)
			if readErr == nil {
				act["expected_resource_revision"] = d.Hash(old)
			} else if os.IsNotExist(readErr) {
				act["expected_resource_revision"] = "ABSENT"
			} else {
				return readErr
			}
		}
		merge(o, d.R{"scope": scope, "state": "PREPARED", "action": act, "owner_epoch": a.Store.Epoch(), "attempt_id": attempt, "effect": "NOT_STARTED"})
		if e = t.Save(o); e != nil {
			return e
		}
		_, e = t.Log("operation.prepared", "SCHEDULER", scope, id, o)
		out = o
		return e
	})
	if err != nil {
		return
	}
	if out["state"] == "PREPARED" {
		err = a.requestAuthorization(id)
		out = a.Store.Get("Operation", id)
	}
	return
}
func (a *App) requestAuthorization(id string) error {
	return a.Store.Update(func(t *store.Tx) error {
		o := t.Get("Operation", id)
		if o["state"] != "PREPARED" && o["state"] != "AUTHORIZED" && o["state"] != "WAIT_AUTH" {
			return nil
		}
		params, e := a.Store.Read(d.M(d.M(o["action"])["parameters_ref"]))
		if e != nil {
			return e
		}
		var args any
		if e = d.Decode(params, &args); e != nil {
			return e
		}
		for _, r := range t.List("AuthorizationRule") {
			if a.matchRule(r, d.M(o["action"]), args) {
				o["state"] = "AUTHORIZED"
				o["rule_id"] = r["id"]
				o["rule_revision"] = r["revision"]
				return t.Save(o)
			}
		}
		q := d.New("AuthorizationRequest")
		display := d.R{"operation_id": id, "scope": o["scope"], "action": o["action"], "parameters": args}
		ref, e := t.Object(display)
		if e != nil {
			return e
		}
		merge(q, d.R{"state": "PENDING", "operation_id": id, "action": o["action"], "scope": o["scope"], "display_ref": ref, "display_hash": ref["sha256"], "expires_at": a.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339Nano)})
		o["state"] = "WAIT_AUTH"
		o["authorization_id"] = q["id"]
		o["rule_id"] = nil
		o["rule_revision"] = nil
		if e = t.Save(o); e != nil {
			return e
		}
		if e = t.Save(q); e != nil {
			return e
		}
		_, e = t.Log("authorization.requested", "SCHEDULER", d.M(o["scope"]), id, display)
		return e
	})
}
func (a *App) matchRule(r, act d.R, args any) bool {
	if r["state"] != "ENABLED" || a.Now().Before(d.Time(r["valid_from"])) || r["expires_at"] != nil && !a.Now().Before(d.Time(r["expires_at"])) || !d.Has(r["actions"], d.S(act["action"])) {
		return false
	}
	resource := d.S(act["resource"])
	match := false
	for _, v := range d.A(r["resource_prefixes"]) {
		p := strings.TrimSuffix(d.S(v), "/")
		if resource == p || strings.HasPrefix(resource, p+"/") {
			match = true
		}
	}
	if !match {
		return false
	}
	b, e := a.Store.Read(d.M(r["parameter_constraints"]))
	if e != nil {
		return false
	}
	var schema any
	if d.Decode(b, &schema) != nil {
		return false
	}
	return d.ValidateSchema(schema, args) == nil
}

// Approve is called only by authenticated Master transport; never registered as a model tool.
func (a *App) Approve(cmd d.R) (out d.R, err error) {
	if err = d.Validate("ApprovalCommand", cmd); err != nil {
		return
	}
	raw := d.Bytes(cmd)
	err = a.Store.Update(func(t *store.Tx) error {
		var e error
		if out, e = t.Existing(d.S(cmd["request_id"]), d.Hash(raw)); e != nil || out != nil {
			return e
		}
		q := t.Get("AuthorizationRequest", d.S(cmd["authorization_id"]))
		if q == nil {
			return errors.New("NOT_FOUND authorization")
		}
		if q["display_hash"] != cmd["display_hash"] || d.N(q["revision"]) != d.N(cmd["expected_revision"]) {
			return errors.New("CONFLICT authorization display/revision")
		}
		if q["expires_at"] != nil && !a.Now().Before(d.Time(q["expires_at"])) {
			return errors.New("authorization expired")
		}
		o := t.Get("Operation", d.S(q["operation_id"]))
		if o == nil {
			return errors.New("missing operation")
		}
		switch cmd["decision"] {
		case "APPROVE":
			if q["state"] != "PENDING" || o["state"] != "WAIT_AUTH" {
				return errors.New("authorization no longer pending")
			}
			q["state"] = "APPROVED"
			o["state"] = "AUTHORIZED"
		case "REJECT":
			if q["state"] != "PENDING" {
				return errors.New("authorization not pending")
			}
			q["state"] = "REJECTED"
			o["state"] = "CANCELLED"
		case "REVOKE":
			if q["state"] != "APPROVED" {
				return errors.New("authorization cannot be revoked")
			}
			q["state"] = "REVOKED"
			o["state"] = "CANCELLED"
		}
		q["decided_by"] = "MASTER_UI"
		q["decided_at"] = d.Now()
		q["decision_id"] = cmd["request_id"]
		if e = t.Save(q); e != nil {
			return e
		}
		if e = t.Save(o); e != nil {
			return e
		}
		_, e = t.Log("authorization.decided", "MASTER_UI", d.M(q["scope"]), d.S(cmd["request_id"]), cmd)
		if e != nil {
			return e
		}
		out, e = t.Receipt(d.S(cmd["request_id"]), d.Hash(raw), d.S(q["id"]))
		return e
	})
	return
}

// Gate atomically consumes the exact authorization with the dispatch intent.
func (a *App) gate(id string) error {
	return a.Store.Update(func(t *store.Tx) error {
		o := t.Get("Operation", id)
		if o == nil || o["state"] != "AUTHORIZED" {
			return ErrWait
		}
		if e := a.validateDispatchIdentity(t, o); e != nil {
			return e
		}
		act := d.M(o["action"])
		if act["action"] == "file.write" {
			actual := "ABSENT"
			b, e := os.ReadFile(d.S(act["resource"]))
			if e == nil {
				actual = d.Hash(b)
			} else if !os.IsNotExist(e) {
				return e
			}
			if actual != d.S(act["expected_resource_revision"]) {
				return errors.New("CONFLICT target file changed since authorization request; propose a new operation")
			}
		}
		if xid := d.S(d.M(o["scope"])["execution_id"]); xid != "" {
			x := t.Get("Execution", xid)
			if x == nil || x["cancel_requested"] == true || x["state"] != "RUNNING" {
				return errors.New("dispatch requires live non-cancelled execution")
			}
		}
		if qid := d.S(o["authorization_id"]); qid != "" {
			q := t.Get("AuthorizationRequest", qid)
			if q == nil || q["state"] != "APPROVED" || d.Hash(d.Bytes(q["action"])) != d.Hash(d.Bytes(o["action"])) || q["expires_at"] != nil && !a.Now().Before(d.Time(q["expires_at"])) {
				return errors.New("authorization stale/revoked/expired")
			}
			q["state"] = "CONSUMED"
			q["consumed_at"] = d.Now()
			if e := t.Save(q); e != nil {
				return e
			}
		} else {
			r := t.Get("AuthorizationRule", d.S(o["rule_id"]))
			b, e := a.Store.Read(d.M(d.M(o["action"])["parameters_ref"]))
			if e != nil {
				return e
			}
			var args any
			if d.Decode(b, &args) != nil || r == nil || d.N(r["revision"]) != d.N(o["rule_revision"]) || !a.matchRule(r, d.M(o["action"]), args) {
				return errors.New("authorization rule stale")
			}
		}
		o["state"] = "DISPATCHED"
		if e := t.Save(o); e != nil {
			return e
		}
		_, e := t.Log("operation.dispatched", "SCHEDULER", d.M(o["scope"]), id, o)
		return e
	})
}
func (a *App) operationResult(id, state, effect string, value any) error {
	return a.Store.Update(func(t *store.Tx) error {
		o := t.Get("Operation", id)
		ref, e := t.Object(value)
		if e != nil {
			return e
		}
		o["state"] = state
		o["effect"] = effect
		o["receipt"] = ref
		if e = t.Save(o); e != nil {
			return e
		}
		_, e = t.Log("operation.result", "SCHEDULER", d.M(o["scope"]), id, value)
		return e
	})
}
func (a *App) WriteFile(execution, call string, args d.R) (any, error) {
	path := d.S(args["path"])
	full, e := a.workPath(execution, path)
	if e != nil {
		return nil, e
	}
	if len(d.S(args["content"])) > 1<<20 {
		return nil, errors.New("file too large")
	}
	id := d.Stable(execution + ":" + call)
	op, e := a.operation(id, execution, "file.write", full, args)
	if e != nil {
		return nil, e
	}
	switch op["state"] {
	case "WAIT_AUTH":
		return nil, ErrWait
	case "CANCELLED":
		return d.R{"status": "DENIED", "effect": "NOT_APPLIED"}, nil
	case "SUCCEEDED", "FAILED":
		b, e := a.Store.Read(d.M(op["receipt"]))
		var v any
		if e == nil {
			e = d.Decode(b, &v)
		}
		return v, e
	case "RESULT_UNKNOWN", "DISPATCHED":
		return nil, errors.New("RESULT_UNKNOWN; do not repeat")
	}
	if e = a.gate(id); e != nil {
		return nil, e
	}
	if _, e = a.workPath(execution, path); e == nil {
		e = a.rootedWrite(execution, path, []byte(d.S(args["content"])))
	}
	if e != nil {
		if err := a.operationResult(id, "RESULT_UNKNOWN", "UNKNOWN", d.R{"error": e.Error()}); err != nil {
			return nil, errors.Join(e, err)
		}
		return nil, errors.New("RESULT_UNKNOWN file write")
	}
	r := d.R{"status": "SUCCEEDED", "path": path, "sha256": d.Hash([]byte(d.S(args["content"]))), "bytes": len(d.S(args["content"]))}
	if e = a.operationResult(id, "SUCCEEDED", "APPLIED", r); e != nil {
		return nil, e
	}
	return r, nil
}
func (a *App) workPath(execution, path string) (string, error) {
	if path == "" || filepath.IsAbs(path) || filepath.Clean(path) != path || path == ".." || strings.HasPrefix(path, "../") {
		return "", errors.New("invalid workspace relative path")
	}
	x := a.Store.Get("Execution", execution)
	if x == nil {
		return "", errors.New("unknown execution")
	}
	root := filepath.Join(a.Cfg.WorkspaceRoot, d.S(x["task_id"]), "work")
	full := filepath.Join(root, path)
	for p := full; ; p = filepath.Dir(p) {
		i, e := os.Lstat(p)
		if e == nil && i.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("symlink workspace path rejected")
		}
		if e != nil && !os.IsNotExist(e) {
			return "", e
		}
		if p == a.Cfg.WorkspaceRoot {
			break
		}
		if filepath.Dir(p) == p {
			return "", errors.New("workspace path escaped")
		}
	}
	return full, nil
}
func (a *App) Rule(request string, args d.R) (out d.R, err error) {
	actions := d.A(args["actions"])
	for _, v := range actions {
		if v != "file.write" && v != "program.run" && v != "world.change" {
			return nil, errors.New("unregistered action")
		}
	}
	if len(actions) == 0 || len(d.A(args["resource_prefixes"])) == 0 {
		return nil, errors.New("rule requires action and resource prefixes")
	}
	schema := args["parameter_constraints"]
	if schema == nil {
		return nil, errors.New("parameter constraints schema required")
	}
	err = a.Store.Update(func(t *store.Tx) error {
		var e error
		if out, e = t.Existing(request, d.Hash(d.Bytes(args))); e != nil || out != nil {
			return e
		}
		r := d.New("AuthorizationRule")
		if id := d.S(args["id"]); id != "" {
			r = t.Get("AuthorizationRule", id)
			if r == nil || d.N(r["revision"]) != d.N(args["expected_revision"]) {
				return errors.New("CONFLICT rule revision")
			}
		}
		ref, e := t.Object(schema)
		if e != nil {
			return e
		}
		confirmation, e := t.Object(args)
		if e != nil {
			return e
		}
		merge(r, d.R{"state": nonempty(d.S(args["state"]), "ENABLED"), "actions": actions, "resource_prefixes": args["resource_prefixes"], "parameter_constraints": ref, "valid_from": d.Now(), "created_by": "MASTER_UI", "confirmation_ref": confirmation})
		if args["expires_at"] != nil {
			r["expires_at"] = args["expires_at"]
		}
		if e = t.Save(r); e != nil {
			return e
		}
		out, e = t.Receipt(request, d.Hash(d.Bytes(args)), d.S(r["id"]))
		return e
	})
	return
}
func (a *App) ReconcileFile(id string) (d.R, error) {
	o := a.Store.Get("Operation", id)
	if o == nil || o["state"] != "RESULT_UNKNOWN" || d.M(o["action"])["action"] != "file.write" {
		return nil, errors.New("only unknown file writes can be verified locally")
	}
	b, e := a.Store.Read(d.M(d.M(o["action"])["parameters_ref"]))
	if e != nil {
		return nil, e
	}
	var p d.R
	if e = d.Decode(b, &p); e != nil {
		return nil, e
	}
	xid := d.S(d.M(o["scope"])["execution_id"])
	path, e := a.workPath(xid, d.S(p["path"]))
	if e != nil {
		return nil, e
	}
	actual, e := os.ReadFile(path)
	if e != nil || d.Hash(actual) != d.Hash([]byte(d.S(p["content"]))) {
		return nil, errors.New("RESULT_UNKNOWN: current file does not prove requested effect; no retry")
	}
	receipt := d.R{"status": "SUCCEEDED", "verified": "current bytes equal intended content", "sha256": d.Hash(actual), "path": d.S(p["path"])}
	if e = a.operationResult(id, "SUCCEEDED", "APPLIED", receipt); e != nil {
		return nil, e
	}
	x := a.Store.Get("Execution", xid)
	if x != nil && x["state"] == "RESULT_UNKNOWN" {
		for _, op := range a.Store.View("Operation") {
			if d.M(op["scope"])["execution_id"] == xid && op["state"] == "RESULT_UNKNOWN" {
				return receipt, nil
			}
		}
		e = a.set("Execution", xid, "RUNNING", nil)
	}
	return receipt, e
}

func (a *App) rootedWrite(execution, path string, b []byte) error {
	x := a.Store.Get("Execution", execution)
	root, e := os.OpenRoot(filepath.Join(a.Cfg.WorkspaceRoot, d.S(x["task_id"]), "work"))
	if e != nil {
		return e
	}
	defer root.Close()
	parent := filepath.Dir(path)
	if e = root.MkdirAll(parent, 0700); e != nil {
		return e
	}
	tmp := filepath.Join(parent, ".secretary-"+d.ID())
	f, e := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	defer root.Remove(tmp)
	if _, e = f.Write(b); e == nil {
		e = f.Sync()
	}
	if x := f.Close(); e == nil {
		e = x
	}
	if e != nil {
		return e
	}
	if e = root.Rename(tmp, path); e != nil {
		return e
	}
	dir, e := root.Open(parent)
	if e != nil {
		return e
	}
	defer dir.Close()
	return dir.Sync()
}

func (a *App) expireAuthorizations() error {
	for _, q := range a.Store.View("AuthorizationRequest") {
		if (q["state"] != "PENDING" && q["state"] != "APPROVED") || q["expires_at"] == nil || a.Now().Before(d.Time(q["expires_at"])) {
			continue
		}
		opID := d.S(q["operation_id"])
		if err := a.Store.Update(func(t *store.Tx) error {
			current := t.Get("AuthorizationRequest", d.S(q["id"]))
			if current["state"] != "PENDING" && current["state"] != "APPROVED" {
				return nil
			}
			current["state"] = "EXPIRED"
			if e := t.Save(current); e != nil {
				return e
			}
			o := t.Get("Operation", opID)
			if o["state"] == "AUTHORIZED" {
				o["state"] = "WAIT_AUTH"
				return t.Save(o)
			}
			return nil
		}); err != nil {
			return err
		}
		if e := a.requestAuthorization(opID); e != nil {
			return e
		}
	}
	return nil
}
