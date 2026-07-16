#!/bin/sh
set -eu

command="${1:-web}"

wait_for_database() {
  node dist/db/maintenance-main.js wait
}

# The migration command holds pg_advisory_lock until Drizzle finishes.
case "$command" in
  web)
    wait_for_database
    exec node dist/web/main.js
    ;;
  worker)
    wait_for_database
    exec node dist/worker/main.js
    ;;
  migrate)
    wait_for_database
    exec node dist/db/maintenance-main.js migrate
    ;;
  quota-reconcile)
    wait_for_database
    exec node dist/db/maintenance-main.js quota-reconcile
    ;;
  *)
    exec "$@"
    ;;
esac
