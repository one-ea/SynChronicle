#!/bin/sh
set -eu

if [ "${1:-}" = "--help" ]; then
  echo "usage: scripts/backup-postgres.sh OUTPUT.dump"
  exit 0
fi

output="${1:?backup output path is required}"
: "${ENV_FILE:=.env.web}"
export ENV_FILE

docker compose --env-file "$ENV_FILE" exec -T postgres sh -c 'pg_dump --format=custom --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' > "$output"
