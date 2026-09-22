package engine

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
	"syscall"
	"time"
)

func (a *App) validateProgram(p d.R, params any) error {
	if p["state"] != "ENABLED" && p["state"] != "REGISTERED" {
		return errors.New("program disabled")
	}
	entry := d.S(p["entrypoint"])
	info, e := os.Lstat(entry)
	if e != nil {
		return e
	}
	if !filepath.IsAbs(entry) || !info.Mode().IsRegular() || info.Mode()&0111 == 0 {
		return errors.New("program must be a regular executable absolute path")
	}
	b, e := os.ReadFile(entry)
	if e != nil {
		return e
	}
	if d.Hash(b) != d.S(p["code_digest"]) {
		return errors.New("program code digest changed; re-register")
	}
	b, e = a.Store.Read(d.M(p["parameters_schema"]))
	if e != nil {
		return e
	}
	var schema any
	if e = d.Decode(b, &schema); e != nil {
		return e
	}
	return d.ValidateSchema(schema, params)
}

// ImportProgram is an explicit human CLI/UI boundary, unavailable to either agent.
func (a *App) ImportProgram(args d.R) (d.R, error) {
	entry := d.S(args["entrypoint"])
	full, e := filepath.Abs(entry)
	if e != nil {
		return nil, e
	}
	b, e := os.ReadFile(full)
	if e != nil {
		return nil, e
	}
	for _, key := range []string{"parameters_schema", "result_schema"} {
		if args[key] == nil {
			return nil, fmt.Errorf("%s required", key)
		}
	}
	p := d.New("ProgramRegistration")
	merge(p, d.R{"state": "REGISTERED", "name": args["name"], "description": args["description"], "entrypoint": full, "code_digest": d.Hash(b), "supports_resume": false, "maintained_by": "HUMAN", "operation_kinds": []any{"program.run"}})
	err := a.Store.Update(func(t *store.Tx) error {
		for _, key := range []string{"parameters_schema", "result_schema"} {
			ref, e := t.Object(args[key])
			if e != nil {
				return e
			}
			p[key] = ref
		}
		ref, e := t.Object(d.R{"entrypoint": full, "code_digest": p["code_digest"], "protocol": "stdin JSON; stdout one JSON result; argv empty; no arbitrary resume"})
		if e != nil {
			return e
		}
		p["validation_ref"] = ref
		return t.Save(p)
	})
	return p, err
}
func (a *App) EnableProgram(id string, enabled bool) error {
	state := "DISABLED"
	if enabled {
		state = "ENABLED"
	}
	return a.set("ProgramRegistration", id, state, nil)
}

func (a *App) runProgram(ctx context.Context, id string) error {
	x := a.Store.Get("Execution", id)
	p := a.Store.Get("TaskPlan", d.S(x["task_id"]))
	spec := d.M(p["executor"])
	reg := a.Store.Get("ProgramRegistration", d.S(spec["program_id"]))
	if reg == nil || reg["state"] != "ENABLED" || d.N(reg["revision"]) != d.N(spec["program_revision"]) {
		return a.finish(id, "FAILED", "程序登记已变更或禁用", []any{}, d.R{"program_available": false})
	}
	if e := a.validateProgram(reg, spec["parameters"]); e != nil {
		return a.finish(id, "FAILED", e.Error(), []any{}, d.R{"validation": e.Error()})
	}
	params := d.R{"program_id": reg["id"], "program_revision": reg["revision"], "code_digest": reg["code_digest"], "parameters": spec["parameters"], "capabilities": reg["operation_kinds"], "entrypoint": reg["entrypoint"], "workspace": p["workspace"]}
	opID := d.Stable(id + ":program.run")
	op, e := a.operation(opID, id, "program.run", d.S(reg["entrypoint"]), params)
	if e != nil {
		return e
	}
	if op["state"] == "WAIT_AUTH" {
		if e = a.set("Execution", id, "WAIT_AUTH", nil); e != nil {
			return e
		}
		return ErrWait
	}
	if op["state"] == "CANCELLED" {
		return a.finish(id, "FAILED", "程序启动被拒绝", []any{}, params)
	}
	if op["state"] == "RESULT_UNKNOWN" || op["state"] == "DISPATCHED" {
		return errors.New("RESULT_UNKNOWN program; cannot restart")
	}
	if op["state"] == "SUCCEEDED" {
		b, e := a.Store.Read(d.M(op["receipt"]))
		if e != nil {
			return e
		}
		var r d.R
		d.Decode(b, &r)
		return a.finish(id, "SUCCEEDED", "程序结果已保存", []any{}, r)
	}
	if e = a.validateProgram(reg, spec["parameters"]); e != nil {
		return e
	}
	if e = a.gate(opID); e != nil {
		return e
	}
	cmd := exec.Command(d.S(reg["entrypoint"]))
	cmd.Dir = filepath.Join(a.Cfg.WorkspaceRoot, d.S(p["id"]), "work")
	cmd.Env = []string{"PATH=/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "LANG=en_US.UTF-8"}
	cmd.Stdin = bytes.NewReader(d.Bytes(spec["parameters"]))
	stdout, e := os.CreateTemp(a.Cfg.DataRoot, "program-stdout-")
	if e != nil {
		return e
	}
	defer os.Remove(stdout.Name())
	defer stdout.Close()
	stderr, e := os.CreateTemp(a.Cfg.DataRoot, "program-stderr-")
	if e != nil {
		return e
	}
	defer os.Remove(stderr.Name())
	defer stderr.Close()
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if e = cmd.Start(); e != nil {
		if err := a.operationResult(opID, "FAILED", "NOT_APPLIED", d.R{"start_error": e.Error()}); err != nil {
			return errors.Join(e, err)
		}
		return a.finish(id, "FAILED", "程序未能启动", []any{}, d.R{"error": e.Error()})
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	interrupted := false
wait:
	for {
		select {
		case e = <-done:
			break wait
		case <-ctx.Done():
			interrupted = true
			syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			e = <-done
			break wait
		case <-ticker.C:
			if a.Store.Get("Execution", id)["cancel_requested"] == true {
				interrupted = true
				syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
				e = <-done
				break wait
			}
		}
	}
	if err := stdout.Sync(); err != nil {
		return err
	}
	if err := stderr.Sync(); err != nil {
		return err
	}
	outBytes, err := os.ReadFile(stdout.Name())
	if err != nil {
		return err
	}
	errBytes, err := os.ReadFile(stderr.Name())
	if err != nil {
		return err
	}
	outRef, err := a.Store.Put(outBytes, "application/octet-stream")
	if err != nil {
		return err
	}
	errRef, err := a.Store.Put(errBytes, "application/octet-stream")
	if err != nil {
		return err
	}
	detail := d.R{"stdout_ref": outRef, "stderr_ref": errRef, "exit_code": cmd.ProcessState.ExitCode(), "parameters": params}
	if err := a.Store.Update(func(t *store.Tx) error {
		_, err := t.Log("program.result", "PROGRAM", a.scopeTx(t, id), id, detail)
		return err
	}); err != nil {
		return err
	}
	if interrupted {
		if err := a.operationResult(opID, "RESULT_UNKNOWN", "UNKNOWN", detail); err != nil {
			return err
		}
		if err := a.set("Execution", id, "RESULT_UNKNOWN", nil); err != nil {
			return err
		}
		if err := a.feedback(id, "UNKNOWN", "程序已退出，但外部影响需要核验", nil); err != nil {
			return err
		}
		return ErrWait
	}
	if e != nil {
		if err := a.operationResult(opID, "FAILED", "PARTIAL", detail); err != nil {
			return errors.Join(e, err)
		}
		return a.finish(id, "FAILED", "程序返回非零退出码；不自动重试", []any{"external partial effects were not independently verified"}, detail)
	}
	b, e := a.Store.Read(d.M(reg["result_schema"]))
	if e != nil {
		return e
	}
	var schema, value any
	if d.Decode(b, &schema) != nil || d.Decode(outBytes, &value) != nil || d.ValidateSchema(schema, value) != nil {
		if err := a.operationResult(opID, "FAILED", "PARTIAL", detail); err != nil {
			return err
		}
		return a.finish(id, "FAILED", "程序输出不符合登记协议", []any{}, detail)
	}
	detail["result"] = value
	if e = a.operationResult(opID, "SUCCEEDED", "APPLIED", detail); e != nil {
		return e
	}
	return a.finish(id, "SUCCEEDED", "已登记程序执行完成", []any{}, detail)
}
