package transport

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/engine"
	"secretary_go_demo/internal/store"
	"strconv"
	"strings"
)

type Server struct {
	App         *engine.App
	Token, Host string
}

func Token(root string) (string, error) {
	p := filepath.Join(root, "master.token")
	if b, e := os.ReadFile(p); e == nil {
		if len(b) < 32 {
			return "", errors.New("invalid Master token")
		}
		return strings.TrimSpace(string(b)), nil
	} else if !os.IsNotExist(e) {
		return "", e
	}
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	return token, store.Atomic(p, []byte(token))
}
func (s *Server) Handler() http.Handler { return http.HandlerFunc(s.serve) }
func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if r.Host != s.Host {
		http.Error(w, "invalid Host", 403)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+s.Host {
		http.Error(w, "cross-origin request denied", 403)
		return
	}
	if r.URL.Path == "/" || r.URL.Path == "/v1/login" {
		http.NotFound(w, r)
		return
	}
	if r.URL.Path == "/healthz" && r.Method == "GET" {
		reply(w, d.R{"status": "ok", "interface": "TUI"})
		return
	}
	auth := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !equal(auth, s.Token) {
		http.Error(w, "unauthorized", 401)
		return
	}
	a := s.App
	var out any
	var err error
	switch r.Method + " " + r.URL.Path {
	case "GET /v1/session":
		out = d.R{"session": a.Store.Get("Session", a.SessionID), "runtime": a.Status(), "consciousness": a.Store.Get("Consciousness", a.ConsciousnessID), "sequence": a.Store.Sequence()}
	case "GET /v1/events":
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		events := []any{}
		next := after
		for _, ev := range a.Store.Events() {
			if d.N(ev["sequence"]) <= after {
				continue
			}
			b, e := a.Store.Read(d.M(ev["payload"]))
			if e != nil {
				err = e
				break
			}
			var value any
			if json.Unmarshal(b, &value) != nil {
				value = string(b)
			}
			events = append(events, d.R{"event": ev, "payload": value})
			next = d.N(ev["sequence"])
			if len(events) >= 100 {
				break
			}
		}
		out = d.R{"events": events, "next": next}
	case "POST /v1/inputs":
		var body struct {
			RequestID string `json:"request_id"`
			Text      string `json:"text"`
		}
		if err = decode(w, r, &body); err == nil {
			out, err = a.Accept(body.RequestID, []byte(body.Text))
		}
	case "GET /v1/tasks":
		out, err = a.Query("LIST", "")
	case "GET /v1/task-detail":
		out, err = a.Query("DETAIL", r.URL.Query().Get("execution_id"))
	case "POST /v1/task-control":
		var body struct {
			RequestID string `json:"request_id"`
			Args      d.R    `json:"args"`
		}
		if err = decode(w, r, &body); err == nil {
			out, err = a.Control(body.RequestID, body.Args)
		}
	case "POST /v1/task-proposals":
		var body struct {
			RequestID string `json:"request_id"`
			Args      d.R    `json:"args"`
		}
		if err = decode(w, r, &body); err == nil {
			out, err = a.Propose(body.RequestID, body.Args)
		}
	case "GET /v1/approvals":
		list := []any{}
		for _, q := range a.Store.View("AuthorizationRequest") {
			b, e := a.Store.Read(d.M(q["display_ref"]))
			if e != nil {
				err = e
				break
			}
			var display any
			json.Unmarshal(b, &display)
			list = append(list, d.R{"request": q, "display": display})
		}
		out = list
	case "POST /v1/approvals/decisions":
		var body d.R
		if err = decode(w, r, &body); err == nil {
			out, err = a.Approve(body)
		}
	case "GET /v1/operations":
		out = a.Store.View("Operation")
	case "POST /v1/reconcile":
		var body struct {
			OperationID string `json:"operation_id"`
		}
		if err = decode(w, r, &body); err == nil {
			out, err = a.ReconcileFile(body.OperationID)
		}
	case "POST /v1/rules":
		var body struct {
			RequestID string `json:"request_id"`
			Args      d.R    `json:"args"`
		}
		if err = decode(w, r, &body); err == nil {
			out, err = a.Rule(body.RequestID, body.Args)
		}
	case "GET /v1/rules":
		out = a.Store.View("AuthorizationRule")
	case "GET /v1/rule-detail":
		rule := a.Store.Get("AuthorizationRule", r.URL.Query().Get("id"))
		if rule == nil {
			err = errors.New("NOT_FOUND rule")
			break
		}
		var raw []byte
		raw, err = a.Store.Read(d.M(rule["parameter_constraints"]))
		if err == nil {
			var constraints any
			err = d.Decode(raw, &constraints)
			out = d.R{"rule": rule, "parameter_constraints": constraints}
		}
	case "GET /v1/notifications":
		list := []any{}
		for _, n := range a.Store.View("Notification") {
			var raw []byte
			raw, err = a.Store.Read(d.M(n["message"]))
			if err != nil {
				break
			}
			n["text"] = string(raw)
			list = append(list, n)
		}
		out = list
	case "POST /v1/notifications/ack":
		var body struct {
			ID string `json:"id"`
		}
		if err = decode(w, r, &body); err == nil {
			err = a.AcknowledgeNotification(body.ID)
			out = d.R{"ok": err == nil}
		}
	case "POST /v1/retry":
		a.Retry()
		out = d.R{"ok": true}
	case "POST /v1/maintenance":
		a.Maintain()
		out = d.R{"queued": true}
	case "POST /v1/world/query":
		var q d.R
		if err = decode(w, r, &q); err == nil {
			out, err = a.Memory(r.Context(), d.R{"source": "WORLD", "world_query": q})
		}
	case "GET /v1/world":
		out, err = a.Memory(r.Context(), d.R{"source": "WORLD", "query": r.URL.Query().Get("q")})
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, out)
}
func equal(a, b string) bool {
	return len(a) > 0 && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return errors.New("application/json required")
	}
	b, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if e != nil {
		return e
	}
	return d.Decode(b, v)
}
func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, e error) {
	code := 400
	msg := e.Error()
	switch {
	case strings.Contains(msg, "CONFLICT"):
		code = 409
	case strings.Contains(msg, "NOT_FOUND"):
		code = 404
	case strings.Contains(msg, "RETIRED"):
		code = 410
	case strings.Contains(msg, "unavailable"):
		code = 503
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(d.R{"error": msg})
}
