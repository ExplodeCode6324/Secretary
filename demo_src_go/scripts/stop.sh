#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Only stop a PID recorded by our launch script and still running our binary.
if [ ! -f .local/serve.pid ]; then
  echo 'No launcher-owned process. Use Ctrl-C in the terminal running start.sh.'
  exit 0
fi
pid=$(cat .local/serve.pid)
case "$pid" in *[!0-9]*|'') echo 'Invalid PID record'; exit 1;; esac
expected="$(pwd)/bin/secretary serve"
actual=$(ps -p "$pid" -o command= || true)
if [ "$actual" != "$expected" ]; then
  echo 'Recorded process is not this Secretary server; no signal sent.'
  exit 1
fi
kill -TERM "$pid"
echo 'Stop requested; durable state is retained.'
