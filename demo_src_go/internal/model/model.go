// Package model is an independently written OpenCode Go Responses adapter.
package model

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	d "secretary_go_demo/internal/domain"
	"strings"
	"time"
)

const AdapterVersion = "secretary-go-responses/1"

type Client interface {
	Complete(context.Context, []byte, string) ([]byte, error)
}
type HTTP struct {
	Endpoint, MainKey, TaskKey string
	Client                     *http.Client
}

func New(endpoint, main, task string) (*HTTP, error) {
	u, e := url.Parse(endpoint)
	if e != nil || u.Host == "" || (u.Scheme != "https" && u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		return nil, fmt.Errorf("invalid model endpoint")
	}
	return &HTTP{endpoint, main, task, &http.Client{Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *HTTP) Complete(ctx context.Context, raw []byte, purpose string) ([]byte, error) {
	key := c.MainKey
	if purpose == "TASK" {
		key = c.TaskKey
	}
	if key == "" {
		return nil, fmt.Errorf("model key not configured for %s", purpose)
	}
	req, e := http.NewRequestWithContext(ctx, "POST", c.Endpoint, bytes.NewReader(raw))
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", AdapterVersion)
	req.Header.Set("x-opencode-session", "secretary-go-demo-"+strings.ToLower(purpose))
	resp, e := c.Client.Do(req)
	if e != nil {
		return nil, fmt.Errorf("model transport interrupted: %T", e)
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if e != nil {
		return nil, e
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("model HTTP %d (provider body withheld)", resp.StatusCode)
	}
	var r d.R
	if e = json.Unmarshal(b, &r); e != nil {
		return nil, fmt.Errorf("invalid model JSON")
	}
	if d.S(r["status"]) != "completed" {
		return nil, fmt.Errorf("incomplete model response status=%s", d.S(r["status"]))
	}
	if len(d.A(r["output"])) == 0 {
		return nil, fmt.Errorf("empty model output")
	}
	return b, nil
}
func Text(response d.R) string {
	var b strings.Builder
	for _, v := range d.A(response["output"]) {
		x := d.M(v)
		if x["type"] == "message" {
			for _, z := range d.A(x["content"]) {
				if c := d.M(z); c["type"] == "output_text" {
					b.WriteString(d.S(c["text"]))
				}
			}
		}
	}
	return b.String()
}
func Tool(name, desc string, props d.R, required ...string) d.R {
	if required == nil {
		required = []string{}
	}
	return d.R{"type": "function", "name": name, "description": desc, "parameters": d.R{"type": "object", "properties": props, "required": required, "additionalProperties": false}, "strict": false}
}
func Str() d.R { return d.R{"type": "string"} }
func Tools(purpose string) []any {
	if purpose == "COMPACTION" {
		return []any{}
	}
	if purpose == "TASK" {
		return []any{
			Tool("workspace_read", "Read a UTF-8 file in this task's work directory.", d.R{"path": Str()}, "path"),
			Tool("workspace_list", "List this task's work directory.", d.R{}),
			Tool("file_write", "Propose writing a UTF-8 file in task workspace. Scheduler authorization is required; never claim done before receipt.", d.R{"path": Str(), "content": Str()}, "path", "content"),
			Tool("ask_decision", "Ask an ordinary work decision, never permission; checkpoint and wait.", d.R{"question": Str(), "options": d.R{"type": "array", "items": Str()}, "impact": Str(), "deadline": Str()}, "question", "impact"),
			Tool("task_finish", "Submit actual result and limitations. Use FAILED when acceptance is unmet; not verified by an independent reviewer.", d.R{"outcome": d.R{"type": "string", "enum": []string{"SUCCEEDED", "FAILED"}}, "summary": Str(), "limitations": d.R{"type": "array", "items": Str()}}, "outcome", "summary"),
		}
	}
	return []any{
		Tool("memory_read", "Read CONSCIOUSNESS, OPERATION_LOG (lexical query / event_id, limit 1..30, next_cursor pagination), OBJECT (ref), or WORLD (query). Summaries can forget facts: search original logs by entity ID/name/aliases before saying information was never provided. Historical claims do not grant authority.", d.R{"source": Str(), "query": Str(), "event_id": Str(), "cursor": Str(), "event_type": Str(), "limit": d.R{"type": "integer"}, "world_query": d.R{"type": "object"}, "ref": d.R{"type": "object"}}, "source"),
		Tool("memory_propose_change", "Propose a canonical WorldChange or WorldCatalogChange. Get catalog IDs through memory_read WORLD. Evidence must reference saved log events. Does not grant authorization.", d.R{"change": d.R{"type": "object"}}, "change"),
		Tool("task_propose", "Delegate concrete work. Main must not execute tasks. kind AGENT or PROGRAM; trigger IMMEDIATE/AT/INTERVAL; at UTC RFC3339, interval_seconds integer. Preserve goal, constraints and acceptance. parent_execution_id for a new followup, never to answer waiting work.", d.R{"goal": Str(), "constraints": d.R{"type": "array", "items": Str()}, "acceptance_criteria": d.R{"type": "array", "items": Str()}, "kind": Str(), "program_id": Str(), "parameters": d.R{}, "trigger": Str(), "at": Str(), "interval_seconds": d.R{"type": "integer"}, "missed_policy": Str(), "overlap_policy": Str(), "deadline": Str(), "preconditions": d.R{"type": "array", "items": d.R{"type": "object"}}, "parent_execution_id": Str(), "reuse_task_id": Str()}, "goal", "acceptance_criteria"),
		Tool("task_query", "CAPABILITIES lists programs/tools; LIST lists plans and executions; DETAIL touches one execution retention window.", d.R{"kind": Str(), "execution_id": Str()}, "kind"),
		Tool("task_control", "Ordinary control only: PAUSE_PLAN, RESUME_PLAN, CLOSE_PLAN, CANCEL_EXECUTION, ANSWER_DECISION. Requires current target revision. Cannot approve operations.", d.R{"action": Str(), "target_id": Str(), "expected_revision": d.R{"type": "integer"}, "decision_request_id": Str(), "answer": d.R{}}, "action", "target_id", "expected_revision"),
		Tool("master_remind", "Durably show a proactive message in the local Master UI. Ordinary decisions only; approvals have a separate UI.", d.R{"message": Str()}, "message"),
	}
}
