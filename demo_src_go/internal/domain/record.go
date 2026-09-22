// Package domain holds schema-checked records and the canonical transition graph.
// Records deliberately retain JSON values, including provider extension blocks.
package domain

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"io"
	"regexp"
	"secretary_go_demo/assets"
	"strings"
	"time"
)

type R = map[string]any

var definitions R
var validators = map[string]*jsonschema.Schema{}
var machines R

func init() {
	b, _ := assets.Files.ReadFile("contracts.schema.json")
	var root R
	must(json.Unmarshal(b, &root))
	definitions = M(root["$defs"])
	c := jsonschema.NewCompiler()
	c.UseRegexpEngine(compilePattern)
	c.AssertFormat()
	must(c.AddResource("https://secretary.local/contracts", root))
	for name := range definitions {
		v, e := c.Compile("https://secretary.local/contracts#/$defs/" + name)
		must(e)
		validators[name] = v
	}
	b, _ = assets.Files.ReadFile("state-machines.json")
	must(json.Unmarshal(b, &root))
	machines = M(root["machines"])
}
func must(e error) {
	if e != nil {
		panic(e)
	}
}
func ID() string {
	b := make([]byte, 16)
	_, e := rand.Read(b)
	must(e)
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func Stable(s string) string {
	b := sha256.Sum256([]byte(s))
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
func Hash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func Now() string          { return time.Now().UTC().Format(time.RFC3339Nano) }
func Bytes(v any) []byte   { b, e := json.Marshal(v); must(e); return b }
func Clone(r R) R          { var x R; must(json.Unmarshal(Bytes(r), &x)); return x }
func M(v any) R            { r, _ := v.(map[string]any); return r }
func S(v any) string       { s, _ := v.(string); return s }
func N(v any) int64 {
	switch n := v.(type) {
	case int:
		return int64(n)
	case int64:
		return n
	case float64:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	}
	return 0
}
func A(v any) []any { a, _ := v.([]any); return a }
func Strings(v any) []string {
	var r []string
	for _, x := range A(v) {
		r = append(r, S(x))
	}
	return r
}
func Has(a any, s string) bool {
	for _, v := range A(a) {
		if S(v) == s {
			return true
		}
	}
	return false
}
func Time(v any) time.Time { t, _ := time.Parse(time.RFC3339Nano, S(v)); return t }
func Decode(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	if d.Decode(new(any)) != io.EOF {
		return fmt.Errorf("invalid trailing JSON")
	}
	return nil
}
func Validate(name string, v any) error {
	schema := validators[name]
	if schema == nil {
		return fmt.Errorf("unknown record %s", name)
	}
	var x any
	if e := json.Unmarshal(Bytes(v), &x); e != nil {
		return e
	}
	return schema.Validate(x)
}
func ValidateSchema(s any, v any) error {
	var normalized any
	if e := json.Unmarshal(Bytes(s), &normalized); e != nil {
		return e
	}
	s = normalized
	if e := json.Unmarshal(Bytes(v), &normalized); e != nil {
		return e
	}
	v = normalized
	c := jsonschema.NewCompiler()
	c.UseRegexpEngine(compilePattern)
	if e := c.AddResource("https://secretary.local/value", s); e != nil {
		return e
	}
	x, e := c.Compile("https://secretary.local/value")
	if e != nil {
		return e
	}
	return x.Validate(v)
}

// Empty fills only structural defaults, never authority or business decisions.
func Empty(name string) R { return M(empty(M(definitions[name]))) }
func empty(s R) any {
	if ref := S(s["$ref"]); ref != "" {
		return empty(M(definitions[strings.TrimPrefix(ref, "#/$defs/")]))
	}
	if v, ok := s["const"]; ok {
		return v
	}
	if _, ok := s["anyOf"]; ok {
		return nil
	}
	switch S(s["type"]) {
	case "object":
		r := R{}
		for k, v := range M(s["properties"]) {
			r[k] = empty(M(v))
		}
		return r
	case "array":
		return []any{}
	case "integer":
		return int64(0)
	case "boolean":
		return false
	case "string":
		return ""
	}
	return nil
}
func New(name string) R {
	r := Empty(name)
	r["id"] = ID()
	r["revision"] = int64(1)
	r["updated_at"] = Now()
	return r
}
func Scope(session, task, execution string) R {
	r := Empty("Scope")
	if session != "" {
		r["session_id"] = session
	}
	if task != "" {
		r["task_id"] = task
	}
	if execution != "" {
		r["execution_id"] = execution
	}
	return r
}
func Move(machine, from, event string, guard bool) (string, error) {
	if !guard {
		return "", fmt.Errorf("%s guard rejected", machine)
	}
	for _, v := range A(M(machines[machine])["transitions"]) {
		t := M(v)
		if S(t["from"]) == from && S(t["event"]) == event {
			return S(t["to"]), nil
		}
	}
	return "", fmt.Errorf("invalid %s transition %s/%s", machine, from, event)
}
func Edge(machine, from, to string) bool {
	if from == to {
		return true
	}
	for _, v := range A(M(machines[machine])["transitions"]) {
		t := M(v)
		if S(t["from"]) == from && S(t["to"]) == to {
			return true
		}
	}
	return false
}
func Machine(typ string) string {
	switch typ {
	case "Session":
		return "Host"
	case "ModelCall":
		return "Call"
	case "CompactionJob":
		return "Compaction"
	case "TaskPlan":
		return "Plan"
	case "AuthorizationRequest":
		return "Authorization"
	case "DecisionRequest":
		return "Decision"
	case "ProgramRegistration":
		return "Program"
	}
	return typ
}

// RE2 has no lookahead; the canonical RelativePath predicate is equivalent to
// these bounded string checks. All other expressions use linear-time RE2.
type relativePattern string

func (p relativePattern) String() string { return string(p) }
func (p relativePattern) MatchString(s string) bool {
	if s == "" || strings.HasPrefix(s, "/") || strings.ContainsRune(s, 0) {
		return false
	}
	for _, seg := range strings.Split(s, "/") {
		if seg == ".." {
			return false
		}
	}
	return true
}
func compilePattern(s string) (jsonschema.Regexp, error) {
	if s == S(M(definitions["RelativePath"])["pattern"]) {
		return relativePattern(s), nil
	}
	return regexp.Compile(s)
}
