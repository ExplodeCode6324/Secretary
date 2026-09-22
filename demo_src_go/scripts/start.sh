#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ -f .private/runtime.env ]; then
  set -a
  . ./.private/runtime.env
  set +a
fi
if [ ! -x bin/secretary ]; then
  mkdir -p bin
  go build -o bin/secretary ./cmd/secretary
fi
case "${SECRETARY_PG_DSN:-}" in
  *host=/tmp/secretary-go-demo-*) ./scripts/postgres.sh start; ./bin/secretary world migrate ;;
esac
./bin/secretary init
exec ./bin/secretary serve
