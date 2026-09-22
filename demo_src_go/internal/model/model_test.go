package model

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResponsesKeysAndPartialResponse(t *testing.T) {
	var received []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = append(received, r.Header.Get("Authorization"))
		if r.Header.Get("x-opencode-session") == "" || r.Header.Get("User-Agent") != AdapterVersion {
			t.Error("missing adapter identity")
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "partial") {
			w.Write([]byte(`{"status":"incomplete","output":[{"type":"function_call"}]}`))
			return
		}
		w.Write([]byte(`{"status":"completed","output":[{"type":"message"}]}`))
	}))
	defer server.Close()
	c, e := New(server.URL, "main-secret", "task-secret")
	if e != nil {
		t.Fatal(e)
	}
	for _, purpose := range []string{"MAIN", "TASK"} {
		if _, e = c.Complete(context.Background(), []byte(`{}`), purpose); e != nil {
			t.Fatal(e)
		}
	}
	if received[0] != "Bearer main-secret" || received[1] != "Bearer task-secret" {
		t.Fatal("credential roles mixed")
	}
	c.Endpoint = server.URL + "/partial"
	if _, e = c.Complete(context.Background(), []byte(`{}`), "MAIN"); e == nil {
		t.Fatal("partial output accepted")
	}
}
