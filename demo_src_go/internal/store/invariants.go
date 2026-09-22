package store

import (
	"fmt"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
)

func mkdirDurable(path string) error {
	info, e := os.Lstat(path)
	if e == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("not a real directory: %s", path)
		}
		return nil
	}
	if !os.IsNotExist(e) {
		return e
	}
	parent := filepath.Dir(path)
	if parent == path {
		return e
	}
	if e = mkdirDurable(parent); e != nil {
		return e
	}
	if e = os.Mkdir(path, 0700); e != nil && !os.IsExist(e) {
		return e
	}
	return SyncDir(parent)
}
func validateView(records map[string]d.R) error {
	lookup := func(typ string, id any) (d.R, error) {
		r := records[key(typ, d.S(id))]
		if r == nil {
			return nil, fmt.Errorf("missing %s reference %v", typ, id)
		}
		return r, nil
	}
	for _, r := range records {
		typ := d.S(r["record_type"])
		switch typ {
		case "Session":
			if _, e := lookup("Consciousness", r["consciousness_id"]); e != nil {
				return e
			}
			for _, id := range d.A(r["claimed_input_ids"]) {
				i, e := lookup("Input", id)
				if e != nil {
					return e
				}
				if i["state"] != "CLAIMED" || i["loop_id"] != r["active_loop_id"] {
					return fmt.Errorf("session/input claim mismatch")
				}
			}
		case "Input", "Consciousness":
			if _, e := lookup("Session", r["session_id"]); e != nil {
				return e
			}
		case "Execution":
			if _, e := lookup("TaskPlan", r["task_id"]); e != nil {
				return e
			}
			if r["result_id"] != nil {
				v, e := lookup("TaskResult", r["result_id"])
				if e != nil {
					return e
				}
				if v["execution_id"] != r["id"] {
					return fmt.Errorf("result ownership mismatch")
				}
			}
			if r["checkpoint_id"] != nil {
				v, e := lookup("Checkpoint", r["checkpoint_id"])
				if e != nil {
					return e
				}
				if v["execution_id"] != r["id"] {
					return fmt.Errorf("checkpoint ownership mismatch")
				}
			}
		case "ModelCall":
			v, e := lookup("Context", r["context_id"])
			if e != nil {
				return e
			}
			if v["call_id"] != r["id"] {
				return fmt.Errorf("call/context identity mismatch")
			}
		case "TaskResult", "Checkpoint", "Dispatch", "DecisionRequest", "Feedback", "ArchiveManifest":
			x, e := lookup("Execution", r["execution_id"])
			if e != nil {
				return e
			}
			if x["task_id"] != r["task_id"] {
				return fmt.Errorf("execution/task ownership mismatch")
			}
		case "AuthorizationRequest":
			o, e := lookup("Operation", r["operation_id"])
			if e != nil {
				return e
			}
			if d.Hash(d.Bytes(o["action"])) != d.Hash(d.Bytes(r["action"])) {
				return fmt.Errorf("authorization action differs from immutable operation")
			}
		case "WorldCommand":
			if _, e := lookup("Operation", r["operation_id"]); e != nil {
				return e
			}
		}
	}
	return nil
}
