"""Start an isolated Unix-socket PostgreSQL instance and run actual TS repository tests."""
import argparse, getpass, os, pathlib, subprocess, tempfile, urllib.parse
p=argparse.ArgumentParser();p.add_argument('--pg-bin',required=True);args=p.parse_args();bin=pathlib.Path(args.pg_bin)
root=pathlib.Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='secretary-pg-') as tmp, tempfile.TemporaryDirectory(prefix='sec-sock-',dir='/tmp') as sock:
 data=pathlib.Path(tmp)/'data'; started=False
 try:
  subprocess.run([str(bin/'initdb'),'-D',str(data),'--no-locale','--encoding=UTF8','--auth=trust'],check=True,stdout=subprocess.DEVNULL)
  subprocess.run([str(bin/'pg_ctl'),'-D',str(data),'-l',str(pathlib.Path(tmp)/'log'),'-o',f"-k {sock} -c listen_addresses=''",'-w','start'],check=True,stdout=subprocess.DEVNULL);started=True
  env={**os.environ,'SECRETARY_TEST_DATABASE_URL':f'postgresql://{getpass.getuser()}@localhost/postgres?host={urllib.parse.quote(sock)}'}
  result=subprocess.run(['node','node_modules/tsx/dist/cli.mjs','--test','pi_secretary/audit/world-extra.test.ts'],cwd=root,env=env)
  if result.returncode:raise SystemExit(result.returncode)
 finally:
  if started:subprocess.run([str(bin/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=True,stdout=subprocess.DEVNULL)
