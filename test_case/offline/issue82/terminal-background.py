"""Called by terminal-pty.py inside its synthetic controlling terminal."""
import os,signal,subprocess,sys,time
# The wrapper remains the foreground process group. The product starts in background.
child=subprocess.Popen(sys.argv[1:],preexec_fn=lambda:os.setpgid(0,0))
end=time.monotonic()+8
while time.monotonic()<end:
 pid,status=os.waitpid(child.pid,os.WNOHANG|os.WUNTRACED)
 if pid:
  if os.WIFSTOPPED(status):os.kill(child.pid,signal.SIGCONT)
  else:
   print('BACKGROUND_CHILD_CLOSED',flush=True);sys.exit(0)
 time.sleep(.03)
os.killpg(child.pid,signal.SIGKILL)
raise RuntimeError('background client failed to close')
