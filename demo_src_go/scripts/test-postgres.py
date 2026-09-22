#!/usr/bin/env python3
"""Run the actual Go repository tests in a disposable, socket-only PostgreSQL."""
import os,pathlib,shutil,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
bindir=pathlib.Path(subprocess.check_output(['pg_config','--bindir'],text=True).strip())
with tempfile.TemporaryDirectory(prefix='secgo-pg-') as tmp, tempfile.TemporaryDirectory(prefix='sgpg-',dir='/tmp') as sock:
 data=pathlib.Path(tmp)/'data'; log=pathlib.Path(tmp)/'postgres.log'
 def run(*args,**kw): return subprocess.run([str(x) for x in args],check=True,**kw)
 env={**os.environ,'LC_ALL':'C'}
 run(bindir/'initdb','-D',data,'--no-locale','--encoding=UTF8','--auth=trust',env=env,stdout=subprocess.DEVNULL)
 started=False
 try:
  run(bindir/'pg_ctl','-D',data,'-l',log,'-o',f"-k {sock} -c listen_addresses='' -c fsync=on",'-w','start',env=env,stdout=subprocess.DEVNULL);started=True
  env['SECRETARY_TEST_PG_DSN']=f'host={sock} dbname=postgres sslmode=disable'
  with (root/'reports/postgres-tests.jsonl').open('w') as output:
   r=subprocess.run(['go','test','-race','-json','./internal/world','-count=1'],cwd=root,env=env,stdout=output)
  if r.returncode: print((root/'reports/postgres-tests.jsonl').read_text());raise SystemExit(r.returncode)
  with (root/'reports/postgres-bridge-tests.jsonl').open('w') as output:
   r=subprocess.run(['go','test','-race','-json','./internal/engine','-run','TestWorldApprovalCommitRecoveryBridge','-count=1'],cwd=root,env=env,stdout=output)
  if r.returncode: print((root/'reports/postgres-bridge-tests.jsonl').read_text());raise SystemExit(r.returncode)
  print('Go PostgreSQL repository and journal bridge integration tests passed (temporary cluster).')
 finally:
  if started: subprocess.run([str(bindir/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],stdout=subprocess.DEVNULL)
