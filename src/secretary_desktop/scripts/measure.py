"""Measure the ordinary Release; each run is immutable. No process-name cleanup."""
import argparse,csv,hashlib,json,os,platform,queue,statistics,subprocess,threading,time
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
BIN=ROOT/'src-tauri/target/release/secretary-desktop-spike'
p=argparse.ArgumentParser();p.add_argument('--scenario',choices=['startup','idle','stream'],default='startup');p.add_argument('--rounds',type=int,default=10);p.add_argument('--uninstrumented',action='store_true');p.add_argument('--baseline',action='store_true');args=p.parse_args()
if args.uninstrumented and args.scenario != 'idle':p.error('--uninstrumented is only supported for the idle control')
awake=None
run=REPO/'.demo-data/issue58/runs'/f'{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")}-measure-{args.scenario}';run.mkdir(parents=True)
def processes():
 result={}
 for line in subprocess.check_output(['ps','-axo','pid=,lstart=,time=,rss=,comm='],text=True).splitlines():
  fields=line.strip().split(None,8)
  if len(fields)!=9:continue
  pid=fields[0];identity=" ".join(fields[1:6]);clock,rss,name=fields[6:]
  parts=clock.split(':');seconds=sum(float(v)*60**i for i,v in enumerate(reversed(parts)))
  result[int(pid)]={'cpu':seconds,'rss_kib':int(rss),'name':name,'identity':identity}
 return result

def launch(mode):
 global awake
 before=processes();q=queue.Queue();t0=time.monotonic()
 proc=subprocess.Popen([str(BIN)],env={**os.environ,'SECRETARY_STUDY_SCENARIO':mode + ('-baseline' if mode and args.baseline else ''),'SECRETARY_STUDY_MEASURE':'0' if args.uninstrumented else '1'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 awake=subprocess.Popen(['caffeinate','-d','-i','-u','-w',str(proc.pid)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
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
 global awake
 if proc.poll() is None:
  proc.terminate()
  try:proc.wait(timeout=10)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
 if awake is not None:
  if awake.poll() is None:awake.terminate()
  awake.wait(timeout=10);awake=None

def display_info():
 data=json.loads(subprocess.check_output(['system_profiler','SPDisplaysDataType','-json'],text=True))
 result=[]
 def visit(value):
  if isinstance(value,dict):
   if '_spdisplays_resolution' in value or 'spdisplays_pixelresolution' in value:
    result.append({k:v for k,v in value.items() if k in ['_spdisplays_resolution','_spdisplays_pixels','spdisplays_pixelresolution','spdisplays_main']})
   for child in value.values():visit(child)
  elif isinstance(value,list):
   for child in value:visit(child)
 visit(data)
 return result

meta={'scenario':args.scenario,'binary_sha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),'platform':platform.platform(),'machine':platform.machine(),'sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'build_dirty':bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=REPO,text=True).strip()),'cpu_unit':'100% = one logical CPU; cumulative CPU time delta / monotonic interval','webkit_attribution':'new WebKit PID set relative to prelaunch; candidates, not proven exclusive; shared preexisting separately listed','thermal':'NOT_MEASURED','power_assertion':'temporary caffeinate -d -i -u scoped to owned app PID; no persisted settings','window_css':'1180x820 nominal native window; content in ui snapshot','zoom':1,'screen_recording':False,'instrumentation':'REPORTING/RAF OFF (input bookkeeping and periodic callback remain)' if args.uninstrumented else 'INSTRUMENTED (1Hz IPC; streaming rAF sampler)','baseline_full_dom':args.baseline,'display_configuration':display_info(),'low_power':subprocess.check_output(['pmset','-g','custom'],text=True).split('lowpowermode')[-1].splitlines()[0].strip() if 'lowpowermode' in subprocess.check_output(['pmset','-g','custom'],text=True) else 'NOT_AVAILABLE','power':subprocess.check_output(['pmset','-g','batt'],text=True).splitlines()[0]}
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
  samples=[];reports=[];lifecycle=[];sampler_seconds=[];previous={};last=time.monotonic();start=last;completed_at=None
  try:
   while time.monotonic()-start<(180 if args.scenario=="stream" else 90):
    time.sleep(1);sample_start=time.monotonic();current=processes();now=time.monotonic();sampler_seconds.append(now-sample_start)
    tracked={pid:v for pid,v in current.items() if pid==proc.pid or "WebKit" in v["name"]}
    for pid,v in tracked.items():
     if pid not in previous or previous[pid]["identity"]!=v["identity"]:lifecycle.append({"seconds":now-start,"event":"appeared","pid":pid,"identity":v["identity"],"process":Path(v["name"]).name})
    for pid,v in previous.items():
     if pid not in tracked or tracked[pid]["identity"]!=v["identity"]:lifecycle.append({"seconds":now-start,"event":"ended","pid":pid,"identity":v["identity"]})
    for pid,v in current.items():
     if pid!=proc.pid and 'WebKit' not in v['name']:continue
     category='app' if pid==proc.pid else ('shared-existing' if pid in before and before[pid]['identity']==v['identity'] else 'new-webkit-candidate')
     cpu=None if pid not in previous or previous[pid]['identity']!=v['identity'] or v['cpu']<previous[pid]['cpu'] else 100*(v['cpu']-previous[pid]['cpu'])/(now-last)
     samples.append({'seconds':round(now-start,3),'pid':pid,'identity':v['identity'],'category':category,'cpu_percent':cpu,'rss_kib':v['rss_kib'],'process':Path(v['name']).name})
    previous=tracked;last=now
    while not q.empty():
     t,line=q.get()
     if line.startswith('STUDY_METRICS '):
      report={'seconds':t-start,**json.loads(line[len('STUDY_METRICS '):])};reports.append(report)
      if args.scenario=='stream' and not report['running'] and report['metrics']['updates']['count']==1200 and report.get('queue')==0 and completed_at is None:completed_at=t-start
    if completed_at is not None and now-start>=completed_at+30:break
    if proc.poll() is not None:raise RuntimeError('app exited during sampling')
  finally:stop(proc)
  with (run/'samples.csv').open('w') as f:
   writer=csv.DictWriter(f,fieldnames=samples[0].keys());writer.writeheader();writer.writerows(samples)
  (run/'lifecycle.json').write_text(json.dumps(lifecycle,indent=2))
  meta['completion_seconds']=completed_at
  meta['sampled_seconds']=last-start
  meta['sampler_wall_seconds']={'mean':statistics.mean(sampler_seconds),'max':max(sampler_seconds),'note':'ps collection wall time, not CPU; external sampler remains in both control and instrumented runs'}
  (run/'ui.json').write_text(json.dumps(reports,indent=2))
  meta.update(phase='idle: first 30s settle, next 60s sample; stream: until actual 1200-update completion and drained queue, then 30s recovery',after_exit_new_webkit_pids=[pid for pid,v in processes().items() if pid not in before and 'WebKit' in v['name']])
 if args.scenario=='stream' and completed_at is None:raise RuntimeError('stream did not finish 1200 updates and drain its queue within 180 seconds')
 meta['status']='MEASURED'
except BaseException as e:
 meta.update(status='FAIL',error=str(e));raise
finally:
 (run/'index.json').write_text(json.dumps(meta,indent=2));print(run)
