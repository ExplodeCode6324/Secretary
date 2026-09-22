package engine

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
	"strings"
	"time"
)

func (a *App) Propose(request string, args d.R) (out d.R, err error) {
	raw := d.Bytes(args)
	goal := d.S(args["goal"])
	if strings.TrimSpace(goal) == "" || len(d.A(args["acceptance_criteria"])) == 0 {
		return nil, errors.New("goal and acceptance_criteria required")
	}
	trigger := d.Empty("Trigger")
	trigger["kind"] = nonempty(d.S(args["trigger"]), "IMMEDIATE")
	trigger["timezone"] = "Etc/UTC"
	trigger["missed_policy"] = nonempty(d.S(args["missed_policy"]), "REPORT_ONLY")
	trigger["overlap_policy"] = nonempty(d.S(args["overlap_policy"]), "QUEUE")
	due := a.Now().UTC()
	switch trigger["kind"] {
	case "IMMEDIATE":
	case "AT":
		due = d.Time(args["at"])
		if due.IsZero() {
			return nil, errors.New("AT requires RFC3339 at")
		}
		trigger["at"] = due.Format(time.RFC3339Nano)
	case "INTERVAL":
		seconds := d.N(args["interval_seconds"])
		if seconds < 1 || seconds > 31536000 {
			return nil, errors.New("invalid interval_seconds")
		}
		trigger["interval_seconds"] = seconds
		trigger["anchor_at"] = due.Format(time.RFC3339Nano)
	default:
		return nil, errors.New("unsupported trigger (EVENT has no registered source)")
	}
	if err = d.Validate("Trigger", trigger); err != nil {
		return
	}
	ex := d.Empty("ExecutorSpec")
	ex["kind"] = nonempty(d.S(args["kind"]), "AGENT")
	ex["parameters"] = d.R{}
	if ex["kind"] == "AGENT" {
		ex["agent_profile"] = "task-go"
	} else if ex["kind"] == "PROGRAM" {
		p := a.Store.Get("ProgramRegistration", d.S(args["program_id"]))
		if p == nil || p["state"] != "ENABLED" {
			return nil, errors.New("program not enabled")
		}
		ex["program_id"] = p["id"]
		ex["program_revision"] = p["revision"]
		ex["parameters"] = args["parameters"]
		if err = a.validateProgram(p, ex["parameters"]); err != nil {
			return
		}
	} else {
		return nil, errors.New("invalid executor kind")
	}
	pre := args["preconditions"]
	if pre == nil {
		pre = []any{}
	}
	for _, p := range d.A(pre) {
		if err = d.Validate("Precondition", p); err != nil {
			return
		}
	}
	err = a.Store.Update(func(t *store.Tx) error {
		var e error
		if out, e = t.Existing(request, d.Hash(raw)); e != nil || out != nil {
			return e
		}

		if reuse := d.S(args["reuse_task_id"]); reuse != "" {
			p := t.Get("TaskPlan", reuse)
			parent := t.Get("Execution", d.S(args["parent_execution_id"]))
			if p == nil || p["state"] != "ACTIVE" || parent == nil || parent["task_id"] != reuse || !isTerminal(d.S(parent["state"])) || parent["retention_state"] == "RETIRED" {
				return errors.New("same-plan followup requires matching terminal HOT parent and active plan")
			}
			b, e := a.Store.Read(d.M(p["proposal_ref"]))
			if e != nil {
				return e
			}
			var original d.R
			if e = d.Decode(b, &original); e != nil {
				return e
			}
			constraints := args["constraints"]
			if constraints == nil {
				constraints = []any{}
			}
			if original["goal"] != goal || d.Hash(d.Bytes(original["constraints"])) != d.Hash(d.Bytes(constraints)) || d.Hash(d.Bytes(original["acceptance_criteria"])) != d.Hash(d.Bytes(args["acceptance_criteria"])) || d.Hash(d.Bytes(p["executor"])) != d.Hash(d.Bytes(ex)) {
				return errors.New("same-plan followup cannot change goal, constraints, acceptance or executor; create a new plan")
			}
			x := d.New("Execution")
			merge(x, d.R{"task_id": reuse, "state": "CREATED", "retention_state": "HOT", "occurrence_key": reuse + ":followup:" + request, "plan_revision": p["revision"], "owner_epoch": a.Store.Epoch(), "last_activity_at": d.Now(), "retire_after_seconds": a.Cfg.RetentionSeconds, "continuation_of": parent["id"]})
			parent["pending_followup_ids"] = append(d.A(parent["pending_followup_ids"]), x["id"])
			p["active_execution_ids"] = append(d.A(p["active_execution_ids"]), x["id"])
			if e = t.Save(x); e != nil {
				return e
			}
			if e = t.Save(parent); e != nil {
				return e
			}
			if e = t.Save(p); e != nil {
				return e
			}
			if _, e = t.Log("task.proposed", "MAIN", d.Scope(a.SessionID, "", ""), d.S(x["id"]), args); e != nil {
				return e
			}
			out, e = t.Receipt(request, d.Hash(raw), d.S(x["id"]))
			return e
		}
		p := d.New("TaskPlan")
		proposal := d.Empty("TaskProposal")
		proposal["request_id"] = request
		proposal["request_hash"] = d.Hash(raw)
		proposal["submitted_at"] = d.Now()
		proposal["session_id"] = a.SessionID
		proposal["goal"] = goal
		if args["constraints"] != nil {
			proposal["constraints"] = args["constraints"]
		}
		proposal["acceptance_criteria"] = args["acceptance_criteria"]
		proposal["trigger"] = trigger
		proposal["preconditions"] = pre
		proposal["executor"] = ex
		proposal["feedback_policy"] = d.R{"terminal": true, "on_change": false, "on_blocker": true, "on_unknown": true, "milestones": []any{}}
		proposal["safety_rule_id"] = a.SafetyID
		if args["deadline"] != nil {
			if d.Time(args["deadline"]).IsZero() {
				return errors.New("invalid deadline")
			}
			proposal["deadline"] = args["deadline"]
		}
		if parent := d.S(args["parent_execution_id"]); parent != "" {
			old := t.Get("Execution", parent)
			if old == nil || !isTerminal(d.S(old["state"])) || old["retention_state"] == "RETIRED" {
				return errors.New("followup requires a terminal HOT execution; waiting executions need task_control")
			}
			proposal["parent_execution_id"] = parent
			old["pending_followup_ids"] = append(d.A(old["pending_followup_ids"]), p["id"])
			if e = t.Save(old); e != nil {
				return e
			}
		}
		if e = d.Validate("TaskProposal", proposal); e != nil {
			return e
		}
		ref, e := t.Object(proposal)
		if e != nil {
			return e
		}
		merge(p, d.R{"state": "INITIALIZING", "proposal_request_id": request, "proposal_ref": ref, "workspace": p["id"], "trigger": trigger, "preconditions": pre, "executor": ex, "feedback_policy": proposal["feedback_policy"], "next_due_at": due.Format(time.RFC3339Nano), "deadline": proposal["deadline"], "safety_rule_id": a.SafetyID})
		if e = t.Save(p); e != nil {
			return e
		}
		if _, e = t.Log("task.proposed", "MAIN", d.Scope(a.SessionID, "", ""), d.S(p["id"]), proposal); e != nil {
			return e
		}
		out, e = t.Receipt(request, d.Hash(raw), d.S(p["id"]))
		return e
	})
	return
}
func (a *App) Schedule() error {
	now := a.Now().UTC()
	for _, p := range a.Store.View("TaskPlan") {
		if p["state"] != "ACTIVE" || p["next_due_at"] == nil && len(d.A(p["pending_occurrences"])) == 0 {
			continue
		}
		due := d.Time(p["next_due_at"])
		if now.Before(due) && len(d.A(p["pending_occurrences"])) == 0 {
			continue
		}
		err := a.Store.Update(func(t *store.Tx) error {
			p := t.Get("TaskPlan", d.S(p["id"]))
			if p["state"] != "ACTIVE" {
				return nil
			}
			tr := d.M(p["trigger"])
			active := false
			for _, x := range t.List("Execution") {
				if x["task_id"] == p["id"] && !isTerminal(d.S(x["state"])) {
					active = true
				}
			}

			pending := d.A(p["pending_occurrences"])
			fromQueue := !active && len(pending) > 0
			occ := ""
			missed := false
			skip := false
			if fromQueue {
				occ = d.S(pending[0])
				p["pending_occurrences"] = pending[1:]
			} else {
				if p["next_due_at"] == nil || d.Time(p["next_due_at"]).After(now) {
					return nil
				}
				due = d.Time(p["next_due_at"])
				missed = tr["kind"] != "IMMEDIATE" && now.Sub(due) > 2*time.Second
				skip = active && tr["overlap_policy"] == "SKIP" || missed && tr["missed_policy"] != "CATCH_UP_ONE"
				occ = d.S(p["id"]) + ":" + due.Format(time.RFC3339Nano)
				p["next_due_at"] = nil
				if tr["kind"] == "INTERVAL" {
					interval := time.Duration(d.N(tr["interval_seconds"])) * time.Second
					next := due.Add(interval)
					if !next.After(now) {
						next = due.Add((now.Sub(due)/interval + 1) * interval)
					}
					p["next_due_at"] = next.Format(time.RFC3339Nano)
				}
				if active && tr["overlap_policy"] == "QUEUE" && !skip {
					p["pending_occurrences"] = append(pending, occ)
					return t.Save(p)
				}
			}

			if skip {
				if _, err := t.Log("execution.changed", "SCHEDULER", d.Scope(a.SessionID, "", ""), d.S(p["id"]), d.R{"task_id": p["id"], "occurrence": occ, "missed": missed, "skipped": true}); err != nil {
					return err
				}
				if missed && tr["missed_policy"] == "REPORT_ONLY" {
					ref, err := t.Object(d.R{"task_id": p["id"], "event": "MISSED_TRIGGER", "occurrence": occ, "message": "错过触发，按 REPORT_ONLY 不自动补跑"})
					if err != nil {
						return err
					}
					i := d.New("Input")
					merge(i, d.R{"session_id": a.SessionID, "dedupe_key": occ, "producer": "SCHEDULER", "state": "ACCEPTED", "payload": ref, "received_at": d.Now()})
					if err = t.Save(i); err != nil {
						return err
					}
				}
				return t.Save(p)
			}
			id := d.Stable(occ)
			if t.Get("Execution", id) != nil {
				return errors.New("duplicate occurrence invariant")
			}
			x := d.New("Execution")
			x["id"] = id
			merge(x, d.R{"task_id": p["id"], "state": "CREATED", "retention_state": "HOT", "occurrence_key": occ, "plan_revision": p["revision"], "owner_epoch": a.Store.Epoch(), "last_activity_at": d.Now(), "retire_after_seconds": a.Cfg.RetentionSeconds})
			p["active_execution_ids"] = append(d.A(p["active_execution_ids"]), id)
			if err := t.Save(x); err != nil {
				return err
			}
			return t.Save(p)
		})
		if err != nil {
			return err
		}
	}
	for _, x := range a.Store.View("Execution") {
		id := d.S(x["id"])
		p := a.Store.Get("TaskPlan", d.S(x["task_id"]))
		if p == nil {
			return errors.New("missing plan")
		}
		if isTerminal(d.S(x["state"])) || x["state"] == "RESULT_UNKNOWN" {
			continue
		}
		if p["deadline"] != nil && !now.Before(d.Time(p["deadline"])) {
			if x["state"] == "RUNNING" || x["state"] == "DISPATCHING" {
				if err := a.cancelExecution(id); err != nil {
					return err
				}
			} else if x["state"] != "CANCEL_REQUESTED" {
				if err := a.finish(id, "EXPIRED", "已到任务截止时间，未启动新操作", []any{}, d.R{"deadline": p["deadline"]}); err != nil {
					return err
				}
			}
			continue
		}
		switch x["state"] {
		case "CREATED":
			if err := a.set("Execution", id, "WAIT_PRECONDITION", nil); err != nil {
				return err
			}
		case "WAIT_PRECONDITION":
			results := []any{}
			met := true
			for _, v := range d.A(p["preconditions"]) {
				c := d.M(v)
				status := "UNKNOWN"
				switch c["kind"] {
				case "EXECUTION_SUCCEEDED":
					dep := a.Store.Get("Execution", d.S(c["target"]))
					if dep != nil {
						status = "NOT_MET"
						if dep["state"] == "SUCCEEDED" && (c["required_revision"] == nil || d.S(c["required_revision"]) == fmt.Sprint(d.N(dep["revision"]))) {
							status = "MET"
						}
					}
				case "DEVICE_AVAILABLE":
					if c["target"] == "LOCAL" && c["required_revision"] == nil {
						status = "MET"
					}
				case "RESOURCE_PRESENT":
					if c["target"] == "TASK_WORKSPACE" {
						if _, e := os.Stat(filepath.Join(a.Cfg.WorkspaceRoot, d.S(p["id"]), "work")); e == nil {
							status = "MET"
						}
					}
				}
				if status != "MET" {
					met = false
				}
				results = append(results, d.R{"condition_id": c["condition_id"], "status": status, "checked_at": d.Now(), "reason": "registered local checker", "evidence": []any{}})
			}
			if met {
				if err := a.set("Execution", id, "READY", d.R{"condition_results": results}); err != nil {
					return err
				}
			} else {
				changed := len(d.A(x["condition_results"])) != len(results)
				if !changed {
					for i, v := range results {
						if d.M(v)["status"] != d.M(d.A(x["condition_results"])[i])["status"] {
							changed = true
						}
					}
				}
				if changed {
					if err := a.set("Execution", id, "WAIT_PRECONDITION", d.R{"condition_results": results}); err != nil {
						return err
					}
					if err := a.feedback(id, "PROGRESS", "执行前提未满足；UNKNOWN 不视为可执行，请查询详情", nil); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}
func (a *App) Query(kind, id string) (d.R, error) {
	switch kind {
	case "CAPABILITIES":
		return d.R{"programs": a.Store.View("ProgramRegistration"), "agent_tools": []string{"workspace_read", "workspace_list", "file_write", "ask_decision", "task_finish"}, "triggers": []string{"IMMEDIATE", "AT", "INTERVAL"}}, nil
	case "LIST":
		goals := d.R{}
		for _, p := range a.Store.View("TaskPlan") {
			b, e := a.Store.Read(d.M(p["proposal_ref"]))
			if e != nil {
				return nil, e
			}
			var proposal d.R
			if e = d.Decode(b, &proposal); e != nil {
				return nil, e
			}
			goals[d.S(p["id"])] = proposal["goal"]
		}
		return d.R{"plans": a.Store.View("TaskPlan"), "executions": a.Store.View("Execution"), "decisions": a.Store.View("DecisionRequest"), "goals": goals}, nil
	case "DETAIL":
		var out d.R
		err := a.Store.Update(func(t *store.Tx) error {
			x := t.Get("Execution", id)
			if x == nil {
				return errors.New("NOT_FOUND execution")
			}
			if x["retention_state"] == "RETIRED" {
				return errors.New("RETIRED: use Operation Log execution_id=" + id)
			}
			x["last_activity_at"] = d.Now()
			x["retention_state"] = "HOT"
			out = d.R{"execution": x, "plan": t.Get("TaskPlan", d.S(x["task_id"]))}
			if x["result_id"] != nil {
				out["result"] = t.Get("TaskResult", d.S(x["result_id"]))
				result := d.M(out["result"])
				b, e := a.Store.Read(d.M(result["detail_ref"]))
				if e != nil {
					return e
				}
				var detail any
				if e = d.Decode(b, &detail); e != nil {
					return e
				}
				out["detail"] = detail
			}
			if x["checkpoint_id"] != nil {
				out["checkpoint"] = t.Get("Checkpoint", d.S(x["checkpoint_id"]))
			}
			if e := t.Save(x); e != nil {
				return e
			}
			out["execution"] = t.Get("Execution", id)
			return nil
		})
		return out, err
	}
	return nil, errors.New("invalid query kind")
}
func (a *App) Control(request string, args d.R) (out d.R, err error) {
	err = a.Store.Update(func(t *store.Tx) error {
		var e error
		if out, e = t.Existing(request, d.Hash(d.Bytes(args))); e != nil || out != nil {
			return e
		}
		action := d.S(args["action"])
		id := d.S(args["target_id"])
		typ := "TaskPlan"
		if action == "CANCEL_EXECUTION" || action == "ANSWER_DECISION" {
			typ = "Execution"
		}
		r := t.Get(typ, id)
		if r == nil {
			return errors.New("NOT_FOUND target")
		}
		if d.N(r["revision"]) != d.N(args["expected_revision"]) {
			return errors.New("CONFLICT revision")
		}
		switch action {
		case "PAUSE_PLAN":
			r["state"] = "PAUSED"
		case "RESUME_PLAN":
			r["state"] = "ACTIVE"
		case "CLOSE_PLAN":
			r["state"] = "CLOSED"
		case "CANCEL_EXECUTION":
			if !isTerminal(d.S(r["state"])) {
				r["cancel_requested"] = true
				if r["state"] == "RUNNING" || r["state"] == "DISPATCHING" {
					r["state"] = "CANCEL_REQUESTED"
				} else if r["state"] == "RESULT_UNKNOWN" {
					return errors.New("unknown effects require reconciliation before cancellation")
				} else {
					r["state"] = "CANCELLED"
					r["ended_at"] = d.Now()
				}
			}
		case "ANSWER_DECISION":
			q := t.Get("DecisionRequest", d.S(args["decision_request_id"]))
			if q == nil || q["execution_id"] != r["id"] || q["state"] != "OPEN" || r["state"] != "WAIT_DECISION" {
				return errors.New("invalid decision")
			}
			if q["deadline"] != nil && !a.Now().Before(d.Time(q["deadline"])) {
				return errors.New("decision deadline expired")
			}
			q["state"] = "ANSWERED"
			q["answer"] = args["answer"]
			q["answered_by"] = "MAIN"
			q["answer_request_id"] = request
			r["state"] = "READY"
			r["waiting_request_ids"] = []any{}
			if e = t.Save(q); e != nil {
				return e
			}
		default:
			return errors.New("invalid task control; authorization unavailable")
		}

		var cancellation d.R
		if action == "CANCEL_EXECUTION" && r["state"] == "CANCELLED" && r["result_id"] == nil {
			ref, e := t.Object(d.R{"state": "CANCELLED", "before_dispatch": true, "request": args})
			if e != nil {
				return e
			}
			cancellation = d.New("TaskResult")
			merge(cancellation, d.R{"task_id": r["task_id"], "execution_id": id, "outcome": "CANCELLED", "summary": "等待中的执行已取消", "evidence": []any{ref}, "detail_ref": ref, "verified_by": "PROGRAM_CHECK", "observed_at": d.Now()})
			r["result_id"] = cancellation["id"]
			r["last_activity_at"] = d.Now()
			r["waiting_request_ids"] = []any{}
			if e = t.Save(cancellation); e != nil {
				return e
			}
			for _, o := range t.List("Operation") {
				if d.M(o["scope"])["execution_id"] == id && (o["state"] == "PREPARED" || o["state"] == "WAIT_AUTH" || o["state"] == "AUTHORIZED") {
					o["state"] = "CANCELLED"
					if e = t.Save(o); e != nil {
						return e
					}
					if q := t.Get("AuthorizationRequest", d.S(o["authorization_id"])); q != nil && (q["state"] == "PENDING" || q["state"] == "APPROVED") {
						q["state"] = "REVOKED"
						if e = t.Save(q); e != nil {
							return e
						}
					}
				}
			}
			for _, q := range t.List("DecisionRequest") {
				if q["execution_id"] == id && q["state"] == "OPEN" {
					q["state"] = "OBSOLETE"
					if e = t.Save(q); e != nil {
						return e
					}
				}
			}
		}
		if e = t.Save(r); e != nil {
			return e
		}
		if cancellation != nil {
			if e = a.feedbackTx(t, id, "RESULT", "等待中的执行已取消", cancellation); e != nil {
				return e
			}
		}
		if _, e = t.Log("execution.changed", "MAIN", d.Scope(a.SessionID, "", ""), request, args); e != nil {
			return e
		}
		out, e = t.Receipt(request, d.Hash(d.Bytes(args)), id)
		return e
	})
	return
}
func (a *App) cancelExecution(id string) error {
	x := a.Store.Get("Execution", id)
	_, e := a.Control(d.ID(), d.R{"action": "CANCEL_EXECUTION", "target_id": id, "expected_revision": x["revision"]})
	return e
}
func (a *App) feedback(id, kind, summary string, result d.R) error {
	return a.Store.Update(func(t *store.Tx) error { return a.feedbackTx(t, id, kind, summary, result) })
}
func (a *App) feedbackTx(t *store.Tx, id, kind, summary string, result d.R) error {
	x := t.Get("Execution", id)
	ref, e := t.Object(d.R{"execution_id": id, "task_id": x["task_id"], "state": x["state"], "summary": summary, "kind": kind})
	if e != nil {
		return e
	}
	f := d.New("Feedback")
	i := d.New("Input")
	merge(f, d.R{"state": "DELIVERED", "task_id": x["task_id"], "execution_id": id, "kind": kind, "summary": summary, "detail_ref": ref, "input_id": i["id"], "created_at": d.Now()})
	if result != nil {
		f["result_id"] = result["id"]
	}
	merge(i, d.R{"session_id": a.SessionID, "dedupe_key": f["id"], "producer": "SCHEDULER", "state": "ACCEPTED", "payload": ref, "received_at": d.Now(), "feedback_id": f["id"]})
	if e = t.Save(f); e != nil {
		return e
	}
	if e = t.Save(i); e != nil {
		return e
	}
	_, e = t.Log("feedback.delivered", "SCHEDULER", d.Scope("", d.S(x["task_id"]), id), id, d.R{"feedback_id": f["id"], "summary": summary})
	return e
}
func (a *App) finish(id, outcome, summary string, limitations any, detail d.R) error {
	return a.Store.Update(func(t *store.Tx) error {
		x := t.Get("Execution", id)
		if isTerminal(d.S(x["state"])) {
			return nil
		}
		if x["state"] == "RESULT_UNKNOWN" {
			return errors.New("unknown result cannot be finalized by agent")
		}
		ref, e := t.Object(detail)
		if e != nil {
			return e
		}
		r := d.New("TaskResult")
		merge(r, d.R{"task_id": x["task_id"], "execution_id": id, "outcome": outcome, "summary": summary, "evidence": []any{ref}, "detail_ref": ref, "verified_by": "NOT_VERIFIED", "observed_at": d.Now()})
		if limitations != nil {
			r["limitations"] = limitations
		}
		for _, op := range t.List("Operation") {
			if d.M(op["scope"])["execution_id"] == id && op["state"] == "SUCCEEDED" && d.M(op["action"])["action"] == "file.write" {
				raw, e := a.Store.Read(d.M(d.M(op["action"])["parameters_ref"]))
				if e != nil {
					return e
				}
				var params d.R
				if e = d.Decode(raw, &params); e != nil {
					return e
				}
				content, e := a.Store.Put([]byte(d.S(params["content"])), "text/plain; charset=utf-8")
				if e != nil {
					return e
				}
				artifact := d.R{"artifact_id": d.ID(), "name": params["path"], "content": content, "workspace_path": d.S(x["task_id"]) + "/work/" + d.S(params["path"]), "producing_operation_id": op["id"]}
				r["artifacts"] = append(d.A(r["artifacts"]), artifact)
			}
		}
		if x["state"] == "CANCEL_REQUESTED" && outcome != "SUCCEEDED" {
			outcome = "CANCELLED"
			r["outcome"] = outcome
		}
		x["state"] = outcome
		x["ended_at"] = d.Now()
		x["last_activity_at"] = d.Now()
		x["result_id"] = r["id"]
		if e = t.Save(r); e != nil {
			return e
		}
		if e = t.Save(x); e != nil {
			return e
		}
		p := t.Get("TaskPlan", d.S(x["task_id"]))
		ids := []any{}
		for _, v := range d.A(p["active_execution_ids"]) {
			if v != id {
				ids = append(ids, v)
			}
		}
		p["active_execution_ids"] = ids
		if e = t.Save(p); e != nil {
			return e
		}
		for _, parent := range t.List("Execution") {
			if d.Has(parent["pending_followup_ids"], d.S(p["id"])) || d.Has(parent["pending_followup_ids"], id) {
				pending := []any{}
				for _, v := range d.A(parent["pending_followup_ids"]) {
					if v != p["id"] && v != id {
						pending = append(pending, v)
					}
				}
				parent["pending_followup_ids"] = pending
				parent["last_activity_at"] = d.Now()
				if e = t.Save(parent); e != nil {
					return e
				}
			}
		}
		return a.feedbackTx(t, id, "RESULT", summary, r)
	})
}
func (a *App) Retire() error {
	for _, x := range a.Store.View("Execution") {
		if !isTerminal(d.S(x["state"])) || x["retention_state"] == "RETIRED" || len(d.A(x["pending_followup_ids"])) > 0 || a.Now().Sub(d.Time(x["last_activity_at"])) < time.Duration(d.N(x["retire_after_seconds"]))*time.Second {
			continue
		}
		id := d.S(x["id"])
		if x["retention_state"] == "HOT" {
			if e := a.Store.Update(func(t *store.Tx) error {
				r := t.Get("Execution", id)
				if r["retention_state"] != "HOT" || len(d.A(r["pending_followup_ids"])) > 0 || a.Now().Sub(d.Time(r["last_activity_at"])) < time.Duration(d.N(r["retire_after_seconds"]))*time.Second {
					return nil
				}
				r["retention_state"] = "ARCHIVE_PENDING"
				return t.Save(r)
			}); e != nil {
				return e
			}
		}
		err := a.Store.Update(func(t *store.Tx) error {
			r := t.Get("Execution", id)
			if r["retention_state"] != "ARCHIVE_PENDING" || !isTerminal(d.S(r["state"])) || len(d.A(r["pending_followup_ids"])) > 0 {
				return nil
			}
			if a.Now().Sub(d.Time(r["last_activity_at"])) < time.Duration(d.N(r["retire_after_seconds"]))*time.Second {
				return nil
			}
			for _, f := range t.List("Feedback") {
				if f["execution_id"] == id && f["state"] != "HANDLED" {
					return nil
				}
			}
			for _, q := range t.List("DecisionRequest") {
				if q["execution_id"] == id && q["state"] == "OPEN" {
					return nil
				}
			}
			objects := []any{}
			events := []any{}
			for _, ev := range a.Store.EventsUnsafe(t) {
				if d.M(ev["scope"])["execution_id"] == id {
					if err := a.Store.CheckRefs(ev); err != nil {
						return err
					}
					objects = append(objects, ev["payload"])
					events = append(events, ev["event_id"])
				}
			}
			for _, typ := range []string{"Execution", "Context", "ModelCall", "Checkpoint", "TaskResult", "Operation", "Dispatch", "DecisionRequest", "Feedback"} {
				for _, record := range t.List(typ) {
					if record["execution_id"] == id || d.M(record["scope"])["execution_id"] == id || typ == "Execution" && record["id"] == id {
						if err := a.Store.CheckRefs(record); err != nil {
							return err
						}
						ref, e := t.Object(record)
						if e != nil {
							return e
						}
						objects = append(objects, ref)
					}
				}
			}
			if len(objects) == 0 {
				return nil
			}
			m := d.New("ArchiveManifest")
			merge(m, d.R{"task_id": r["task_id"], "execution_id": id, "objects": objects, "log_event_ids": events, "verified_at": d.Now(), "retired_at": d.Now()})
			r["retention_state"] = "RETIRED"
			if e := t.Save(m); e != nil {
				return e
			}
			return t.Save(r)
		})
		if err != nil {
			return err
		}
	}
	return nil
}
