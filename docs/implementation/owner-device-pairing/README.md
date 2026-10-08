# Owner-approved photo inference pairing

PAIR-01 connects one selected vault to one existing owner/workspace for Claude photo inference. It does not add account sign-in, public enrollment, capture access, Ask, sync, or vault access. Local capture, annotation, evidence and keyword search remain available without connection.

The desktop generates a device UUID and 32-byte random secret, writes pending material to the OS keyring before showing a SHA-256 fingerprint, device ID and vault ID. The renderer never receives the secret or service origin. A trusted operator uses the owner-only RECALL_MIGRATION_DATABASE_URL command below to create a single-use invitation bound to that fingerprint, exact vault/device IDs and an existing workspace owner. Claim sends the pending secret over the compile-time fixed HTTPS origin; the API hashes it, consumes the invitation in one transaction and stores only the hash in a revocable grant. Native verifies authenticated status and exact device/vault/inference scope before storing the reading connection.

```powershell
# On the secured service/operator host, after receiving device ID, vault ID and fingerprint:
$env:RECALL_MIGRATION_DATABASE_URL = '<owner-only database DSN>'
python -m recall.pairing_cli --owner-id <existing-owner-uuid> --workspace-id <existing-workspace-uuid> --device-id <device-uuid> --vault-id <vault-uuid> --fingerprint <64-hex-fingerprint> --approve
```

If the secret is lost, the owner can revoke all inference grants for that exact device/vault before approving a newly prepared device:

```powershell
python -m recall.pairing_cli --owner-id <existing-owner-uuid> --workspace-id <existing-workspace-uuid> --device-id <lost-device-uuid> --vault-id <vault-uuid> --revoke-lost-device --approve
```

The server feature flag RECALL_DEVICE_PAIRING_ENABLED defaults to false. A pairing-enabled server build also requires the reviewed fixed HTTPS RECALL_PAIRING_ORIGIN at native compile time. Activation is a separate new production-owner approval and is not done by this packet; the existing USD 5 synthetic evaluation authorization does not authorize production activation or spending. The deployment preflight rejects populated provider settings or enabled pairing unless the private `infra/pilot.activation.reviewed.env` record is complete and the API/worker provider, model, prices and daily/monthly budgets exactly match that record. Before pilot activation, the owner must approve the exact service origin, selected workspace and existing owner, target device/vault, inference-only scope, consent text, provider account, budget/pricing limits, credential/revocation operations, retention, monitoring and incident response. The record is an operator consistency check, not cryptographic proof of approval; the daily/monthly runtime budgets are not a lifetime spend or request-count cap. AI remains governed by existing explicit consent and budget settings.

Claim, status and disconnect are recoverable. Lost claim responses are resolved by authenticated status using the pending secret. Revocation is checked on every photo request; disconnect revokes server-side before native removes keyring values. If the network or keyring result is uncertain, the UI reports unknown and retains recovery material. A revoked grant cannot be reactivated; missing local secret requires a newly approved device invitation. The owner-only lost-device command revokes by exact existing owner/workspace/device/vault identity. Workspace erasure revokes all workspace device grants. Pending material records its original HTTPS service origin, so a later build cannot send that secret to a changed host.

No real invitation, enrollment, provider call, private photo, spend, server activation, deployment or merge is part of the implementation evidence. See security and operations for the preflight boundary.
