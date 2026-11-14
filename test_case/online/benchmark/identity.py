"""Reuse product platform/boot/start identity; do not infer ownership from PID alone."""
import importlib.util, json, pathlib, sys
source = pathlib.Path(__file__).resolve().parents[3] / 'src/pi_secretary/src/process-runner.py'
spec = importlib.util.spec_from_file_location('secretary_process_identity', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
pid, token = int(sys.argv[1]), sys.argv[2]
live = module.identity(pid)
if ('--run ' + token) not in live['command'] or live['pgid'] != pid:
    raise RuntimeError('PROCESS_NOT_OWNED')
print(json.dumps({**module.host_identity(), 'pid': pid, 'pgid': pid, 'start': live['start'], 'token': token, 'state': 'RUNNING'}))
