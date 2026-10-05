"""Real macOS PTY /status acceptance. stdlib only; no terminal-cell/cursor claims."""
import os,pty,subprocess,fcntl,termios,struct,select,time,json,sys,urllib.request,re,codecs
from pathlib import Path
folder=Path(sys.argv[1]); output=Path(sys.argv[2]); endpoint=json.loads((folder/'ui-endpoint.json').read_text())
def api(route,body=None):
 req=urllib.request.Request(endpoint['url']+'/api/'+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+endpoint['token'],'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=12))
client=api('client',{})['client']; state=api('state?client='+client); c=state['context']
master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,160,0,0))
env={key:value for key,value in os.environ.items() if not key.startswith('SECRETARY_')}
env.update({'SECRETARY_DATA':str(folder),'SECRETARY_MODE':'fixture','TERM':'xterm-256color','NO_COLOR':'1'})
child=subprocess.Popen(['node','--import','tsx','src/pi_secretary/src/client-tui.ts'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave)
raw=''; decoder=codecs.getincrementaldecoder('utf-8')('replace')
def pump():
 global raw
 if select.select([master],[],[],.1)[0]:
  try:raw+=decoder.decode(os.read(master,65536))
  except OSError:pass
def wait(predicate,timeout=15):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  pump()
  if predicate():return
 raise AssertionError('PTY condition timeout')
result={'pass':False,'terminal':'macOS PTY','emulation':'raw text verification, no cell emulation'}
try:
 wait(lambda:'Master ›' in raw)
 before=len(raw);os.write(master,b'/status\r')
 wait(lambda:raw[before:].count('Settings ·')>=1)
 status=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',raw[before:])
 for expected in [f"≈{c['used']:,} / {c['usable_input']:,}",f"输出 {c['effective_output']}",f"工具预留 {c['tool_reserve']}",f"安全余量 {c['safety_margin']}",'最近请求','UTF-8 保守估算','发送前重算','服务上限未核验']:
  assert expected in status,(expected,status)
 assert str(c['checkpoint']['estimated_tokens']) not in status,'recovery estimate substituted for request estimate'
 os.write(master,b'/quit\r');wait(lambda:child.poll() is not None)
 assert child.returncode==0
 result.update({'pass':True,'status':status,'context':c,'backendPreserved':api('health')['mode']=='fixture','exitCode':child.returncode})
finally:
 if child.poll() is None:child.terminate();child.wait(timeout=12)
 result['raw']=raw.replace(endpoint['token'],'<redacted-local-capability>');os.close(master)
 output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2))
