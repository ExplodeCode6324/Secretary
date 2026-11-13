"""Hold existing files only. EOF releases locks. No recovery or file writes."""
import fcntl
import os
import stat
import sys

fds = []
try:
    for filename in sys.argv[1:]:
        fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
            raise RuntimeError('UNSAFE_LOCK')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fds.append(fd)
    print('LOCKED', flush=True)
    sys.stdin.buffer.read()
finally:
    for fd in fds:
        os.close(fd)
