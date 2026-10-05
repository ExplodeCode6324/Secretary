"""Real macOS PTY + terminal emulation; isolated fixture endpoint only. Requires pyte."""
import os,pty,subprocess,fcntl,termios,struct,select,time,json,sys,urllib.request,codecs
from pathlib import Path
import pyte
folder=Path(sys.argv[1]); report=Path(sys.argv[2]); endpoint=json.loads((folder/'browser-endpoint.json').read_text())
def api(route,body=None):
 req=urllib.request.Request(endpoint['url']+'/api/'+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+endpoint['token'],'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=12))
client=api('client',{})['client']
master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',28,100,0,0))
child=subprocess.Popen(['node','--import','tsx','src/pi_secretary/src/client-tui.ts'],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'SECRETARY_DATA':str(folder),'SECRETARY_MODE':'fixture','TERM':'xterm-256color','NO_COLOR':'1'},start_new_session=True);os.close(slave)
screen=pyte.Screen(100,28);stream=pyte.Stream(screen);decoder=codecs.getincrementaldecoder('utf-8')('replace');raw=''
def pump(seconds=.1):
 global raw
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if select.select([master],[],[],min(.1,max(.001,end-time.monotonic())))[0]:
   try:b=os.read(master,65536)
   except OSError:return
   if not b:return
   value=decoder.decode(b);raw+=value;stream.feed(value)
def wait(fn,timeout=15):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  pump()
  if fn():return
 raise AssertionError('PTY condition timeout')
def send(text):os.write(master,text.encode())
result={'pass':False}
try:
 wait(lambda:'Master ›' in raw)
 send('中文草稿ABC')
 api('message',{'client':client,'text':'PTY background activity','request_id':str(__import__('uuid').uuid4())})
 wait(lambda:'正在思考' in raw)
 pump(1.1)
 first='\n'.join(screen.display)
 assert '中文草稿ABC' in first,first
 # Move left, insert in the middle, resize while input remains unsubmitted.
 send('\x1b[DZ');pump(.2)
 fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',32,62,0,0));screen.resize(32,62);os.kill(child.pid,__import__('signal').SIGWINCH);pump(.8)
 second='\n'.join(screen.display)
 assert '中文草稿ABZC' in second,second
 send('\r')
 wait(lambda:any(m['text']=='中文草稿ABZC' for m in api('state?client='+client)['messages']))
 send('/activity\r');wait(lambda:'近期活动' in raw)
 send('/quit\r');wait(lambda:child.poll() is not None)
 assert child.returncode==0
 result={'pass':True,'chineseInputPreserved':True,'cursorEditPreserved':True,'resize':True,'activityDuringInput':True,'quitPreservesBackend':api('health')['mode']=='fixture','screenBeforeResize':first,'screenAfterResize':second}
finally:
 if child.poll() is None:child.terminate();child.wait(timeout=12)
 result['output']=raw;result['exitCode']=child.returncode;os.close(master);report.write_text(json.dumps(result,ensure_ascii=False,indent=2))
