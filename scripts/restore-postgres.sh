#!/bin/sh
set -eu

if [ "${1:-}" = "--help" ]; then
  echo "usage: scripts/restore-postgres.sh INPUT.dump"
  exit 0
fi

input="${1:?restore input path is required}"
: "${ENV_FILE:=.env.web}"
export ENV_FILE

docker compose --env-file "$ENV_FILE" up -d postgres
docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' < "$input"
docker compose --env-file "$ENV_FILE" run --rm migrate
