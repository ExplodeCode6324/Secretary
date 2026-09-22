package engine

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
)

func TestDecisionDeadlineOrderingAndIdempotence(t *testing.T) {
	for _, order := range []string{"answer-before-deadline", "late-answer-before-expiry-sweep", "expiry-sweep-before-answer"} {
		t.Run(order, func(t *testing.T) {
			a := testApp(t, &fakeModel{})
			now := time.Now().UTC()
			a.Now = func() time.Time { return now }
			id, q := auditDecision(t, a)
			q["deadline"] = now.Add(time.Second).Format(time.RFC3339Nano)
			if err := a.Store.Update(func(tx *store.Tx) error { return tx.Save(q) }); err != nil {
				t.Fatal(err)
			}
			x := a.Store.Get("Execution", id)
			request := d.ID()
			args := d.R{"action": "ANSWER_DECISION", "target_id": id, "expected_revision": x["revision"], "decision_request_id": q["id"], "answer": "blue"}
			if order == "answer-before-deadline" {
				first, err := a.Control(request, args)
				if err != nil {
					t.Fatal(err)
				}
				now = now.Add(time.Second)
				if err = a.expireDecisions(); err != nil {
					t.Fatal(err)
				}
				seq := a.Store.Sequence()
				again, err := a.Control(request, args)
				if err != nil || first["object_id"] != again["object_id"] || a.Store.Sequence() != seq {
					t.Fatal("accepted answer lost idempotence after deadline", err)
				}
				return
			}
			now = now.Add(time.Second)
			if order == "expiry-sweep-before-answer" {
				if err := a.expireDecisions(); err != nil {
					t.Fatal(err)
				}
			}
			seq := a.Store.Sequence()
			if _, err := a.Control(request, args); err == nil {
				t.Fatal("deadline-inclusive answer accepted")
			}
			if a.Store.Sequence() != seq {
				t.Fatal("rejected answer wrote state")
			}
			if err := a.expireDecisions(); err != nil {
				t.Fatal(err)
			}
			saved := a.Store.Get("DecisionRequest", d.S(q["id"]))
			if saved["state"] != "EXPIRED" || saved["answer"] != nil {
				t.Fatal("expiry fabricated an answer")
			}
			if a.Store.Get("Execution", id)["state"] != "READY" {
				t.Fatal("expired decision left worker permanently parked")
			}
		})
	}
}
func TestContextImmutableAlsoDuringReplay(t *testing.T) {
	a := testApp(t, &fakeModel{})
	if _, err := a.Accept(d.ID(), []byte("freeze context")); err != nil {
		t.Fatal(err)
	}
	if err := a.runMain(context.Background()); err != nil {
		t.Fatal(err)
	}
	c := a.Store.View("Context")[0]
	seq := a.Store.Sequence()
	if err := a.Store.Update(func(tx *store.Tx) error { return tx.Save(c) }); err == nil {
		t.Fatal("even identical Context updates must get a new ID")
	}
	if a.Store.Sequence() != seq {
		t.Fatal("immutable violation appended journal")
	}
	// Append an otherwise valid, correctly checksummed second revision using a trusted
	// adversarial test adapter. Reopening must enforce immutability independently.
	c["provider_profile"] = "mutated-profile"
	c["revision"] = d.N(c["revision"]) + 1
	ref, err := a.Store.Put(d.Bytes(c), "application/json")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(a.Cfg.DataRoot, "journal/000001.jsonl")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	var frame store.Frame
	if err = d.Decode([]byte(lines[len(lines)-1]), &frame); err != nil {
		t.Fatal(err)
	}
	payload, _ := base64.StdEncoding.DecodeString(frame.Payload)
	var txn d.R
	if err = d.Decode(payload, &txn); err != nil {
		t.Fatal(err)
	}
	txn["sequence"] = d.N(txn["sequence"]) + 1
	txn["txn_id"] = d.ID()
	txn["previous_digest"] = frame.Hash
	txn["log_records"] = []any{}
	txn["receipts"] = []any{}
	txn["mutations"] = []any{d.R{"object_type": "Context", "object_id": c["id"], "expected_revision": 1, "new_revision": 2, "snapshot": ref}}
	payload = d.Bytes(txn)
	frame = store.Frame{Payload: base64.StdEncoding.EncodeToString(payload), Hash: d.Hash(payload)}
	a.Close()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Write(append(d.Bytes(frame), '\n'))
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := New(a.Cfg, &fakeModel{}, nil)
	if err == nil {
		reopened.Close()
		t.Fatal("replay accepted modified immutable Context")
	}
	if !strings.Contains(err.Error(), "immutable") {
		t.Fatal("wrong rejection", err)
	}
}
func TestResumedOperationIdentityHandoff(t *testing.T) {
	a := testApp(t, &fakeModel{})
	id := readyTask(t, a)
	if err := a.runTask(context.Background(), id); err != ErrWait {
		t.Fatal(err)
	}
	approve(t, a)
	op := a.Store.View("Operation")[0]
	old := identity(op)
	cfg := a.Cfg
	a.Close()
	b, err := New(cfg, &fakeModel{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	rebound := b.Store.Get("Operation", d.S(op["id"]))
	if identity(rebound).Epoch == old.Epoch || identity(rebound).Attempt != old.Attempt || rebound["state"] != "AUTHORIZED" {
		t.Fatal("restart did not preserve bounded authorization")
	}
	if err = b.set("Execution", id, "READY", nil); err != nil {
		t.Fatal(err)
	}
	if err = b.runTask(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	final := b.Store.Get("Operation", d.S(op["id"]))
	if final["state"] != "SUCCEEDED" || identity(final).Attempt == old.Attempt {
		t.Fatal("resumed operation did not bind new attempt")
	}
	count := 0
	for _, ev := range b.Store.Events() {
		if ev["event_type"] == "operation.dispatched" {
			count++
		}
	}
	if count != 1 {
		t.Fatal("effect dispatched more than once", count)
	}
}

type failingPersistenceModel struct {
	app   *App
	cause error
}

func (m failingPersistenceModel) Complete(context.Context, []byte, string) ([]byte, error) {
	source := filepath.Join(m.app.Cfg.DataRoot, "objects")
	if err := os.Rename(source, source+"-saved"); err != nil {
		return nil, err
	}
	if err := os.WriteFile(source, []byte("synthetic storage obstruction"), 0600); err != nil {
		return nil, err
	}
	return nil, m.cause
}
func TestPersistenceFailureIsNotHiddenByModelFailure(t *testing.T) {
	for _, compaction := range []bool{false, true} {
		t.Run(map[bool]string{false: "model", true: "compaction"}[compaction], func(t *testing.T) {
			a := testApp(t, &fakeModel{})
			if _, err := a.Accept(d.ID(), []byte("retain source during failure")); err != nil {
				t.Fatal(err)
			}
			if compaction {
				if err := a.runMain(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			cause := errors.New("synthetic provider interruption")
			a.Model = failingPersistenceModel{a, cause}
			objects := filepath.Join(a.Cfg.DataRoot, "objects")
			defer func() { _ = os.Remove(objects); _ = os.Rename(objects+"-saved", objects) }()
			var err error
			if compaction {
				err = a.Compact(context.Background(), true)
			} else {
				err = a.runMain(context.Background())
			}
			if !errors.Is(err, cause) || !strings.Contains(err.Error(), "persist ") {
				t.Fatal("state persistence failure was hidden", err)
			}
			if compaction {
				if len(d.A(a.Store.Get("Consciousness", a.ConsciousnessID)["pending_raw_refs"])) == 0 {
					t.Fatal("lost raw source on failed persistence")
				}
			} else {
				if a.Store.View("ModelCall")[0]["state"] != "IN_FLIGHT" {
					t.Fatal("claimed interruption persisted despite failed write")
				}
			}
		})
	}
}
