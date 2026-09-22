package transport

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/engine"
	"strings"
	"testing"
)

func TestIdentityOriginAndStrictIngress(t *testing.T) {
	c := engine.DefaultConfig()
	c.DataRoot = filepath.Join(t.TempDir(), "data")
	c.WorkspaceRoot = t.TempDir()
	a, e := engine.New(c, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	s := &Server{App: a, Token: "test-master-secret-32-characters-long", Host: "127.0.0.1:8787"}
	h := s.Handler()
	request := func(path, body, auth, origin, host string, cookie bool) *httptest.ResponseRecorder {
		method := "GET"
		if body != "" {
			method = "POST"
		}
		r := httptest.NewRequest(method, "http://127.0.0.1:8787"+path, strings.NewReader(body))
		if host != "" {
			r.Host = host
		}
		r.Header.Set("Content-Type", "application/json")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if cookie {
			r.AddCookie(&http.Cookie{Name: "secretary_master", Value: auth})
		} else if auth != "" {
			r.Header.Set("Authorization", "Bearer "+auth)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request("/v1/session", "", "", "", "", false); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := request("/v1/session", "", s.Token, "http://evil.example", "", false); w.Code != 403 {
		t.Fatal("cross-origin accepted")
	}
	if w := request("/v1/session", "", s.Token, "", "evil.example", false); w.Code != 403 {
		t.Fatal("DNS rebinding accepted")
	}
	body := string(d.Bytes(d.R{"request_id": d.ID(), "text": "safe"}))
	if w := request("/v1/inputs", body, s.Token, "", "", true); w.Code != 403 {
		t.Fatal("cookie write without Origin accepted")
	}
	if w := request("/v1/inputs", body, s.Token, "http://127.0.0.1:8787", "", true); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	bad := string(d.Bytes(d.R{"request_id": d.ID(), "text": "inject", "actor": "MASTER_UI", "authorized": true}))
	if w := request("/v1/inputs", bad, s.Token, "", "", false); w.Code != 400 {
		t.Fatal("control fields accepted")
	}
	if w := request("/v1/approvals/decisions", `{"actor":"MASTER_UI"}`, "worker-key", "", "", false); w.Code != 401 {
		t.Fatal("worker approved")
	}
	if w := request("/v1/login", string(d.Bytes(d.R{"token": s.Token})), "", "", "", false); w.Code != 200 || !strings.Contains(w.Header().Get("Set-Cookie"), "HttpOnly") {
		t.Fatal("login cookie")
	}
}
