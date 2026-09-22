#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
pg_bin=$(pg_config --bindir)
pg_data="$(pwd)/.local/postgres"
pg_socket="/tmp/secretary-go-demo-$(id -un)"
case "${1:-start}" in
start)
  mkdir -p .local "$pg_socket"
  chmod 700 "$pg_socket"
  if [ ! -f "$pg_data/PG_VERSION" ]; then
    "$pg_bin/initdb" -D "$pg_data" --no-locale --encoding=UTF8 --auth=trust > .local/postgres-init.log
  fi
  if ! "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then
    "$pg_bin/pg_ctl" -D "$pg_data" -l "$(pwd)/.local/postgres.log" -o "-k $pg_socket -c listen_addresses='' -c fsync=on" -w start
  fi
  if ! "$pg_bin/psql" -h "$pg_socket" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='secretary_go_demo'" | grep -q 1; then
    "$pg_bin/createdb" -h "$pg_socket" secretary_go_demo
  fi
  ;;
stop)
  if "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then
    "$pg_bin/pg_ctl" -D "$pg_data" -m fast -w stop
  fi
  ;;
*) echo 'usage: postgres.sh start|stop'; exit 1;;
esac
