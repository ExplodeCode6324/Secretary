package engine

import (
	"fmt"
	"os"
	"runtime"
	d "secretary_go_demo/internal/domain"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAuditLoad(t *testing.T) {
	a := testApp(t, &fakeModel{})
	type request struct{ id, text string }
	req := make([]request, 1000)
	for i := range req {
		req[i] = request{d.ID(), fmt.Sprintf("%d:", i) + strings.Repeat("x", 1024)}
	}
	start := time.Now()
	phases := []any{}
	for n := 0; n < 1000; n += 20 {
		var wg sync.WaitGroup
		errs := make(chan error, 20)
		for _, r := range req[n : n+20] {
			wg.Add(1)
			go func(r request) {
				defer wg.Done()
				first, e := a.Accept(r.id, []byte(r.text))
				if e != nil {
					errs <- e
					return
				}
				again, e := a.Accept(r.id, []byte(r.text))
				if e != nil {
					errs <- e
					return
				}
				if first["object_id"] != again["object_id"] {
					errs <- fmt.Errorf("duplicate mismatch")
				}
			}(r)
		}
		wg.Wait()
		close(errs)
		for e := range errs {
			t.Fatal(e)
		}
		if n+20 == 100 || n+20 == 500 || n+20 == 1000 {
			var mem runtime.MemStats
			runtime.ReadMemStats(&mem)
			phases = append(phases, d.R{"inputs": n + 20, "elapsed_ms": float64(time.Since(start).Microseconds()) / 1000, "heap_bytes": mem.HeapAlloc})
		}
	}
	if len(a.Store.View("Input")) != 1000 {
		t.Fatal("lost/duplicate inputs")
	}
	cfg := a.Cfg
	a.Close()
	reopen := time.Now()
	b, e := New(cfg, &fakeModel{}, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	recovery := time.Since(reopen)
	after := b.Store.View("Input")
	if len(after) != 1000 {
		t.Fatal("recovery count")
	}
	byID := map[string]d.R{}
	for _, i := range after {
		byID[d.S(i["dedupe_key"])] = i
	}
	for _, r := range req {
		i := byID[r.id]
		raw, e := b.Store.Read(d.M(i["payload"]))
		if e != nil || string(raw) != r.text || i["state"] != "ACCEPTED" {
			t.Fatal("recovery bytes/state", e)
		}
	}
	report := d.R{"implementation": "go", "inputs": 1000, "attempts": 2000, "phases": phases, "recovery_ms": float64(recovery.Microseconds()) / 1000, "verdict": "PASS", "limitations": []string{"short ingestion/recovery load, not continuous uptime", "20 goroutines, race detector enabled"}}
	if e = os.WriteFile(os.Getenv("AUDIT_LOAD_REPORT"), d.Bytes(report), 0600); e != nil {
		t.Fatal(e)
	}
}
