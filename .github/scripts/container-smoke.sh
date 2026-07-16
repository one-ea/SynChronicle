#!/bin/sh
set -eu

export COMPOSE_PROJECT_NAME="synchronicle-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
export WEB_PORT="${WEB_PORT:-33000}"
ENV_FILE_PATH="${RUNNER_TEMP:-/tmp}/synchronicle-container-smoke.env"
export ENV_FILE="$ENV_FILE_PATH"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose --env-file "$ENV_FILE_PATH" ps || true
    docker compose --env-file "$ENV_FILE_PATH" logs --no-color || true
  fi
  docker compose --env-file "$ENV_FILE_PATH" down --volumes --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT INT TERM

session_secret="$(openssl rand -hex 32)"
master_key="$(openssl rand -base64 32 | tr -d '\n')"
database_password="$(openssl rand -hex 24)"
cat > "$ENV_FILE_PATH" <<EOF
POSTGRES_DB=synchronicle
POSTGRES_USER=synchronicle
POSTGRES_PASSWORD=$database_password
DATABASE_URL=postgres://synchronicle:$database_password@postgres:5432/synchronicle
PUBLIC_URL=http://127.0.0.1:$WEB_PORT
SESSION_SECRET=$session_secret
PROJECT_CREDENTIAL_MASTER_KEYS=v1:$master_key
PROJECT_CREDENTIAL_MASTER_KEY_VERSION=v1
PROJECT_PROVIDER_ALLOWED_HOSTS={}
TRUST_PROXY=false
PORT=3000
WORKER_LEASE_MS=30000
WORKER_IDLE_MS=1000
EOF

docker compose --env-file "$ENV_FILE_PATH" config --quiet
docker compose --env-file "$ENV_FILE_PATH" up -d --build postgres migrate web worker

attempts=0
until curl --fail --silent "http://127.0.0.1:$WEB_PORT/api/health/ready" > /dev/null; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 90 ]; then
    echo "web readiness timed out" >&2
    exit 1
  fi
  sleep 2
done

docker compose --env-file "$ENV_FILE_PATH" ps --status exited migrate | grep -q migrate
migrate_id="$(docker compose --env-file "$ENV_FILE_PATH" ps -a -q migrate)"
worker_id="$(docker compose --env-file "$ENV_FILE_PATH" ps -q worker)"
docker inspect --format '{{.State.ExitCode}}' "$migrate_id" | grep -q '^0$'
docker inspect --format '{{.State.Health.Status}}' "$worker_id" | grep -q '^healthy$'
curl --fail --silent "http://127.0.0.1:$WEB_PORT/api/health/live" > /dev/null
