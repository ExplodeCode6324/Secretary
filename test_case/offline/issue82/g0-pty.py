"""Bounded synthetic PTY checks. This is never Terminal.app or IME evidence."""
import fcntl
import glob
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

base = os.path.abspath(".demo-data/issue82-tui/g0")
report = {"synthetic_only": True, "ime": "NOT_TESTED", "runs": []}


def events(directory):
    try:
        with open(os.path.join(directory, "trace.jsonl")) as source:
            return [json.loads(line) for line in source if line.endswith("\n")]
    except (FileNotFoundError, json.JSONDecodeError):
        return []


for scenario in ("normal", "hangup", "parent-kill"):
    before = set(glob.glob(base + "/run-*"))
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))

    def session():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    process = subprocess.Popen([sys.argv[1], "--import", "tsx", "src/pi_secretary/scripts/issue82-g0.ts", "--slow-save"], stdin=slave, stdout=slave, stderr=slave, preexec_fn=session, close_fds=True, env={**os.environ, "TERM": "xterm-256color", "TERM_PROGRAM": "G0_SYNTHETIC_PTY"})
    os.close(slave)
    captured = bytearray()
    directory = None

    def pump(seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if master is not None and select.select([master], [], [], 0.02)[0]:
                try:
                    data = os.read(master, 65536)
                    if data:
                        captured.extend(data)
                except OSError:
                    pass
            else:
                time.sleep(0.01)

    try:
        for _ in range(100):
            pump(0.03)
            created = set(glob.glob(base + "/run-*")) - before
            if created:
                directory = sorted(created)[0]
                if any(event["kind"] == "started" for event in events(directory)):
                    break
            if process.poll() is not None:
                raise RuntimeError("probe failed startup: " + bytes(captured).decode("utf8", "replace"))
        assert directory and any(event["kind"] == "started" for event in events(directory)), "startup timeout"
        os.write(master, "\x1b[200~中文\t😀\r\nline\x1b[201~".encode())
        pump(0.85)
        if scenario == "normal":
            for columns, rows in ((80, 24), (120, 40), (40, 12), (30, 10)):
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
                os.kill(process.pid, signal.SIGWINCH)
                pump(0.12)
            os.write(master, b"\x13")  # Below minimum: ignored.
            pump(0.10)
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
            os.kill(process.pid, signal.SIGWINCH)
            pump(0.10)
            os.write(master, b"\r\x13")
            pump(0.10)
            os.write(master, b"\x03")
        else:
            os.write(master, b"queued")
            pump(0.22)  # In-flight delayed atomic operation.
            if scenario == "hangup":
                os.close(master)
                master = None
            else:
                os.kill(process.pid, signal.SIGKILL)
        for _ in range(200):
            pump(0.02)
            if process.poll() is not None:
                break
        assert process.poll() is not None, "probe exit timeout"
        pump(0.65)  # Helper completes current atomic op after parent pipe EOF.
        trace = events(directory)
        errors = [event for event in trace if event["kind"] in ("exception", "rejection")]
        assert not errors, errors
        with open(os.path.join(directory, "state/snapshot.json")) as source:
            saved = json.load(source)
        if scenario == "normal":
            assert process.returncode == 0, process.returncode
            assert saved["value"]["submits"] == 1, saved
            assert saved["value"]["draft"] == "中文\t😀\nline\n", saved
            assert b"\x1b[?2004l" in captured and b"\x1b[?1049l" in captured
            assert b"\x1b]52;" not in captured and b"\x1b]8;" not in captured
        else:
            assert saved["value"]["draft"] == "中文\t😀\nlinequeued", saved
        # New writer must acquire the released lock, without killing any holder.
        helper = subprocess.Popen(["/usr/bin/python3", "src/pi_secretary/scripts/issue82-g0/writer.py", directory + "/state"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = helper.communicate(timeout=2)
        assert helper.returncode == 0 and b'"ready": true' in stdout, (helper.returncode, stderr)
        with open(directory + "/pty-output.bin", "wb") as target:
            target.write(captured)
        report["runs"].append({"scenario": scenario, "exit": process.returncode, "evidence": directory, "snapshot": saved, "lock_reopened": True, "output_bytes": len(captured)})
    except Exception as error:
        report["failure"] = {"scenario": scenario, "error": str(error), "evidence": directory, "captured_tail": bytes(captured[-2000:]).decode("utf8", "replace")}
        raise
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=2)
        if master is not None:
            os.close(master)
        with open(base + "/pty-latest.json", "w") as target:
            json.dump(report, target, indent=2, ensure_ascii=False)
print(json.dumps(report, indent=2, ensure_ascii=False))
