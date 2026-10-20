"""Ordinary Release PhaseUI comparison. No driver, live Core, or screenshot sampling."""
import argparse, hashlib, json, os, platform, queue, statistics, subprocess, threading, time
from datetime import datetime, timezone
from pathlib import Path
from phaseui_measurement_contract import validate
ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
BIN=ROOT/'src-tauri/target/release/bundle/macos/Secretary Study.app/Contents/MacOS/secretary-desktop-spike'

def processes():
    result={}
    for line in subprocess.check_output(['ps','-axo','pid=,lstart=,time=,rss=,comm='],text=True).splitlines():
        fields=line.strip().split(None,8)
        if len(fields)!=9: continue
        pid=int(fields[0]);identity=' '.join(fields[1:6]);clock,rss,name=fields[6:]
        cpu=sum(float(v)*60**i for i,v in enumerate(reversed(clock.split(':'))))
        result[pid]={'identity':identity,'cpu':cpu,'rss_kib':int(rss),'name':name}
    return result

def run(scenario,mode,seed,uninstrumented=False,coverage=False,theme="light",width=1180,cohort="resource"):
    folder=REPO/'.demo-data/issue62/runs'/f'{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")}-{cohort}-{scenario}-{mode}'
    folder.mkdir(parents=True)
    before=processes();env={k:v for k,v in os.environ.items() if not k.startswith(('SECRETARY_STUDY','SECRETARY_PHASEUI'))}
    env.update(SECRETARY_PHASEUI_SCENARIO=scenario,SECRETARY_PHASEUI_MOTION=mode,SECRETARY_PHASEUI_SEED=str(seed),SECRETARY_STUDY_MEASURE='0' if uninstrumented else '1',SECRETARY_PHASEUI_COVERAGE="1" if coverage else "0",SECRETARY_PHASEUI_THEME=theme,SECRETARY_PHASEUI_WIDTH=str(width))
    start=time.monotonic();proc=subprocess.Popen([str(BIN)],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    awake=subprocess.Popen(['caffeinate','-d','-i','-u','-w',str(proc.pid)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    lines=queue.Queue()
    def reader():
        for line in proc.stdout:lines.put(line.strip())
    threading.Thread(target=reader,daemon=True).start()
    previous={};samples=[];log=[];report=None;ready=False;last=start;sampler=[]
    try:
        while time.monotonic()-start<180:
            time.sleep(1);t=time.monotonic();current=processes();sampler.append(time.monotonic()-t)
            for pid,v in current.items():
                if pid!=proc.pid and 'WebKit' not in v['name']:continue
                old=previous.get(pid);cpu=100*(v['cpu']-old['cpu'])/(t-last) if old and old['identity']==v['identity'] and v['cpu']>=old['cpu'] else None
                category='app' if pid==proc.pid else 'shared-existing' if pid in before and before[pid]['identity']==v['identity'] else 'new-webkit-candidate'
                samples.append({'seconds':t-start,'pid':pid,'identity':v['identity'],'category':category,'cpu_percent':cpu,'rss_kib':v['rss_kib']})
            previous=current;last=t
            while not lines.empty():
                line=lines.get();log.append(line)
                if line=='STUDY_READY':ready=True
                if line.startswith('STUDY_METRICS '):report=json.loads(line[len('STUDY_METRICS '):])
            if report is not None:break
            if uninstrumented and t-start>=125:break
            if proc.poll() is not None:raise RuntimeError('app exited during measurement')
        errors=[] if uninstrumented and ready else validate(report,scenario,mode,seed,ready)
        if not ready:errors.append('missing readiness')
        meta={'cohort':cohort,'coverage':coverage,'theme':theme,'width':width,'scenario':scenario,'mode':mode,'seed':seed,'binary_sha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),'platform':platform.platform(),'machine':platform.machine(),'sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'dirty':bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=REPO,text=True).strip()),'reporting':not uninstrumented,'report':report,'valid':not errors,'errors':errors,'sampler_p95_seconds':sorted(sampler)[int(len(sampler)*.95)],'webkit_attribution':'New WebKit PIDs are candidates, not proven exclusive. Existing shared processes kept separately. RSS may double count shared memory.','cpu_unit':'100% = one logical CPU','paint_gpu':'NOT_TESTED','thermal':'NOT_MEASURED','display':subprocess.check_output(['system_profiler','SPDisplaysDataType'],text=True),'power':subprocess.check_output(['pmset','-g','batt'],text=True).splitlines()[0]}
        (folder/'index.json').write_text(json.dumps(meta,indent=2));(folder/'samples.json').write_text(json.dumps(samples));(folder/'stdout.txt').write_text('\n'.join(log))
        print(json.dumps({'run':str(folder),'valid':not errors,'errors':errors}),flush=True)
        if errors:raise RuntimeError('; '.join(errors))
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
        if awake.poll() is None:awake.terminate()
        awake.wait(timeout=10)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--scenario',choices=['all','idle','single','navigation','input-scroll','stream-stress','bridge-cadence'],default='all');p.add_argument('--mode',choices=['all','off','base','extended'],default='all');p.add_argument('--rounds',type=int,default=3);p.add_argument('--uninstrumented',action='store_true');p.add_argument('--coverage',action='store_true');p.add_argument('--theme',choices=['light','dark'],default='light');p.add_argument('--width',type=int,default=1180);p.add_argument('--cohort',default='resource');args=p.parse_args()
    if args.uninstrumented and args.scenario!='idle':p.error('reporting-off control requires idle')
    expected_hash=hashlib.sha256(BIN.read_bytes()).hexdigest()
    for scenario in (['idle','single','navigation','input-scroll','stream-stress','bridge-cadence'] if args.scenario=='all' else [args.scenario]):
        for repetition in range(args.rounds):
            modes=['off','base','extended'] if args.mode=='all' else [args.mode]
            offset=repetition % len(modes)
            for mode in modes[offset:]+modes[:offset]:
                if hashlib.sha256(BIN.read_bytes()).hexdigest()!=expected_hash:raise RuntimeError('binary changed within cohort')
                run(scenario,mode,62+repetition,args.uninstrumented,args.coverage,args.theme,args.width,args.cohort)
