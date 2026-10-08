# Windows pairing pilot staging worksheet

> **Historical staging worksheet.** The values and activation workflow below describe the earlier paired-origin candidate and do not establish a DigitalOcean service. The current DO-only service profile and operator gates are documented in [do-inference.md](do-inference.md). Existing DigitalOcean ownership, hostname/TLS, and database readiness remain unverified; legacy Supabase ownership remains UNKNOWN. No activation, enrollment, or migration is implied.

This workflow produces a separate, unsigned Windows NSIS staging installer with the compile-time pairing origin fixed to `https://recall.159-203-35-38.sslip.io`. It is triggered by pushes to `implement/owner-device-pairing` that change only this workflow or this guide, or by a maintainer's manual `workflow_dispatch`. The ordinary CI artifact `recall-windows-local-foundation` remains the local-only build. Download `recall-windows-pairing-pilot` for the paired-origin candidate; its provenance file binds the source SHA, origin and unsigned staging status. No certificate or signature is included.

The origin embedded in the installer is only a destination pin. It does not establish that the service is healthy, activate pairing, create an invitation, or grant access. The server pairing feature remains disabled unless its separately reviewed activation settings are present. Do not prepare or install a real-device credential until an installed-device pairing plan has been explicitly approved. QR pairing is not included.

## Staging build

1. Review the workflow run's source SHA and successful desktop typecheck/tests, Rust tests/check, and unsigned installer build.
2. Download and retain both files from `recall-windows-pairing-pilot`. Check that `artifact-provenance.json` identifies the expected SHA and fixed origin. The artifact expires after seven days.
3. Treat this artifact as a compile-path check only. The current host/database/project DNS failure means no service-readiness claim can be made from a successful build or HTTPS certificate.

## Activation worksheet — all unresolved values remain UNKNOWN

Complete each field from owner-controlled records and current service/provider evidence before any separately authorized activation. Do not infer identifiers from a local folder name or from this document.

| Field | Required record / evidence | Current value |
|---|---|---|
| Service hostname and health | Approved HTTPS origin; live API and worker/database checks | `recall.159-203-35-38.sslip.io` is the fixed build origin; health UNKNOWN |
| Historical Supabase owner/workspace | Historical project ownership and identifiers | UNKNOWN; no verified owner identity or workspace is established by this worksheet |
| DigitalOcean inference owner/workspace | Explicit stable owner/workspace UUIDs in a fresh, isolated DO database | Pending; no DO database or owner workspace is provisioned |
| Device ID and vault ID | Read from the installed app's explicit pairing preparation; exact selected vault | UNKNOWN; do not derive from the vault path |
| Vault fingerprint | Fingerprint shown by installed native app after preparing the device credential | UNKNOWN |
| Connection scope | Explicitly approve one selected device/vault, inference-only | Proposed scope; activation approval UNKNOWN |
| Consent wording/version | Review exact selected-photo consent shown before each send | Existing client consent requires review for activation; approved version UNKNOWN |
| Provider account and model | Verify account, model, organization retention terms and enabled capability | UNKNOWN; do not claim zero data retention |
| Pricing and limits | Verify current input/output rates; separately approve and record budget limits | Current Sonnet 5.5 published rates are $2/MTok input and $10/MTok output; approved limits UNKNOWN. No per-call, daily, monthly or lifetime ceiling is approved by this packet. |
| Retention | Confirm service receipt TTL, metadata retention, backups and provider terms | Service normalized result receipt TTL is 24 hours; minimal binding/status/digest/budget tombstones are retained. Provider/org retention UNKNOWN. |
| Monitoring and incident response | Named operator, alert path, log access/retention, compromise and provider-incident steps | UNKNOWN |
| Revocation and recovery | Verify exact-device/vault revocation and lost-credential recovery procedure | Procedure documented in [PAIR-01](README.md); live operational verification UNKNOWN |
| Rollback | Reviewed disablement and recovery steps that preserve pending/unknown receipts | UNKNOWN; no host changes authorized by this staging packet |

Provider information to verify at activation time: [Claude Sonnet 5.5 model and pricing](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) and [Anthropic organization data retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data). Published documentation does not establish the account's actual retention configuration.

## First selected-photo plan

For an eventual first controlled evaluation, name exactly one user-selected photo and require consent before sending. Set no budget amount from this packet: the prior USD 1.50 synthetic diagnostic authorization does not apply to a real-photo evaluation. Budgets remain UNKNOWN until separately approved. Disable automatic retries, fallback providers and background processing. The preferred operator plan is inference-only through the API; verify the worker remains disabled for capture processing. Preserve the original locally and report upload/processing/failure state honestly. Do not use a real photo until service activation, provider account, budget and consent are all verified and separately authorized.

The app labels the relevant actions **Prepare this device for owner approval**, **Connect this device**, **Read this photo with Claude**, **Send this photo to Claude**, and **Correct reading**. Search remains available in the local app. Installed Windows/iPhone behavior, handwriting quality, provider behavior, and live revocation remain untested until exercised on the actual approved devices and service.
