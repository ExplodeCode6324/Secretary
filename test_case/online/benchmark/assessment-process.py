"""Read-only grading guard; never signal a process or alter lifecycle evidence.

POSIX process-ID reuse waits for the lifetime of a group with that ID to end:
https://nvlpubs.nist.gov/nistpubs/Legacy/FIPS/fipspub151-1.pdf
This handles a positive, later identity at a recycled historical group leader PID.
All ambiguous observations remain UNCONFIRMED. Product lifecycle guards are unchanged.
"""
import importlib.util
import json
import pathlib
import sys
import time


def classify(record, status, host=None, live=None):
    if status != 'UNCONFIRMED':
        return status
    try:
        if (record['pid'] != record['pgid'] or record['pid'] <= 1
                or host['machine'] != record['machine'] or host['boot'] != record['boot']
                or live['pgid'] != record['pgid']
                or ('--run ' + record['token']) in live['command']):
            return 'UNCONFIRMED'
        old = time.strptime(record['start'], '%a %b %d %H:%M:%S %Y')
        new = time.strptime(live['start'], '%a %b %d %H:%M:%S %Y')
        return 'STOPPED_REUSED_IDENTITY' if new > old else 'UNCONFIRMED'
    except Exception:
        return 'UNCONFIRMED'


def main():
    source = pathlib.Path(__file__).resolve().parents[3] / 'src/pi_secretary/src/process-runner.py'
    spec = importlib.util.spec_from_file_location('runner', source)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    record = json.load(sys.stdin)
    status = runner.probe(record)
    host = live = None
    if status == 'UNCONFIRMED':
        try:
            host, live = runner.host_identity(), runner.identity(record['pid'])
        except Exception:
            pass
    print(json.dumps({'status': classify(record, status, host, live)}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'status': 'UNCONFIRMED'}))
