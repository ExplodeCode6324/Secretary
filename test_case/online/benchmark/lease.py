"""An OS-held controller lease: a dead coordinator releases it by pipe EOF."""
import fcntl, os, stat, sys
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
st = os.fstat(fd)
if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_uid != os.getuid():
    raise RuntimeError('UNSAFE_LEASE')
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
print('LOCKED', flush=True)
sys.stdin.buffer.read()
