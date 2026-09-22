"""Run bounded synthetic live suites against the frozen comparison snapshot.

Uses existing role credentials locally without printing/copying their values.
This is an explicitly invoked paid-model test, not part of design-check.py.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SNAP = ROOT / 'test/runs/comparison-20260922/snapshot'
OUT = ROOT / 'test/reports/comparison-20260922'


def run(name, command, cwd, env, timeout=420):
    with (OUT / (name + '.log')).open('w') as output:
        try:
            result = subprocess.run(command, cwd=cwd, env=env, stdout=output,
                                    stderr=subprocess.STDOUT, timeout=timeout)
            return {'name': name, 'exit_code': result.returncode}
        except subprocess.TimeoutExpired:
            return {'name': name, 'exit_code': None, 'error': 'CONTROLLER_TIMEOUT'}


def main():
    env = dict(os.environ)
    for key in list(env):
        if key.startswith('SECRETARY_'):
            del env[key]
    goenv = dict(env)
    # Parse only the two known string assignments; do not execute a shell file.
    for line in (ROOT / 'demo_src_go/.private/runtime.env').read_text().splitlines():
        line = line.removeprefix('export ').strip()
        key, sep, value = line.partition('=')
        if sep and key in {'SECRETARY_MAIN_API_KEY', 'SECRETARY_TASK_API_KEY'}:
            parsed = shlex.split(value)
            if len(parsed) != 1:
                raise ValueError('Unexpected credential assignment format')
            goenv[key] = parsed[0]
    goenv.update(SECRETARY_LIVE_TEST='1', SECRETARY_LIVE_REPORT=str(OUT/'go-live.json'))
    pienv = dict(env, SECRETARY_CREDENTIALS_FILE=str(ROOT/'demo_pi/.demo-data/live-credentials.json'))
    jobs = [('go-live', ['go','test','./internal/engine','-run','^TestLiveMainTaskAndConsciousness$','-count=1','-v'], SNAP/'demo_src_go', goenv)]
    for scenario in ['chain','missing','unknown','transport','reject']:
        jobs.append(('pi-live-'+scenario, ['node','node_modules/tsx/dist/cli.mjs','pi_secretary/scripts/test-live.ts','gpt-5.6-luna',scenario], SNAP/'demo_pi', pienv))
    manifest_name = 'live-command-results.json'
    if '--memory-only' in sys.argv or '--memory-go-only' in sys.argv:
        common = {'AUDIT_MEMORY_BATTERY': str(ROOT/'test/probes/comparison-20260922/memory-battery.json')}
        goenv.update(common, AUDIT_MEMORY_DATA=str(SNAP.parent/'memory-go'), AUDIT_MEMORY_REPORT=str(OUT/'go-memory.json'))
        pienv.update(common, AUDIT_MEMORY_DATA=str(SNAP.parent/'memory-pi'), AUDIT_MEMORY_REPORT=str(OUT/'pi-memory.json'))
        jobs = [
            ('go-memory', ['go','test','./internal/engine','-run','^TestAuditLiveMemory$','-count=1','-v'], SNAP/'demo_src_go',goenv),
            ('pi-memory', ['node','node_modules/tsx/dist/cli.mjs','pi_secretary/scripts/audit-memory.ts'], SNAP/'demo_pi',pienv),
        ]
        manifest_name = 'memory-command-results.json'
        if '--memory-go-only' in sys.argv:
            jobs = jobs[:1]
            manifest_name = 'memory-go-retry-command-results.json'
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(run, *job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            (OUT/manifest_name).write_text(json.dumps(results,indent=2)+'\n')
            print(result, flush=True)


if __name__ == '__main__':
    main()
