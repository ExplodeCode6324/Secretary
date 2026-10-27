"""Actual product PTY coverage; synthetic byte delivery, NOT native Terminal/IME."""
import base64, fcntl, json, os, pty, select, signal, struct, subprocess, sys, tempfile, termios, time
base=os.path.abspath('.demo-data/issue82-terminal-rollback')
os.makedirs(base,exist_ok=True)
report_path=os.path.abspath(sys.argv[2])
report={'native_ime':'NOT_TESTED','synthetic_only':True,'runs':[]}
node=sys.argv[1]
restore=b'\x1b[?2004l\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[>4;0m\x1b[?7h\x1b[?2026l\x1b[?1049l\x1b[?25h\x1b[0m'
root=tempfile.mkdtemp(prefix='product-core-',dir=base)
fixture_log=open(root+'-fixture.log','wb')
fixture=subprocess.Popen([node,'--import','tsx','src/pi_secretary/scripts/issue82-terminal-fixture.ts',root],stdout=fixture_log,stderr=fixture_log)
def wait_for(fn,seconds=8):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if fn():return
  time.sleep(.03)
 raise AssertionError('condition timeout')
def posts():
 try:return [json.loads(x) for x in open(root+'/acceptance-posts.jsonl')]
 except FileNotFoundError:return []
def launch(command,profile=root,extra_env=None):
 m,s=pty.openpty();fcntl.ioctl(s,termios.TIOCSWINSZ,struct.pack('HHHH',24,100,0,0));prior=termios.tcgetattr(s)
 def session():os.setsid();fcntl.ioctl(s,termios.TIOCSCTTY,0)
 p=subprocess.Popen(command+['--data',profile,'--mode','fixture','--color','none'],stdin=s,stdout=s,stderr=s,preexec_fn=session,env={**os.environ,'TERM':'xterm-256color','TERM_PROGRAM':'SYNTHETIC_PTY','NODE_OPTIONS':os.environ.get('NODE_OPTIONS','')+' --import '+os.path.abspath('test_case/offline/issue82/no-native.mjs'),**(extra_env or {})})
 return p,m,s,prior,bytearray()
def pump(m,out,seconds):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if m is not None and select.select([m],[],[],.02)[0]:
   try:out.extend(os.read(m,65536))
   except OSError:time.sleep(.01)
def ready(p,m,out):
 end=time.monotonic()+8
 while time.monotonic()<end:
  pump(m,out,.05)
  if b'Candidate keys:' in out:return
  assert p.poll() is None, bytes(out).decode(errors='replace')
 raise AssertionError('product startup timeout')
def finish(p,m,s,prior,out,name,expected_restore=True):
 end=time.monotonic()+8
 while time.monotonic()<end:
  pump(m,out,.05)
  if p.poll() is not None:break
 assert p.poll() is not None,'exit timeout '+name
 pump(m,out,.3)
 fn=os.path.join(base,name+'-'+str(time.time_ns())+'.ansi');open(fn,'wb').write(out)
 if expected_restore:
  assert termios.tcgetattr(m)==prior,'raw leak '+name
  if b'\x1b[?1049h' in out:
   assert restore in out,'missing restore '+name
   tail=bytes(out).split(restore)[-1]
   assert b'\x1b[?1049h' not in tail and b'\x1b[?7l' not in tail,'late paint '+name
  else:
   assert name=='background-launch' and b'FOREGROUND_TTY_REQUIRED' in out,bytes(out)
   assert restore not in out,'restored a screen never entered'

 report['runs'].append({'name':name,'exit':p.returncode,'restoration_checked':expected_restore,'restore_sequence':restore in out,'ansi':fn})
 if m is not None:os.close(m)
 os.close(s)
try:
 wait_for(lambda:os.path.exists(root+'/acceptance-ready.json'))
 p,m,s,prior,out=launch(['npm','run','tui','--']);ready(p,m,out)
 # Wait for binding, then fragmented Unicode, ordinary newline, and benign bracketed paste.
 pump(m,out,1)
 for byte in 'typed 中文😀'.encode():os.write(m,bytes([byte]))
 os.write(m,b'\r');os.write(m,'\x1b[200~paste中文\r\n/quit\t😀\x1b[201~'.encode());pump(m,out,.5)
 assert len(posts())==0,'newline/paste submitted'
 paste_frame=os.path.join(base,'product-paste-'+str(time.time_ns())+'.ansi');open(paste_frame,'wb').write(out);report['paste_frame']=paste_frame
 os.write(m,b'\x13');pump(m,out,1);wait_for(lambda:len(posts())==1)
 body=json.loads(base64.b64decode(posts()[0]['body_base64']))
 assert body['text']=='typed 中文😀\npaste中文\n/quit\t😀',body
 assert fixture.poll() is None
 os.write(m,b'\x1b[200~'+b'p'*(600*1024)+b'\x1b[201~');pump(m,out,.6)
 assert b'DECISION:' in out,'large-edit decision absent'
 os.write(m,b'\x13');pump(m,out,.1);assert len(posts())==1
 os.write(m,b'\x14');pump(m,out,.1);os.write(m,b'\t'*11);pump(m,out,.2)
 assert b'ACTION: Cancel large edit' in out,'decision action not visible'
 os.write(m,b'\r');pump(m,out,.3);assert len(posts())==1
 os.write(m,'retained 草稿'.encode());pump(m,out,.4)
 for columns,rows in [(40,12),(120,40),(30,8),(100,24)]:
  fcntl.ioctl(s,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0));os.killpg(p.pid,signal.SIGWINCH);pump(m,out,.2)
  if columns<40:os.write(m,b'\x13');pump(m,out,.1);assert len(posts())==1
 # Duplicate launch must fail without taking over the writer.
 duplicate=subprocess.run([node,'--import','tsx','src/pi_secretary/src/tui/entry.ts','--data',root,'--mode','fixture'],stdin=subprocess.DEVNULL,capture_output=True)
 assert duplicate.returncode!=0 and b'TTY_REQUIRED' in duplicate.stderr
 dp,dm,ds,dprior,dout=launch([node,'--import','tsx','src/pi_secretary/src/tui/entry.ts'])
 pump(dm,dout,1);assert dp.poll() is not None and dp.returncode!=0,'duplicate writer accepted'
 assert b'LOCK' in dout or b'RUNNING' in dout or b'WRITER_EXIT' in dout,bytes(dout)
 assert b'\x1b[?1049h' not in dout,'startup failure entered screen'
 os.close(dm);os.close(ds)
 os.write(m,b'\x03');finish(p,m,s,prior,out,'npm-normal')
 assert fixture.poll() is None,'client closed Core'
 p,m,s,prior,out=launch([node,'--import','tsx','src/pi_secretary/src/tui/entry.ts']);ready(p,m,out);pump(m,out,.2)
 assert 'retained 草稿'.encode() in out,'draft not reopened'
 os.write(m,b'\x03');finish(p,m,s,prior,out,'reopen')
 # Separate node, tsx and npm/process-group signal paths.
 for label,command,sig,group in [
  ('node-term',[node,'--import','tsx','src/pi_secretary/src/tui/entry.ts'],signal.SIGTERM,False),
  ('tsx-term',[node,'node_modules/tsx/dist/cli.mjs','src/pi_secretary/src/tui/entry.ts'],signal.SIGTERM,False),
  ('npm-term',['npm','run','tui','--'],signal.SIGTERM,False),
  ('group-int',['npm','run','tui','--'],signal.SIGINT,True),
  ('node-tstp',[node,'--import','tsx','src/pi_secretary/src/tui/entry.ts'],signal.SIGTSTP,False),
  ('node-cont',[node,'--import','tsx','src/pi_secretary/src/tui/entry.ts'],signal.SIGCONT,False)]:
  p,m,s,prior,out=launch(command);ready(p,m,out)
  if group:os.killpg(p.pid,sig)
  else:os.kill(p.pid,sig)
  finish(p,m,s,prior,out,label)
 p,m,s,prior,out=launch([node,'--import','tsx','src/pi_secretary/src/tui/entry.ts']);ready(p,m,out)
 os.write(m,b'last saved');pump(m,out,.4);os.close(m);m=None
 finish(p,m,s,prior,out,'hangup',False)
 p,m,s,prior,out=launch([node,'--import','tsx','src/pi_secretary/src/tui/entry.ts']);ready(p,m,out)
 assert b'last saved' in out;os.write(m,b'\x03');finish(p,m,s,prior,out,'hangup-reopen')
 # A delayed durable operation keeps shutdown in flight while repeated signals arrive.
 slow=os.path.join(base,'slow-'+str(time.time_ns())+'.py')
 source=open('src/pi_secretary/src/tui/writer.py').read()
 source=source.replace('elif op == "commit":','elif op == "commit":\n                __import__("time").sleep(0.5)',1)
 open(slow,'w').write(source)
 options=os.environ.get('NODE_OPTIONS','')+' --import '+os.path.abspath('test_case/offline/issue82/no-native.mjs')+' --import '+os.path.abspath('test_case/offline/issue82/slow-writer.mjs')
 p,m,s,prior,out=launch([node,'--import','tsx','src/pi_secretary/src/tui/entry.ts'],extra_env={'NODE_OPTIONS':options,'TERMINAL_TEST_WRITER':slow});ready(p,m,out)
 os.write(m,b'slow durable');pump(m,out,.2);os.kill(p.pid,signal.SIGTERM);pump(m,out,.03);os.kill(p.pid,signal.SIGTERM)
 finish(p,m,s,prior,out,'repeated-term-slow-flush')
 p,m,s,prior,out=launch(['/usr/bin/python3','test_case/offline/issue82/terminal-background.py',node,'--import','tsx','src/pi_secretary/src/tui/entry.ts'])
 pump(m,out,2);finish(p,m,s,prior,out,'background-launch')
 assert b'BACKGROUND_CHILD_CLOSED' in out
 # SIGKILL cannot restore terminal modes; only durable reopen/lock release is promised.
 p,m,s,prior,out=launch([node,'--import','tsx','src/pi_secretary/src/tui/entry.ts']);ready(p,m,out)
 os.write(m,b'kill witness');pump(m,out,.4);os.kill(p.pid,signal.SIGKILL);finish(p,m,s,prior,out,'kill',False)
 p,m,s,prior,out=launch([node,'--import','tsx','src/pi_secretary/src/tui/entry.ts']);ready(p,m,out)
 assert b'kill witness' in out;os.write(m,b'\x03');finish(p,m,s,prior,out,'kill-reopen')
 report['post_count']=len(posts());report['root']=root;report['status']='PASS'
finally:
 if 'p' in locals() and p.poll() is None:
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
 fixture.terminate();fixture.wait(timeout=8);fixture_log.close()
 with open(report_path,'x') as f:json.dump(report,f,indent=2)
print(json.dumps(report))
