#!/bin/sh
set -eu

command="${1:-web}"

if [ "${2:-}" = "--help" ]; then
  case "$command" in
    quota-reconcile)
      echo "usage: container-entrypoint.sh quota-reconcile"
      exit 0
      ;;
    credential-reencrypt)
      echo "usage: container-entrypoint.sh credential-reencrypt [--dry-run] [--batch-size=N]"
      exit 0
      ;;
  esac
fi

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
  credential-reencrypt)
    wait_for_database
    shift
    exec node dist/db/maintenance-main.js credential-reencrypt "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
