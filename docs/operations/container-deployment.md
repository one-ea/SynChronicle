# Container Deployment Runbook

## Initial deployment

Copy `.env.web.example` to `.env.web`, replace every placeholder, then validate and start the platform:

```bash
ENV_FILE=.env.web docker compose config
ENV_FILE=.env.web docker compose up -d --build
curl --fail http://127.0.0.1:3000/api/health/live
curl --fail http://127.0.0.1:3000/api/health/ready
```

The Web service is the single public endpoint for static files, API requests, and WebSocket connections. PostgreSQL and Worker remain on the internal Compose network.

## Backup

Create a PostgreSQL custom-format backup containing all business tables, encrypted credential metadata, and migration state:

```bash
ENV_FILE=.env.web scripts/backup-postgres.sh synchronicle-backup.dump
```

Store the dump and the credential master-key versions in separate protected systems. The dump contains ciphertext and still depends on the matching master keys.

## Restore

Restore into an empty, access-restricted PostgreSQL database, run migrations, then start Web and Worker:

```bash
ENV_FILE=.env.web scripts/restore-postgres.sh synchronicle-backup.dump
ENV_FILE=.env.web docker compose up -d web worker
```

Validate `/api/health/ready` and inspect Worker logs before reopening traffic.

## Key rotation

1. Generate a new 32-byte base64 project credential master key in the deployment secret manager.
2. Add the new version to `PROJECT_CREDENTIAL_MASTER_KEYS` while retaining every version referenced by stored credentials.
3. Set `PROJECT_CREDENTIAL_MASTER_KEY_VERSION` to the new version.
4. Preview the bounded operation without writes or audit events:

```bash
ENV_FILE=.env.web docker compose run --rm worker credential-reencrypt --dry-run --batch-size=100
```

5. Execute re-encryption. Each batch locks eligible rows, decrypts with the envelope key version, encrypts with the current version, and writes a metadata-only audit event in one transaction:

```bash
ENV_FILE=.env.web docker compose run --rm worker credential-reencrypt --batch-size=100
```

6. Rerun the dry-run until `rotated=0`, then roll Web and Worker and verify model access.
7. Keep previous keys available until backups encrypted under those versions pass their retention period. Interrupted runs are recoverable because completed rows already carry the current key version and are skipped idempotently.

## Scale worker

Worker IDs default to unique generated values, and database leases preserve exclusive task execution:

```bash
ENV_FILE=.env.web docker compose up -d --scale worker=4
```

Scale gradually while monitoring PostgreSQL connections, provider rate limits, task latency, and quota settlement.

## Quota reconcile

Run one bounded reconciliation job after an unclean Worker stop or settlement incident:

```bash
ENV_FILE=.env.web docker compose run --rm worker quota-reconcile
```

The command releases or settles stale reservations whose task lease is absent, expired, or replaced.

## Troubleshooting

- `migrate` exits non-zero: inspect `docker compose logs migrate postgres`; resolve migration or database access errors before starting Worker.
- readiness returns 503: verify PostgreSQL health, `DATABASE_URL`, and the `drizzle.__drizzle_migrations` table.
- readiness returns 503 after a partial migration: compare every image `drizzle/meta/_journal.json` entry with `drizzle.__drizzle_migrations`; both SHA-256 hash and `created_at` must match.
- liveness fails: inspect `docker compose logs web`; restart policy will recover process-level failures.
- Worker receives no tasks: inspect `docker compose logs worker`, Worker lease settings, user concurrency, and platform concurrency.
- WebSocket disconnects: verify clients use the same `PUBLIC_URL` origin and the Web port directly.
- credential decryption fails: confirm the configured master-key map contains the stored credential key version.
- credential re-encryption stops: retain every old key, inspect metadata-only `credential.reencrypt` audit events, fix the failing envelope, and rerun the same command.
- PostgreSQL volume pressure: take a backup, expand the managed volume, and verify free space before restarting writes.
