#!/usr/bin/env python3
"""Authenticate the local coordinator and require its TUI-only interface version."""
import json
import os
import pathlib
import urllib.request

config_path = pathlib.Path(os.environ.get('SECRETARY_CONFIG', 'configs/local.json'))
config = json.loads(config_path.read_text()) if config_path.exists() else {}
address = os.environ.get('SECRETARY_LISTEN', config.get('listen', '127.0.0.1:8787'))
if not address.startswith('127.0.0.1:') or not address.split(':',1)[1].isdigit():
    raise SystemExit('Invalid local listener')
root = pathlib.Path(os.environ.get('SECRETARY_DATA_ROOT', config.get('data_root', '.local/data')))
token = (root/'master.token').read_text().strip()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
base = 'http://' + address
health = json.load(opener.open(base+'/healthz', timeout=2))
if health.get('interface') != 'TUI':
    raise SystemExit('A previous interface is still running; stop the old coordinator first')
request = urllib.request.Request(base+'/v1/session', headers={'Authorization':'Bearer '+token})
state = json.load(opener.open(request, timeout=2))
if 'session' not in state or 'runtime' not in state:
    raise SystemExit('Invalid coordinator response')
print('Local TUI coordinator ready')
