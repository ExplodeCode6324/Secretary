"""The OS releases this advisory lock when the supervisor or its pipe exits."""
import fcntl, sys
with open(sys.argv[1], 'a') as lock:
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('BUSY', flush=True)
        sys.exit(2)
    print('LOCKED', flush=True)
    sys.stdin.buffer.read()
