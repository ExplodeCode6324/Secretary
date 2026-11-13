"""Hold existing files only. EOF releases locks. No recovery or file writes."""
import json
import fcntl
import os
import stat
import sys

fds = []
identities = []
try:
    for filename in sys.argv[1:]:
        fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
            raise RuntimeError('UNSAFE_LOCK')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = os.lstat(filename)
        if (current.st_dev, current.st_ino) != (s.st_dev, s.st_ino):
            raise RuntimeError("LOCK_REPLACED")
        fds.append(fd)
        identities.append({"file": filename, "dev": str(s.st_dev), "ino": str(s.st_ino), "mode": s.st_mode, "uid": s.st_uid})
    print(json.dumps({'status': 'LOCKED', 'identities': identities}), flush=True)
    sys.stdin.buffer.read()
finally:
    for fd in fds:
        os.close(fd)
