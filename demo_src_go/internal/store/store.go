// Package store provides a single-owner, checksummed, append-only JSON journal.
package store

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"sort"
	"strings"
	"sync"
)

type Store struct {
	transactionIDs   map[int64]string
	mu               sync.Mutex
	Root             string
	file, lock       *os.File
	records          map[string]d.R
	events, receipts []d.R
	seq, epoch       int64
	digest           string
	max              int
	poisoned         bool
}
type Tx struct {
	s                *Store
	changed          map[string]d.R
	events, receipts []d.R
}
type Frame struct {
	Payload string `json:"payload_b64"`
	Hash    string `json:"sha256"`
}

func Open(root string, max int) (s *Store, err error) {
	if !filepath.IsAbs(root) {
		root, err = filepath.Abs(root)
		if err != nil {
			return
		}
	}
	if err = mkdirDurable(filepath.Join(root, "journal")); err != nil {
		return
	}
	s = &Store{Root: root, records: map[string]d.R{}, transactionIDs: map[int64]string{}, digest: strings.Repeat("0", 64), max: max, epoch: 1}
	s.lock, err = os.OpenFile(filepath.Join(root, "owner.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(s.lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		s.lock.Close()
		return nil, fmt.Errorf("owner already running: %w", err)
	}
	defer func() {
		if err != nil {
			s.Close()
		}
	}()
	s.file, err = os.OpenFile(filepath.Join(root, "journal", "000001.jsonl"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return
	}
	if err = SyncDir(filepath.Join(root, "journal")); err != nil {
		return
	}
	if err = s.replay(); err != nil {
		return
	}
	if err = validateView(s.records); err != nil {
		return
	}
	s.epoch++
	_, err = s.file.Seek(0, io.SeekEnd)
	return
}
func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	if s.file != nil {
		s.file.Close()
	}
	if s.lock != nil {
		unix.Flock(int(s.lock.Fd()), unix.LOCK_UN)
		return s.lock.Close()
	}
	return nil
}
func SyncDir(path string) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}
func Atomic(path string, b []byte) error {
	if e := mkdirDurable(filepath.Dir(path)); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".write-")
	if e != nil {
		return e
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, e = f.Write(b); e == nil {
		e = f.Sync()
	}
	if x := f.Close(); e == nil {
		e = x
	}
	if e != nil {
		return e
	}
	if e = os.Rename(tmp, path); e != nil {
		return e
	}
	return SyncDir(filepath.Dir(path))
}
func (s *Store) Put(b []byte, media string) (d.R, error) {
	h := d.Hash(b)
	p := "objects/" + h[:2] + "/" + h
	ref := d.R{"path": p, "sha256": h, "bytes": int64(len(b)), "media_type": media}
	full := filepath.Join(s.Root, p)
	if old, e := os.ReadFile(full); e == nil {
		if !bytes.Equal(old, b) {
			return nil, errors.New("object content corruption")
		}
		return ref, nil
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	if e := Atomic(full, b); e != nil {
		return nil, e
	}
	if e := SyncDir(filepath.Join(s.Root, "objects")); e != nil {
		return nil, e
	}
	return ref, nil
}
func (s *Store) Read(ref d.R) ([]byte, error) {
	h := d.S(ref["sha256"])
	if len(h) != 64 || d.S(ref["path"]) != "objects/"+h[:2]+"/"+h {
		return nil, errors.New("invalid object path")
	}
	p := filepath.Join(s.Root, d.S(ref["path"]))
	for x := p; x != s.Root; x = filepath.Dir(x) {
		i, e := os.Lstat(x)
		if e != nil {
			return nil, e
		}
		if i.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("symlink object")
		}
	}
	b, e := os.ReadFile(p)
	if e != nil {
		return nil, e
	}
	if d.Hash(b) != h || int64(len(b)) != d.N(ref["bytes"]) {
		return nil, errors.New("object digest/length mismatch")
	}
	return b, nil
}
func (s *Store) CheckRefs(v any) error {
	switch x := v.(type) {
	case map[string]any:
		if _, ok := x["sha256"]; ok && x["path"] != nil && x["bytes"] != nil {
			_, e := s.Read(x)
			return e
		}
		for _, v := range x {
			if e := s.CheckRefs(v); e != nil {
				return e
			}
		}
	case []any:
		for _, v := range x {
			if e := s.CheckRefs(v); e != nil {
				return e
			}
		}
	}
	return nil
}
func key(typ, id string) string        { return typ + "/" + id }
func (s *Store) View(typ string) []d.R { s.mu.Lock(); defer s.mu.Unlock(); return s.view(typ) }
func (s *Store) view(typ string) []d.R {
	r := []d.R{}
	for _, v := range s.records {
		if d.S(v["record_type"]) == typ {
			r = append(r, d.Clone(v))
		}
	}
	sort.Slice(r, func(i, j int) bool { return d.S(r[i]["id"]) < d.S(r[j]["id"]) })
	return r
}
func (s *Store) Get(typ, id string) d.R {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r := s.records[key(typ, id)]; r != nil {
		return d.Clone(r)
	}
	return nil
}
func (s *Store) Events() []d.R {
	s.mu.Lock()
	defer s.mu.Unlock()
	a := []d.R{}
	for _, r := range s.events {
		a = append(a, d.Clone(r))
	}
	return a
}
func (s *Store) Epoch() int64    { return s.epoch }
func (s *Store) Sequence() int64 { s.mu.Lock(); defer s.mu.Unlock(); return s.seq }
func (t *Tx) Get(typ, id string) d.R {
	if r := t.changed[key(typ, id)]; r != nil {
		return d.Clone(r)
	}
	if r := t.s.records[key(typ, id)]; r != nil {
		return d.Clone(r)
	}
	return nil
}
func (t *Tx) List(typ string) []d.R {
	m := map[string]d.R{}
	for _, r := range t.s.view(typ) {
		m[d.S(r["id"])] = r
	}
	for _, r := range t.changed {
		if d.S(r["record_type"]) == typ {
			m[d.S(r["id"])] = d.Clone(r)
		}
	}
	a := []d.R{}
	for _, r := range m {
		a = append(a, r)
	}
	return a
}
func (t *Tx) Save(r d.R) error {
	k := key(d.S(r["record_type"]), d.S(r["id"]))
	old := t.s.records[k]
	if immutableRecord(d.S(r["record_type"])) && (old != nil || t.changed[k] != nil) {
		return fmt.Errorf("immutable %s cannot be saved twice", r["record_type"])
	}
	next := d.Clone(r)
	if old != nil {
		if d.N(r["revision"]) != d.N(old["revision"]) {
			return errors.New("CONFLICT revision")
		}
		next["revision"] = d.N(old["revision"]) + 1
		if r["record_type"] == "Execution" && !d.Edge("Retention", d.S(old["retention_state"]), d.S(next["retention_state"])) {
			return errors.New("invalid retention transition")
		}
		if a, b := d.S(old["state"]), d.S(next["state"]); a != "" && b != "" && !d.Edge(d.Machine(d.S(r["record_type"])), a, b) {
			return fmt.Errorf("invalid state edge %s %s -> %s", r["record_type"], a, b)
		}
	}
	if r["record_type"] == "Session" {
		next["last_journal_seq"] = t.s.seq + 1
	}
	next["updated_at"] = d.Now()
	t.changed[k] = next
	return nil
}
func (t *Tx) Object(v any) (d.R, error) { return t.s.Put(d.Bytes(v), "application/json") }
func (t *Tx) Log(kind, actor string, scope d.R, corr string, payload any) (d.R, error) {
	ref, e := t.Object(payload)
	if e != nil {
		return nil, e
	}
	r := d.Empty("OperationLogRecord")
	r["event_id"] = d.ID()
	r["stream"] = "SYSTEM"
	if scope["execution_id"] != nil {
		r["stream"] = "TASK"
	} else if scope["session_id"] != nil {
		r["stream"] = "MAIN"
	}
	r["scope"] = scope
	r["sequence"] = int64(len(t.s.events) + len(t.events) + 1)
	r["event_type"] = kind
	r["occurred_at"] = d.Now()
	r["recorded_at"] = d.Now()
	r["actor"] = actor
	r["payload"] = ref
	r["correlation_id"] = corr
	t.events = append(t.events, r)
	return r, nil
}
func (t *Tx) Receipt(id, hash, obj string) (d.R, error) {
	r := d.Empty("CommandReceipt")
	r["request_id"] = id
	r["request_hash"] = hash
	r["status"] = "ACCEPTED"
	r["object_id"] = obj
	r["journal_seq"] = t.s.seq + 1
	t.receipts = append(t.receipts, r)
	return r, nil
}
func (t *Tx) Existing(id, hash string) (d.R, error) {
	for _, r := range t.s.receipts {
		if d.S(r["request_id"]) == id {
			if d.S(r["request_hash"]) != hash {
				return nil, errors.New("CONFLICT request_id reused with different bytes")
			}
			return d.Clone(r), nil
		}
	}
	return nil, nil
}
func (s *Store) Update(fn func(*Tx) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.poisoned {
		return errors.New("RECOVERY_BLOCKED writer requires reopen")
	}
	t := &Tx{s: s, changed: map[string]d.R{}}
	if e := fn(t); e != nil {
		return e
	}
	if len(t.changed)+len(t.events)+len(t.receipts) == 0 {
		return nil
	}
	candidate := map[string]d.R{}
	for k, v := range s.records {
		candidate[k] = v
	}
	for k, v := range t.changed {
		candidate[k] = v
	}
	if e := validateView(candidate); e != nil {
		return e
	}
	j := d.Empty("JournalTransaction")
	j["txn_id"] = d.ID()
	j["sequence"] = s.seq + 1
	j["owner_epoch"] = s.epoch
	j["previous_digest"] = s.digest
	j["committed_at"] = d.Now()
	mut := []any{}
	for k, r := range t.changed {
		if e := d.Validate(d.S(r["record_type"]), r); e != nil {
			return fmt.Errorf("%s: %w", k, e)
		}
		if e := s.CheckRefs(r); e != nil {
			return e
		}
		ref, e := t.Object(r)
		if e != nil {
			return e
		}
		var rev int64
		if old := s.records[k]; old != nil {
			rev = d.N(old["revision"])
		}
		mut = append(mut, d.R{"object_type": r["record_type"], "object_id": r["id"], "expected_revision": rev, "new_revision": rev + 1, "snapshot": ref})
	}
	j["mutations"] = mut
	j["log_records"] = t.events
	j["receipts"] = t.receipts
	if j["log_records"] == nil || t.events == nil {
		j["log_records"] = []any{}
	}
	if t.receipts == nil {
		j["receipts"] = []any{}
	}
	if e := d.Validate("JournalTransaction", j); e != nil {
		return e
	}
	b := d.Bytes(j)
	if len(b) > s.max {
		return errors.New("journal frame too large")
	}
	f := Frame{base64.StdEncoding.EncodeToString(b), d.Hash(b)}
	line := append(d.Bytes(f), '\n')
	if _, e := s.file.Write(line); e != nil {
		s.poisoned = true
		return e
	}
	if e := s.file.Sync(); e != nil {
		s.poisoned = true
		return e
	}
	for k, r := range t.changed {
		s.records[k] = r
	}
	s.events = append(s.events, t.events...)
	s.receipts = append(s.receipts, t.receipts...)
	s.seq++
	s.transactionIDs[s.seq] = d.S(j["txn_id"])
	s.digest = f.Hash
	return nil
}
func (s *Store) replay() error {
	r := bufio.NewReaderSize(s.file, 65536)
	var offset int64
	for {
		line, e := r.ReadBytes('\n')
		if e == io.EOF {
			if len(line) > 0 {
				if x := Atomic(filepath.Join(s.Root, "journal", "incomplete-tail.bin"), line); x != nil {
					return x
				}
				if x := s.file.Truncate(offset); x != nil {
					return x
				}
				if x := s.file.Sync(); x != nil {
					return x
				}
			}
			break
		}
		if e != nil {
			return e
		}
		if len(line) > s.max*2 {
			return errors.New("RECOVERY_BLOCKED oversized frame")
		}
		var f Frame
		if e = d.Decode(line, &f); e != nil {
			return fmt.Errorf("RECOVERY_BLOCKED frame: %w", e)
		}
		b, e := base64.StdEncoding.DecodeString(f.Payload)
		if e != nil || len(b) > s.max || d.Hash(b) != f.Hash {
			return errors.New("RECOVERY_BLOCKED checksum")
		}
		var j d.R
		if e = d.Decode(b, &j); e != nil {
			return e
		}
		if e = d.Validate("JournalTransaction", j); e != nil {
			return e
		}
		if d.N(j["sequence"]) != s.seq+1 || d.S(j["previous_digest"]) != s.digest {
			return errors.New("RECOVERY_BLOCKED chain")
		}
		for _, v := range d.A(j["mutations"]) {
			m := d.M(v)
			b, e = s.Read(d.M(m["snapshot"]))
			if e != nil {
				return fmt.Errorf("RECOVERY_BLOCKED snapshot: %w", e)
			}
			var obj d.R
			if e = json.Unmarshal(b, &obj); e != nil {
				return e
			}
			if e = d.Validate(d.S(m["object_type"]), obj); e != nil {
				return e
			}
			k := key(d.S(m["object_type"]), d.S(m["object_id"]))
			rev := int64(0)
			if old := s.records[k]; old != nil {
				if immutableRecord(d.S(m["object_type"])) {
					return fmt.Errorf("RECOVERY_BLOCKED immutable %s modified", m["object_type"])
				}
				rev = d.N(old["revision"])
			}
			if d.N(m["expected_revision"]) != rev || d.N(m["new_revision"]) != rev+1 || d.N(obj["revision"]) != rev+1 || obj["id"] != m["object_id"] {
				return errors.New("RECOVERY_BLOCKED revision")
			}
			if e = s.CheckRefs(obj); e != nil {
				return fmt.Errorf("RECOVERY_BLOCKED reference: %w", e)
			}
			s.records[k] = obj
		}
		for _, v := range d.A(j["log_records"]) {
			ev := d.M(v)
			if d.N(ev["sequence"]) != int64(len(s.events)+1) {
				return errors.New("RECOVERY_BLOCKED event sequence")
			}
			if e = s.CheckRefs(ev); e != nil {
				return e
			}
			s.events = append(s.events, ev)
		}
		for _, v := range d.A(j["receipts"]) {
			s.receipts = append(s.receipts, d.M(v))
		}
		s.seq++
		s.transactionIDs[s.seq] = d.S(j["txn_id"])
		s.epoch = d.N(j["owner_epoch"])
		s.digest = f.Hash
		offset += int64(len(line))
	}
	return nil
}
func (s *Store) EventsUnsafe(t *Tx) []d.R {
	if t.s != s {
		panic("wrong transaction")
	}
	return s.events
}

func (s *Store) TransactionForRequest(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.receipts {
		if r["request_id"] == id {
			return s.transactionIDs[d.N(r["journal_seq"])]
		}
	}
	return ""
}
func (s *Store) KnownRef(ref d.R) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	wanted := d.Hash(d.Bytes(ref))
	var contains func(any) bool
	contains = func(v any) bool {
		switch x := v.(type) {
		case map[string]any:
			if x["sha256"] != nil && x["path"] != nil && d.Hash(d.Bytes(x)) == wanted {
				return true
			}
			for _, v := range x {
				if contains(v) {
					return true
				}
			}
		case []any:
			for _, v := range x {
				if contains(v) {
					return true
				}
			}
		}
		return false
	}
	for _, r := range s.records {
		if contains(r) {
			return true
		}
	}
	for _, r := range s.events {
		if contains(r) {
			return true
		}
	}
	return false
}
