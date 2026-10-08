# Infrastructure boundary

Pilot provisioning began on 2026-10-06 with owner authorization: existing Supabase project `jjlkcligwhoxcbthkmov` and dedicated DigitalOcean `recall-pilot` (ID `606826157`, Toronto, Ubuntu 24.04, 2 vCPU / 4 GiB / 80 GiB, listed $24/month). The host bills until deleted. Approved limits are $25/month hosting and $5 total first AI evaluation; these do not authorize a Supabase plan upgrade or ongoing AI spending.

Proposed pilot: managed Supabase Postgres/Auth/private Storage plus one API deployment and one durable worker process from the same backend package. Choose a compatible host when the owner authorizes deployment. Do not add a service mesh, Redis, a graph database, or another vector service by default.

Application schema migrations live under `services/backend/migrations`. This directory will own repeatable deployment configuration, secrets references (not values), backup/object-preservation configuration, and operational checks.

Provider plans, regions, pricing, retention, signing, and spend limits are deployment gates. The development database may be local; the deployed canonical database must not depend on Paul's PC.

## Owner-provisioned HTTPS pilot

This remains an owner-provisioned deployment; merely running the repository does not create paid infrastructure. Use a small Linux host with Docker Engine and the Compose plugin, a DNS A/AAAA record for the chosen hostname, and inbound TCP 80/443 (UDP 443 is optional for HTTP/3). Keep the host firewall and provider access restricted to the pilot owner. The initial pilot hostname is `recall.159-203-35-38.sslip.io`; it relies on external shared DNS and is replaceable with an owner-controlled domain.

Install Docker Engine and the Compose plugin on the host using Docker's official instructions for its Linux distribution, then verify the installation:

```sh
docker version
docker compose version
sudo systemctl enable --now docker
```

Give the pilot operator access to the Docker group only after reviewing the host's access policy; log out and back in after `sudo usermod -aG docker "$USER"` if that is the chosen setup.

From this directory on the production host:

```sh
cp api.env.example api.env
cp worker.env.example worker.env
cp pilot.https.env.example pilot.https.env
# Fill only the reviewed values in the three ignored files.
# Keep AI keys/model and pairing disabled by default; do not create the activation record yet.
sh check-pilot-secrets.sh
docker compose -f pilot.compose.yml -f pilot.https.compose.yml config --quiet
docker compose -f pilot.compose.yml -f pilot.https.compose.yml up --build -d
docker compose -f pilot.compose.yml -f pilot.https.compose.yml ps
```

The base API remains available only on `127.0.0.1:8000`; Caddy reaches it over the private Compose network at `api:8000` and terminates HTTPS for `RECALL_PILOT_HOSTNAME`. Caddy request access logging is intentionally absent, and the API image already runs Uvicorn with `--no-access-log`. Caddy certificate state is kept in its named volumes so renewals survive container replacement.

The overlay enables [Docker IPv6 networking](https://docs.docker.com/engine/daemon/ipv6/) because the Supabase direct database endpoint resolves to IPv6. The host also needs a working IPv6 address/default route. Caddy 2.11.7 is pinned to the registry digest verified during provisioning. Verify container-to-database connectivity separately from host connectivity. Disabled public signups, private bucket readiness, authenticated client access and a restore drill remain deployment acceptance checks.

Before launch, verify that the API and worker database URLs use the reviewed non-owner, non-BYPASSRLS roles, that `RECALL_SIGNING_SECRET` and storage credentials are populated, and that the hostname resolves to the host. The normal preflight accepts AI/pairing-disabled configuration only. It rejects any populated AI key/model/price or enabled pairing unless `pilot.activation.reviewed.env` is present and complete. This record requires a new, explicit production-owner approval, independent of the separate USD 5 synthetic evaluation authorization. It records the exact existing owner, workspace, device and vault; consent version; provider account, model and prices; daily/monthly runtime budgets; `inference-only` scope; and pairing HTTPS origin equal to `https://RECALL_PILOT_HOSTNAME`. The recorded model, prices and budgets must exactly match API/worker settings. These daily/monthly runtime budgets are not a lifetime spend or request-count cap; the preflight does not claim such a cap. Embedding activation remains outside this pilot.

An owner may create the private record only after a separate new production-activation approval and recording its reference in the operator's change record. Start from `pilot.activation.reviewed.env.example`, copy it to the ignored `pilot.activation.reviewed.env`, and fill it together with the reviewed API/worker AI settings and `RECALL_DEVICE_PAIRING_ENABLED=true`; then run the preflight again. The file is a consistency gate, not cryptographic proof of approval, and the shell check does not enable the runtime by itself. No activation record or provider credential is included in this repository. This packet creates no such record, enables no setting, and authorizes no real invitation, provider request or spend. Never copy synthetic test values from `services/backend/tests/test_pilot_preflight.py` into a deployment.

To stop the pilot without deleting its certificate state:

```sh
docker compose -f pilot.compose.yml -f pilot.https.compose.yml down
```
