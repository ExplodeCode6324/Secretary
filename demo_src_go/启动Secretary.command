#!/bin/zsh
set -eu
cd "${0:A:h}"
if [[ -f .private/runtime.env ]]; then
  set -a
  source .private/runtime.env
  set +a
fi
mkdir -p bin .local
go build -o bin/secretary ./cmd/secretary
case "${SECRETARY_PG_DSN:-}" in
  *host=/tmp/secretary-go-demo-*) ./scripts/postgres.sh start; ./bin/secretary world migrate ;;
esac
./bin/secretary init
if ! curl --silent --fail "http://127.0.0.1:8787/healthz" >/dev/null; then
  "$(pwd)/bin/secretary" serve >> .local/server.log 2>&1 &
  echo $! > .local/serve.pid
  for i in {1..50}; do
    if curl --silent --fail "http://127.0.0.1:8787/healthz" >/dev/null; then break; fi
    sleep 0.2
  done
fi
python3 scripts/open-ui.py
print 'Secretary 已启动；关闭服务请运行 停止Secretary.command。'
