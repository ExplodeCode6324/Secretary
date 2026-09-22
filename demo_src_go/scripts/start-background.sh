#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ -f .private/runtime.env ]; then
  set -a
  . ./.private/runtime.env
  set +a
fi
mkdir -p bin .local
go build -o bin/secretary ./cmd/secretary
./bin/secretary init
# Only probe the configured loopback listener. No token is put in argv or a URL.
if python3 scripts/check-service.py >/dev/null 2>&1; then
  exit 0
fi
case "${SECRETARY_PG_DSN:-}" in
  *host=/tmp/secretary-go-demo-*) ./scripts/postgres.sh start; ./bin/secretary world migrate ;;
esac
python3 - <<'PY'
import pathlib,subprocess,time
root=pathlib.Path.cwd()
with (root/'.local/server.log').open('ab') as log:
    proc=subprocess.Popen([str(root/'bin/secretary'),'serve'],cwd=root,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
for _ in range(60):
    if proc.poll() is not None: raise SystemExit('Secretary failed to start; inspect .local/server.log')
    if subprocess.run(['python3','scripts/check-service.py'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
        (root/'.local/serve.pid').write_text(str(proc.pid)+'\n')
        break
    time.sleep(.2)
else:
    proc.terminate()
    raise SystemExit('Secretary startup timed out; inspect .local/server.log')
PY
