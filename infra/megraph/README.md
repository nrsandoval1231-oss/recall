# MeGraph deployment checkpoint

This Compose stack serves the **approved desktop React application** in a browser. It does not use the historical `apps/web` interface. It is a verified local deployment checkpoint, **not a production release or completion of the owner's master prompt**.

## Isolation and prerequisites

Inspect the Hostinger VPS first: OS/resources, `docker ps`, existing Compose projects, reverse-proxy configuration, firewall, occupied ports, disk space, backup destination and DNS. Preserve Orloom, GridLens and every existing service. This project publishes only `127.0.0.1:18880`; PostgreSQL, API, worker and administrative enrollment are not published. The existing HTTPS proxy should route only the chosen MeGraph hostname to that loopback port. Do not replace the host proxy or bind ports 80/443 from this stack.

Required access, not available during this implementation: VPS SSH hostname/IP and user with Docker/proxy permissions; authorized SSH credentials through secure environment provisioning; intended hostname and DNS/proxy access; remote provider credentials and pinned model/prices; encrypted off-host backup destination. No Hostinger changes were made.

## Build and start

From the repository root, copy `infra/megraph/.env.example` to a private environment file outside version control. Generate independent cryptographically random passwords/secrets (at least 32 random bytes each), set the DSNs to the matching passwords, and set the issuer and allowed origin to the actual HTTPS hostname. Keep the file mode 0600. Never pass production secrets as build arguments.

```sh
docker compose --env-file /private/megraph.env -f infra/megraph/compose.yml build
docker compose --env-file /private/megraph.env -f infra/megraph/compose.yml up -d
docker compose --env-file /private/megraph.env -f infra/megraph/compose.yml ps -a
```

Optional corporate build CA support: `docker build --secret id=build_ca,src=/path/to/ca.pem -f infra/megraph/Web.Dockerfile -t megraph-web:local .` (same secret for the backend Dockerfile). TLS verification remains enabled; the CA is a build-time secret, not copied into the image.

The database initialization script creates distinct owner/API/worker roles. Migrations run as owner; runtime roles have no owner password. API and web containers run as restricted users with read-only roots. Originals and PostgreSQL have separate persistent volumes. Services restart automatically; logs rotate. `/readyz` checks the API's dependencies. Preserve volumes during upgrade. Never run `down -v` against a real installation.

## Owner access

Issue the first one-time enrollment **inside the API container** using `POST http://127.0.0.1:8000/v1/operator/enrollments`, header `Authorization: Bearer $RECALL_OPERATOR_TOKEN`, JSON `{}`. Retain the returned `user_id` and `workspace_id`. For every subsequent desktop/browser/iPhone enrollment, pass those **same** two IDs in the JSON body; `{}` creates another isolated owner workspace. Treat `enrollment_token` as a secret and give it only to the owner. It expires and can be redeemed once. The public proxy refuses `/v1/operator/`.

Browser login exchanges this token for a revocable HttpOnly, Secure, SameSite=Strict cookie. Unsafe cookie requests must match the configured Origin. Native desktop login uses HTTPS and keeps the device credential in the OS credential store. There is no signup flow. Sign-out revokes the session. Offline caches intentionally retain unsynchronized edits; use a trusted device account and full-disk encryption.

Remote answers require valid existing Anthropic configuration/pricing/budgets **and** explicit permission in Cloud settings. Secrets stay server-side. Without these, results are explicitly keyword-only. Native-library image extraction, semantic indexing and automatic relationship discovery are not yet connected to the existing cloud engine; enabling permission does not make those features available.

## Desktop migration and rollback

The existing library and installer identity are retained. Choose Cloud sync to connect; cloud mode uses the existing SQLite database for its own durable journal. Local mode continues using the original Markdown library. Cloud mode is not a bidirectional filesystem mirror of that old folder.

“Import local library” first requires a full native backup. It preserves supported memories' UUIDs, Markdown basenames/links, original bytes, revisions, origins and deletion tombstones. Import receipts allow safe retry. Conflicted/missing memories and memories with secondary attachments are refused for review. The original library and backup are never deleted. Text and primary-photo imports are supported; secondary attachment migration remains unfinished. Return to Local library for immediate local rollback. Do not edit both representations and expect automatic reconciliation.

Cloud edits are queued atomically with local revisions. Duplicate requests have server receipts. Concurrent server edits retain the local queue and block that memory; incoming refresh cannot overwrite it. Conflicts are exportable but a merge/resolution interface is still needed. Do not treat the current conflict handling as complete production synchronization.

## Backup and recovery

Use the existing `recall.db.backup` utility with PostgreSQL 17 client tools and a private operator `RECALL_BACKUP_DATABASE_URL`. Set the same storage location/configuration as the server. Its inventory now covers both legacy originals and native-library originals, including tombstones. It verifies original hashes and a consistent database snapshot. Runtime API credentials are deliberately insufficient for full administrative backup.

```sh
umask 077
python -m recall.db.backup backup /private/backups/megraph.zip
# Restore only into an independently provisioned EMPTY database and EMPTY object store:
python -m recall.db.backup restore /private/restore/megraph.zip
```

The archive is **not encrypted by this utility**. Keep it on encrypted storage, encrypt it before transfer to the approved off-host destination, protect recovery keys separately, and validate scheduled backups with an isolated restore. Scheduling, off-host retention and Hostinger recovery are not configured until host access is supplied. Never test restoration against the live database. Additive migration 0009 leaves old tables unchanged; rollback by keeping the old local library or restoring to a fresh isolated stack, not by dropping cloud data.

## Reproducible synthetic verification

The development runner needs Vite at 127.0.0.1:1420 and PostgreSQL/pgvector client/server tools on PATH:

```sh
services/backend/.venv/bin/python scripts/verify-cloud-browser.py
```

For the packaged application, start this Compose configuration under **project `megraph-check`**, with disposable credentials/volumes and an override containing `services.web.image: megraph-web:check`. Then:

```sh
python scripts/verify-cloud-compose.py --env-file /private/test.env --override /private/test-override.yml
```

This issues a synthetic owner, exercises the actual HTTP API and production PWA (offline capture/reload/reconnect), checks graph/edit/search/original integrity/mobile accessibility/logout, restarts the isolated database/API/worker, and compares stored revisions/hashes. It must never target a production project. Screenshots and verification metadata go to `test-results/megraph-cloud/`; no credentials are retained. Physical iPhone, installed Windows, live paid AI and physical PC-off acceptance remain separate mandatory tests.
