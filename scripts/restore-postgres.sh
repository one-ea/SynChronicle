#!/bin/sh
set -eu

usage() {
  echo "usage: scripts/restore-postgres.sh --confirm-restore --environment NAME INPUT.dump"
}

if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "${1:-}" != "--confirm-restore" ] || [ "${2:-}" != "--environment" ] || [ -z "${3:-}" ] || [ -z "${4:-}" ] || [ -n "${5:-}" ]; then
  usage >&2
  exit 2
fi

expected_environment="$3"
input="$4"
: "${ENV_FILE:=.env.web}"
export ENV_FILE

if [ ! -f "$input" ] || [ ! -s "$input" ]; then
  echo "restore dump must be a non-empty regular file" >&2
  exit 2
fi
if [ "$(dd if="$input" bs=5 count=1 2>/dev/null)" != "PGDMP" ]; then
  echo "restore dump is not a PostgreSQL custom-format archive" >&2
  exit 2
fi
case "$expected_environment" in
  ""|*[!A-Za-z0-9_-]*) echo "environment name contains invalid characters" >&2; exit 2 ;;
esac

original_database=""
backup_database=""
target_database=""
completed=false
restore_failure() {
  status=$?
  if [ "$completed" != true ]; then
    docker compose --env-file "$ENV_FILE" stop web worker >/dev/null 2>&1 || true
    echo "restore failed; web and worker remain stopped" >&2
    echo "inspect PostgreSQL and restore logs before retrying" >&2
    if [ -n "$original_database" ]; then echo "expected active database: $original_database" >&2; fi
    if [ -n "$backup_database" ]; then echo "retained previous database: $backup_database" >&2; fi
    if [ -n "$target_database" ]; then echo "restore candidate database: $target_database" >&2; fi
    if [ -n "$backup_database" ]; then
      echo "recovery: keep services stopped, inspect both databases, rename the failed active database aside, rename $backup_database back to $original_database, then run migrate and readiness before starting services" >&2
    fi
  fi
  exit "$status"
}
trap restore_failure EXIT
trap 'exit 130' INT TERM

docker compose --env-file "$ENV_FILE" up -d postgres
actual_environment="$(docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'printf %s "$DEPLOYMENT_ENV"')"
if [ "$actual_environment" != "$expected_environment" ]; then
  echo "target environment mismatch: expected $expected_environment" >&2
  exit 2
fi

original_database="$(docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')"
case "$original_database" in
  ""|*[!A-Za-z0-9_]*) echo "POSTGRES_DB contains invalid characters" >&2; exit 2 ;;
esac

docker compose --env-file "$ENV_FILE" stop web worker
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
database_prefix="$(printf '%s' "$original_database" | cut -c1-30)"
target_database="${database_prefix}_restore_${timestamp}"
backup_database="${database_prefix}_backup_${timestamp}"

docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'createdb --username="$POSTGRES_USER" "$1"' sh "$target_database"
docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'pg_restore --no-owner --exit-on-error --username="$POSTGRES_USER" --dbname="$1"' sh "$target_database" < "$input"
docker compose --env-file "$ENV_FILE" run --rm -e DATABASE_NAME_OVERRIDE="$target_database" migrate
docker compose --env-file "$ENV_FILE" run --rm -e DATABASE_NAME_OVERRIDE="$target_database" --entrypoint node migrate dist/db/maintenance-main.js ready

docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'psql --username="$POSTGRES_USER" --dbname=postgres -v database_name="$1" -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = :'"'"'database_name'"'"' and pid <> pg_backend_pid();"' sh "$original_database"
docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'psql --username="$POSTGRES_USER" --dbname=postgres -c "ALTER DATABASE \"$1\" RENAME TO \"$2\";"' sh "$original_database" "$backup_database"
docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'psql --username="$POSTGRES_USER" --dbname=postgres -c "ALTER DATABASE \"$1\" RENAME TO \"$2\";"' sh "$target_database" "$original_database"

docker compose --env-file "$ENV_FILE" up -d web worker
attempts=0
until curl --fail --silent "${PUBLIC_URL:-http://127.0.0.1:${WEB_PORT:-3000}}/api/health/ready" >/dev/null; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 30 ]; then
    echo "restored service readiness timed out" >&2
    exit 1
  fi
  sleep 2
done

completed=true
echo "restore completed; previous database retained as $backup_database"
