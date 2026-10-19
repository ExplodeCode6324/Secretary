"""Measure the ordinary Release; each run is immutable. No process-name cleanup."""
import argparse,csv,hashlib,json,os,platform,queue,statistics,subprocess,threading,time
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
BIN=ROOT/'src-tauri/target/release/secretary-desktop-spike'
p=argparse.ArgumentParser();p.add_argument('--scenario',choices=['startup','idle','stream'],default='startup');p.add_argument('--rounds',type=int,default=10);args=p.parse_args()
run=REPO/'.demo-data/issue58/runs'/f'{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")}-measure-{args.scenario}';run.mkdir(parents=True)
def processes():
 result={}
 for line in subprocess.check_output(['ps','-axo','pid=,time=,rss=,comm='],text=True).splitlines():
  fields=line.strip().split(None,3)
  if len(fields)!=4:continue
  pid,clock,rss,name=fields
  parts=clock.split(':');seconds=sum(float(v)*60**i for i,v in enumerate(reversed(parts)))
  result[int(pid)]={'cpu':seconds,'rss_kib':int(rss),'name':name}
 return result

def launch(mode):
 before=processes();q=queue.Queue();t0=time.monotonic()
 proc=subprocess.Popen([str(BIN)],env={**os.environ,'SECRETARY_STUDY_SCENARIO':mode,'SECRETARY_STUDY_MEASURE':'1'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 def read():
  for line in proc.stdout:q.put((time.monotonic(),line.strip()))
 threading.Thread(target=read,daemon=True).start()
 try:
  deadline=t0+90
  while time.monotonic()<deadline:
   try:t,line=q.get(timeout=1)
   except queue.Empty:
    if proc.poll() is not None:raise RuntimeError(f'app exited {proc.returncode}')
    continue
   if line=='STUDY_READY':return proc,q,t-t0,before
  raise TimeoutError('no ready marker')
 except BaseException:
  if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
  raise

def stop(proc):
 if proc.poll() is None:
  proc.terminate()
  try:proc.wait(timeout=10)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()

meta={'scenario':args.scenario,'binary_sha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),'platform':platform.platform(),'machine':platform.machine(),'sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'build_dirty':bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=REPO,text=True).strip()),'cpu_unit':'100% = one logical CPU; cumulative CPU time delta / monotonic interval','webkit_attribution':'new WebKit PID set relative to prelaunch; candidates, not proven exclusive; shared preexisting separately listed','thermal':'NOT_MEASURED','window_css':'1180x820 nominal native window; content in ui snapshot','zoom':1,'screen_recording':False,'power':subprocess.check_output(['pmset','-g','batt'],text=True).splitlines()[0]}
try:
 if args.scenario=='startup':
  values=[]
  for i in range(args.rounds+1):
   proc,q,elapsed,before=launch('')
   values.append(elapsed);stop(proc);time.sleep(1)
  meta.update(first_seconds=values[0],warm_seconds=values[1:],median_seconds=statistics.median(values[1:]),max_seconds=max(values[1:]))
 else:
  proc,q,elapsed,before=launch('stream' if args.scenario=='stream' else 'load')
  meta['startup_seconds']=elapsed;meta['existing_webkit_pids']=[pid for pid,v in before.items() if 'WebKit' in v['name']]
  samples=[];reports=[];previous={};last=time.monotonic();start=last
  try:
   while time.monotonic()-start<90:
    time.sleep(1);now=time.monotonic();current=processes()
    for pid,v in current.items():
     if pid!=proc.pid and 'WebKit' not in v['name']:continue
     category='app' if pid==proc.pid else ('shared-existing' if pid in before else 'new-webkit-candidate')
     cpu=None if pid not in previous else 100*(v['cpu']-previous[pid]['cpu'])/(now-last)
     samples.append({'seconds':round(now-start,3),'pid':pid,'category':category,'cpu_percent':cpu,'rss_kib':v['rss_kib'],'process':Path(v['name']).name})
    previous=current;last=now
    while not q.empty():
     t,line=q.get()
     if line.startswith('STUDY_METRICS '):reports.append({'seconds':t-start,**json.loads(line[len('STUDY_METRICS '):])})
    if proc.poll() is not None:raise RuntimeError('app exited during sampling')
  finally:stop(proc)
  with (run/'samples.csv').open('w') as f:
   writer=csv.DictWriter(f,fieldnames=samples[0].keys());writer.writeheader();writer.writerows(samples)
  (run/'ui.json').write_text(json.dumps(reports,indent=2))
  meta.update(phase='idle: first 30s settle, next 60s sample; stream: 60s update then 30s recovery',after_exit_new_webkit_pids=[pid for pid,v in processes().items() if pid not in before and 'WebKit' in v['name']])
 meta['status']='MEASURED'
except BaseException as e:
 meta.update(status='FAIL',error=str(e));raise
finally:
 (run/'index.json').write_text(json.dumps(meta,indent=2));print(run)
