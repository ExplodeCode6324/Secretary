"""One advisory lock; parent EOF releases it. No journal or write protocol."""
import fcntl
import os
import stat
import sys

fd = os.open(os.path.join(sys.argv[1], "state.lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
s = os.fstat(fd)
if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
    raise RuntimeError("UNSAFE_LOCK")
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
print("LOCKED", flush=True)
sys.stdin.buffer.read()
os.close(fd)
