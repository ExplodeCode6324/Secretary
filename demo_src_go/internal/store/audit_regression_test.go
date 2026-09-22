package store

import (
	"encoding/base64"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"testing"
)

func auditCorrupt(t *testing.T, mode string) {
	t.Helper()
	root := t.TempDir()
	s, e := Open(root, 1<<20)
	if e != nil {
		t.Fatal(e)
	}
	e = s.Update(func(tx *Tx) error {
		_, e := tx.Log("audit.event", "HOST", d.Scope("", "", ""), d.ID(), d.R{"test": true})
		return e
	})
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	file := filepath.Join(root, "journal/000001.jsonl")
	b, e := os.ReadFile(file)
	if e != nil {
		t.Fatal(e)
	}
	var frame d.R
	if e = d.Decode(b, &frame); e != nil {
		t.Fatal(e)
	}
	switch mode {
	case "extra":
		frame["unrecognized_control"] = true
	case "base64":
		frame["payload_b64"] = "!" + d.S(frame["payload_b64"])
	case "event":
		payload, e := base64.StdEncoding.DecodeString(d.S(frame["payload_b64"]))
		if e != nil {
			t.Fatal(e)
		}
		var txn d.R
		if e = d.Decode(payload, &txn); e != nil {
			t.Fatal(e)
		}
		d.M(d.A(txn["log_records"])[0])["sequence"] = 999
		payload = d.Bytes(txn)
		frame["payload_b64"] = base64.StdEncoding.EncodeToString(payload)
		frame["sha256"] = d.Hash(payload)
	}
	if e = os.WriteFile(file, append(d.Bytes(frame), '\n'), 0600); e != nil {
		t.Fatal(e)
	}
	reopened, e := Open(root, 1<<20)
	if e == nil {
		reopened.Close()
		t.Fatal("recovery accepted malformed", mode)
	}
}
func TestAudit_AUD08(t *testing.T) { auditCorrupt(t, "extra") }
func TestAudit_AUD09(t *testing.T) { auditCorrupt(t, "base64") }
func TestAudit_AUD10(t *testing.T) { auditCorrupt(t, "event") }
