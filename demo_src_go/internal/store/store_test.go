package store

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"testing"
	"time"
)

func TestJournalRecoveryAndOwnership(t *testing.T) {
	root := t.TempDir()
	s, e := Open(root, 1<<20)
	if e != nil {
		t.Fatal(e)
	}
	if second, e := Open(root, 1<<20); e == nil {
		second.Close()
		t.Fatal("second owner accepted")
	}
	r := d.New("SafetyRule")
	r["created_by"] = "MASTER_UI"
	if e = s.Update(func(tx *Tx) error { return tx.Save(r) }); e != nil {
		t.Fatal(e)
	}
	raw := []byte("exact\x00raw\r\n中文")
	ref, e := s.Put(raw, "application/octet-stream")
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	f, e := os.OpenFile(filepath.Join(root, "journal/000001.jsonl"), os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	f.WriteString("{broken tail")
	f.Close()
	s, e = Open(root, 1<<20)
	if e != nil {
		t.Fatal(e)
	}
	if s.Get("SafetyRule", d.S(r["id"])) == nil {
		t.Fatal("lost committed record")
	}
	b, e := s.Read(ref)
	if e != nil || !bytes.Equal(raw, b) {
		t.Fatal("raw context changed")
	}
	s.Close()
	b, e = os.ReadFile(filepath.Join(root, "journal/000001.jsonl"))
	if e != nil {
		t.Fatal(e)
	}
	b[30] ^= 1
	os.WriteFile(filepath.Join(root, "journal/000001.jsonl"), b, 0600)
	if s, e = Open(root, 1<<20); e == nil {
		s.Close()
		t.Fatal("corrupt committed frame accepted")
	}
}
func TestRollbackCASAndMissingObject(t *testing.T) {
	root := t.TempDir()
	s, e := Open(root, 1<<20)
	if e != nil {
		t.Fatal(e)
	}
	r := d.New("SafetyRule")
	r["created_by"] = "MASTER_UI"
	if e = s.Update(func(tx *Tx) error { return tx.Save(r) }); e != nil {
		t.Fatal(e)
	}
	stale := d.Clone(r)
	if e = s.Update(func(tx *Tx) error { return tx.Save(r) }); e != nil {
		t.Fatal(e)
	}
	seq := s.Sequence()
	if e = s.Update(func(tx *Tx) error { return tx.Save(stale) }); e == nil {
		t.Fatal("stale revision accepted")
	}
	if s.Sequence() != seq {
		t.Fatal("rejected write committed")
	}
	s.Close()
	files, _ := filepath.Glob(filepath.Join(root, "objects/*/*"))
	os.Remove(files[0])
	if s, e = Open(root, 1<<20); e == nil {
		s.Close()
		t.Fatal("missing immutable object accepted")
	}
}

func TestKillAfterDurableACK(t *testing.T) {
	if root := os.Getenv("SECRETARY_TEST_CHILD_ROOT"); root != "" {
		s, e := Open(root, 1<<20)
		if e != nil {
			os.Exit(31)
		}
		r := d.New("SafetyRule")
		r["created_by"] = "MASTER_UI"
		if e = s.Update(func(tx *Tx) error { return tx.Save(r) }); e != nil {
			os.Exit(32)
		}
		fmt.Println("ACK")
		for {
			time.Sleep(time.Hour)
		}
	}
	root := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestKillAfterDurableACK$")
	cmd.Env = append(os.Environ(), "SECRETARY_TEST_CHILD_ROOT="+root)
	pipe, e := cmd.StdoutPipe()
	if e != nil {
		t.Fatal(e)
	}
	if e = cmd.Start(); e != nil {
		t.Fatal(e)
	}
	defer cmd.Process.Kill()
	scan := bufio.NewScanner(pipe)
	if !scan.Scan() || scan.Text() != "ACK" {
		t.Fatal("child failed before ACK")
	}
	if e = cmd.Process.Kill(); e != nil {
		t.Fatal(e)
	}
	cmd.Wait()
	s, e := Open(root, 1<<20)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if len(s.View("SafetyRule")) != 1 {
		t.Fatal("ACKed transaction lost after SIGKILL")
	}
}
