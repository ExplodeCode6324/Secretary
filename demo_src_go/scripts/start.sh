#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ -f .private/runtime.env ]; then
  set -a
  . ./.private/runtime.env
  set +a
fi
./scripts/start-background.sh
exec ./bin/secretary tui
