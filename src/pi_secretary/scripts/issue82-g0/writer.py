#!/usr/bin/python3
"""G0 synthetic snapshot helper only; never opens a Core path."""
import fcntl
import json
import os
import signal
import stat
import sys
import time

for sig in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM, signal.SIGTSTP):
    signal.signal(sig, signal.SIG_IGN)

root = sys.argv[1]
info = os.lstat(root)
if not os.path.isabs(root) or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
    raise RuntimeError("unsafe G0 root")
directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
lock = os.open("g0.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=directory)
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(73)


def reply(value):
    # Called only after the current operation completed or failed.
    try:
        sys.stdout.write(json.dumps(value) + "\n")
        sys.stdout.flush()
        return True
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        return False


if reply({"ready": True, "pid": os.getpid()}):
    while True:
        raw = sys.stdin.buffer.readline(65538)
        if not raw:
            break
        if len(raw) > 65536 or not raw.endswith(b"\n"):
            reply({"error": "bounded protocol exceeded"})
            break
        seq = None
        tmp = None
        try:
            request = json.loads(raw)
            seq = request["seq"]
            if not isinstance(seq, int) or seq < 1:
                raise ValueError("invalid seq")
            delay = request.get("delay_ms", 0)
            if not isinstance(delay, int) or not 0 <= delay <= 1000:
                raise ValueError("invalid synthetic delay")
            payload = json.dumps({"seq": seq, "value": request["value"]}, ensure_ascii=False).encode("utf8")
            tmp = ".g0-%d-%d.tmp" % (os.getpid(), seq)
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            with os.fdopen(fd, "wb") as target:
                target.write(payload)
                target.flush()
                os.fsync(target.fileno())
            time.sleep(delay / 1000)
            os.rename(tmp, "snapshot.json", src_dir_fd=directory, dst_dir_fd=directory)
            tmp = None
            os.fsync(directory)
            response = {"seq": seq, "saved": True}
        except Exception as error:
            response = {"seq": seq, "error": str(error)}
        if not reply(response):
            break
os.close(lock)
os.close(directory)
