# Private DigitalOcean inference runtime

This is the operational contract for the selected-photo inference profile. PostgreSQL stores operational grants, consent, budgets and recovery receipts. Obsidian remains the durable memory owner; no originals are written to this service. The legacy Supabase database, object storage and worker are outside this topology.

DO-OPS-01 is a source and synthetic-CI implementation candidate. No live host was contacted or changed, no real credential or activation record was created, no production backup was made, and no API was deployed. Current host capacity, current Supabase ownership, DNS/TLS readiness, and an approved off-host backup destination remain **UNKNOWN**.

## Runtime boundary

`compose.yml` has an isolated project name, `recall-do-inference`. The PostgreSQL service uses the exact pinned `pgvector/pgvector:0.8.7-pg16-bookworm` digest recorded in the packet, has a durable named volume, and publishes no database port. Its private Compose network is marked internal. The API joins that network and a separate egress network for a future explicitly approved Anthropic call. The API is bound only to `127.0.0.1:8001` over HTTP; this does not replace the existing HTTPS proxy or authorize a public proxy cutover. No new listener uses 80 or 443.

Plain `docker compose up -d db` starts only PostgreSQL. Migration and bootstrap are explicit one-shot maintenance services. API has a separate `runtime` profile and cannot start successfully without the reviewed activation record, least-privilege schema checks and a cleared external recovery record. The API receives only `recovery/hold.json` as a read-only dedicated bind mount, never the broader secret directory. Its supervisor polls that atomically replaced record and fences the API when it becomes held or unreadable; it does not auto-restart after a recovery fence. A post-restore hold remains on disk outside the database volume; restoring an old database must never clear it automatically.

The PostgreSQL container's local Unix socket uses `trust` only for initialization inside that container. The host-facing database listener uses SCRAM authentication and is reachable only over the private Compose network. Docker daemon access is an operator trust boundary. The operator/superuser DSN is mounted only into the explicit bootstrap service; the migration-owner DSN is mounted only into migration; only the non-owner API DSN is mounted into the runtime API.

## Prepare local files and validate Compose syntax

Docker Compose configuration parsing is local and does not require a running daemon. To create ignored, unapproved placeholders solely so Compose can resolve its file references:

```sh
cd infra/do-inference
python ops/prepare-config.py
docker compose -p recall-do-inference -f compose.yml config --quiet
```

The generated activation example has `status=unapproved-example`, and `recovery/hold.json` is held. Both intentionally fail the runtime preflight. Do not start the API from placeholder values. Preserve existing `secrets/` and `recovery/` directories; `prepare-config.py` refuses to overwrite any file. All `*.local` files and the recovery directory are ignored.

For an owner-authorized setup, place operator-created values in ignored secret files: three role passwords, the operator/migration/API database URLs, the reviewed activation JSON, the provider key, and `runtime.env.local`. Store the external recovery-clearance JSON only at `recovery/hold.json`, mode `0644`, in a mode-`0755` recovery directory outside the database volume. It contains only hold metadata, so the API can read its dedicated read-only mount while the operator can atomically replace it; it must never contain a secret. Keep values out of command-line arguments, shell history, CI artifacts, logs and repository files. For the pinned images, database secret files must be readable by the `postgres` UID 999 and backend runtime/migration files by the fixed `recall` UID 10001; verify these IDs against the exact images before provisioning. The runtime env file contains consistency settings and the optional Anthropic workspace header, but no API key.

The exact source image is built from `services/backend/Dockerfile`; no provider or mock implementation is added to it. The existing migration owner creates tables. The init script uses psql's quoted literal substitution for password values read from mounted files; neither password appears in arguments or command output. `recall_worker` remains `NOLOGIN`; no worker service is configured.

## Migrate, bootstrap and launch gates

After a deliberate owner-authorized database initialization, start PostgreSQL and apply the checked-in migrations with the distinct migration-owner credential:

```sh
docker compose -p recall-do-inference -f compose.yml up -d db
docker compose -p recall-do-inference -f compose.yml --profile maintenance run --rm migrate
```

The migration command then verifies the exact file checksums, public relation allowlist, expected roles and memberships, non-owner table ownership, required security functions, and forced RLS/policies on every private table. It fails closed on missing or extra objects.

The initial owner workspace is a separate explicit operation. It uses the operator's superuser DSN and requires explicit IDs and `--approve`; it never invents an owner, migrates a legacy user, or creates devices. Run it only after a separate production approval and only against the verified new empty inference realm:

```sh
docker compose -p recall-do-inference -f compose.yml --profile maintenance run --rm bootstrap \
  --profile inference --approve --owner-id <reviewed-owner-uuid> --workspace-id <reviewed-workspace-uuid>
```

The activation record is a consistency gate, not cryptographic proof of approval. It must include a fresh `new_production_approval_ref` and `review_id`, exact HTTPS origin, owner/workspace/device/vault IDs, `scope: inference-only`, `device_scope: photo_inference`, consent version, Anthropic account/workspace, model, rates and daily/monthly budget. API model/rate/budget settings must match it. The prior USD 5/$1.50 synthetic approval does not authorize this new production topology; the owner must separately approve this exact deployment, scope, provider account, model and limits. The checked-in example and CI approval references are synthetic and cannot authorize production. No production activation/approval record currently exists in this repository; that state remains UNKNOWN. `AI_API_KEY` is loaded from its mounted file; preflight checks only that it is present and never prints it. If `ANTHROPIC_CUSTOM_HEADERS` is configured, use only the Anthropic SDK custom-header environment field, set `anthropic-workspace-id` to the same owner-approved provider workspace recorded in `provider_account`, and let preflight reject a mismatch. No value is supplied here.

API startup also checks that the connection is the `recall_api` login, that it has no superuser/BYPASSRLS/database-creation/role-creation/replication privileges, that it inherits only the intended `recall_app` grants, and that all private public-schema relations remain owned by `recall_migrator` with forced RLS and policies. It rejects legacy auth/signing, Supabase, worker and embedding settings. Provider activation has zero retry and no refusal fallback in the existing inference app. Do not expose port 8001 publicly; HTTPS proxy cutover needs its own review and authorization.

## Encrypted database backup and restore

Inference has no server-side original store, so its backup contains the complete PostgreSQL database: workspace/device grants, consents, local-reading receipts, usage/budget reservations, schema objects and the migration ledger. The tool takes the existing exclusive backup advisory lock and passes a PostgreSQL-exported consistent snapshot to `pg_dump`. Plaintext dump and archive exist only in a mode-0700 temporary directory and are removed on exit. The output is encrypted with `age` using an operator-provided recipient; this implementation never generates an owner identity. Follow the official age v1.3.2 Linux amd64 release and verify SHA-256 `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10` before using it.

Provide `RECALL_BACKUP_DATABASE_URL_FILE`, `RECALL_BACKUP_DESTINATION`, and `RECALL_BACKUP_AGE_RECIPIENT`, then run `uv run --project services/backend python infra/do-inference/ops/backup.py`. The adjacent `.sha256` file detects transfer damage; it does not authenticate who created the archive. Keep both files in an owner-controlled encrypted off-host destination. The approved Windows/off-host destination is currently **UNKNOWN**. A Docker named volume or same-host copy is not an off-host backup or recovery proof.

Restore only after stopping the API, initializing the exact required PostgreSQL roles and memberships, preparing an empty target database owned by `recall_migrator`, and confirming that the external recovery-hold file is durable outside the database volume. Set `RECALL_RESTORE_ARCHIVE`, `RECALL_RESTORE_AGE_IDENTITY_FILE`, `RECALL_RESTORE_DATABASE_URL_FILE`, `RECALL_RESTORE_HOLD_PATH`, `RECALL_RESTORE_API_FENCE_URL=http://127.0.0.1:8001/healthz`, `RECALL_RESTORE_COMPOSE_PROJECT=recall-do-inference`, and the exact stopped API container ID in `RECALL_RESTORE_API_CONTAINER_ID`; run `uv run --project services/backend python infra/do-inference/ops/restore.py`. The command atomically activates the external hold before inspecting the archive or target, then requires Docker inspection to show that exact project’s `api` service is not running and requires loopback health refusal before it opens target SQL. It checks the encrypted-file checksum, asserts the connected `current_database()` equals the declared target, verifies the restricted archive inventory and database hash, restores only to an empty database, checks table row counts and migration ledger, reruns the role/RLS audit, and leaves the external hold active. The private age identity is read by path and must never be passed as a value or saved in this repository.

An older snapshot may restore revoked device grants and omit provider usage or pending vault outcomes from after the snapshot. Before API restart, reconcile provider usage and pending vault operations with their authoritative records, revoke every restored old pairing grant using the existing owner-revoke function, create fresh approved device association, obtain fresh activation review and explicitly clear the external recovery hold. The application does not automate this clearance. No snapshot alone establishes provider billing state, vault commitment, or freshness of a device grant.

## Synthetic CI proof and limits

`.github/workflows/do-inference-ops.yml` checks the exact checked-out candidate using read-only repository access, a randomized Compose project and named volumes, and the same pinned PostgreSQL image. It initializes a separate fresh restore cluster so role initialization is proved independently from the source cluster. It runs migrations/role/RLS audits, proves actual container refusal for review, budget, header, ledger and role-membership mismatch, then starts the API through the production preflight/entrypoint. It checks health and route rejection, then uses the existing fake provider only in the host test process for synthetic grant/photo/receipt/replay/restart/revocation behavior. It creates an ephemeral CI-only age identity, encrypts a synthetic database backup, restores it into the separate empty cluster, compares the retained synthetic identity/consent/device/grant/receipt/budget state, and proves the running API is fenced by the hold. The workflow removes only its unique Compose project/volumes and generated synthetic files.

This CI does not prove DO host access, available memory/disk, installed Docker versions, TLS, an owner-controlled off-host copy, live provider configuration or billing, real activation, real photo quality, or installed-device behavior. The host capacity snapshot and available memory in the packet are not a capacity test. No deployment, host mutation, real bootstrap, provider request, device enrollment or user-data migration is authorized here.
