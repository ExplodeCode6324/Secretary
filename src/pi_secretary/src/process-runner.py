"""One gated process group per operation; fd 3 owns the Core lifetime, fd 4 reports readiness/result."""
import json, os, platform, re, select, signal, subprocess, sys, time


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, start_new_session=True).strip()


def host_identity():
    if sys.platform == 'linux':
        with open('/etc/machine-id') as f:
            machine = f.read().strip()
        with open('/proc/sys/kernel/random/boot_id') as f:
            boot = f.read().strip()
    elif sys.platform == 'darwin':
        raw = command('/usr/sbin/ioreg', '-rd1', '-c', 'IOPlatformExpertDevice')
        machine = re.search(r'"IOPlatformUUID" = "([^"]+)"', raw).group(1)
        boot = command('/usr/sbin/sysctl', '-n', 'kern.bootsessionuuid')
    else:
        raise RuntimeError('PROCESS_PLATFORM_UNSUPPORTED')
    return {'machine': machine, 'boot': boot}


def identity(pid):
    row = command('ps', '-p', str(pid), '-o', 'pgid=', '-o', 'lstart=', '-o', 'command=')
    parts = row.split(None, 6)
    if len(parts) != 7:
        raise RuntimeError('PROCESS_IDENTITY_UNAVAILABLE')
    return {'pgid': int(parts[0]), 'start': ' '.join(parts[1:6]), 'command': parts[6]}


def probe(record):
    host = host_identity()
    if host['machine'] != record['machine']:
        return 'UNCONFIRMED'
    if host['boot'] != record['boot']:
        return 'STOPPED'
    try:
        os.killpg(record['pgid'], 0)
    except ProcessLookupError:
        return 'STOPPED'
    except PermissionError:
        return 'UNCONFIRMED'
    try:
        live = identity(record['pid'])
        if (live['pgid'] == record['pgid'] and live['start'] == record['start']
                and ('--run ' + record['token']) in live['command']):
            return 'RUNNING'
    except Exception:
        pass
    return 'UNCONFIRMED'


def report(value):
    try:
        os.write(4, (json.dumps(value) + '\n').encode())
    except BrokenPipeError:
        pass


def members():
    rows = command('ps', '-axo', 'pid=,pgid=,stat=')
    return [int(p) for p, g, state in (line.split() for line in rows.splitlines())
            if int(g) == os.getpgrp() and int(p) != os.getpid() and not state.startswith('Z')]


def run(token):
    # The wrapper remains the group leader through cleanup. TERM never removes it early.
    stopping = [False]
    signal.signal(signal.SIGTERM, lambda *_: stopping.__setitem__(0, True))
    signal.signal(signal.SIGINT, lambda *_: stopping.__setitem__(0, True))
    own = identity(os.getpid())
    report({'ready': {**host_identity(), 'pid': os.getpid(), 'pgid': os.getpgrp(),
                      'start': own['start'], 'token': token}})
    data = b''
    while b'\n' not in data and not stopping[0]:
        ready, _, _ = select.select([3], [], [], .05)
        if ready:
            chunk = os.read(3, 65536)
            if not chunk:
                report({'result': {'not_started': True}})
                return
            data += chunk
    first, _, pending = data.partition(b'\n')
    if stopping[0] or first == b'STOP' or pending:
        # STOP may arrive alone or in the same read as the start frame.
        report({'result': {'not_started': True}})
        return
    request = json.loads(first)
    # Authorization and process identity are durable before Core sends this message.
    child = subprocess.Popen(request['argv'], close_fds=True)
    while child.poll() is None and not stopping[0]:
        ready, _, _ = select.select([3], [], [], .02)
        if ready:
            # EOF (Core death) or STOP both terminate the owned group.
            os.read(3, 4096)
            stopping[0] = True
    code = child.poll()
    report({'result': {'exit_code': code if code is not None and code >= 0 else None,
                       'signal': -code if code is not None and code < 0 else None}})
    if stopping[0] or members():
        os.killpg(os.getpgrp(), signal.SIGTERM)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            child.poll()
            if not members():
                return
            time.sleep(.02)
        # Own leader still pins this PGID; kill includes ourselves and every remaining member.
        os.killpg(os.getpgrp(), signal.SIGKILL)


if __name__ == '__main__':
    if sys.argv[1] == '--run':
        run(sys.argv[2])
    else:
        record = json.load(sys.stdin)
        try:
            status = probe(record)
            if sys.argv[1] in ('--term', '--kill') and status == 'RUNNING':
                # Revalidate immediately before sending; POSIX offers no atomic group identity handle.
                os.killpg(record['pgid'], signal.SIGTERM if sys.argv[1] == '--term' else signal.SIGKILL)
            print(json.dumps({'status': status}))
        except ProcessLookupError:
            print(json.dumps({'status': 'STOPPED'}))
        except Exception:
            print(json.dumps({'status': 'UNCONFIRMED'}))
