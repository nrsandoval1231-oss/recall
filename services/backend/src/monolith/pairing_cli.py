"""Trusted owner invitation command; run only on the operator's secured server host."""

from __future__ import annotations

import argparse
import sys
import uuid

import psycopg

from .envcompat import getenv
from .ingestion.local_intelligence import (
    create_intelligence_invitation,
    revoke_lost_intelligence_device,
    set_ask_consent,
)
from .pairing import create_invitation, revoke_lost_device


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-id", type=uuid.UUID)
    parser.add_argument("--workspace-id", type=uuid.UUID)
    parser.add_argument("--device-id", type=uuid.UUID)
    parser.add_argument("--vault-id", type=uuid.UUID)
    parser.add_argument("--fingerprint", help="64-character fingerprint shown by the paired device")
    parser.add_argument("--scope", choices=("photo_inference", "vault_intelligence"), default="photo_inference")
    parser.add_argument(
        "--revoke-lost-device", action="store_true", help="revoke all inference grants for this exact device and vault"
    )
    parser.add_argument("--ask-consent", choices=("enable", "revoke"), help="owner-set the separate local Ask consent")
    parser.add_argument("--policy-version", help="exact configured provider policy version for Ask consent")
    parser.add_argument("--approve", action="store_true", help="confirm owner-approved inference-only pairing")
    args = parser.parse_args()
    dsn = getenv("MONOLITH_MIGRATION_DATABASE_URL")
    if not dsn:
        print("MONOLITH_MIGRATION_DATABASE_URL (owner role) is required", file=sys.stderr)
        return 2
    if not args.approve:
        print(
            "No pairing change made. Re-run with --approve after confirming owner, workspace, device and vault.",
            file=sys.stderr,
        )
        return 2
    if args.ask_consent and (args.scope != "vault_intelligence" or args.revoke_lost_device):
        parser.error("--ask-consent requires --scope vault_intelligence and cannot be combined with device revocation")
    if args.ask_consent:
        if not args.owner_id or not args.workspace_id or not args.policy_version:
            parser.error("Ask consent requires --owner-id, --workspace-id and --policy-version")
    elif not args.owner_id or not args.workspace_id or not args.device_id or not args.vault_id:
        parser.error("device pairing requires --owner-id, --workspace-id, --device-id and --vault-id")
    if not args.revoke_lost_device and not args.ask_consent and args.fingerprint is None:
        print("An invitation requires the device fingerprint.", file=sys.stderr)
        return 2
    try:
        revoked = False
        with psycopg.connect(dsn) as conn:
            if args.ask_consent:
                set_ask_consent(
                    conn,
                    user_id=args.owner_id,
                    workspace_id=args.workspace_id,
                    enabled=args.ask_consent == "enable",
                    policy_version=args.policy_version,
                )
            elif args.revoke_lost_device and args.scope == "vault_intelligence":
                revoked = revoke_lost_intelligence_device(
                    conn,
                    user_id=args.owner_id,
                    workspace_id=args.workspace_id,
                    device_id=args.device_id,
                    vault_id=args.vault_id,
                )
            elif args.revoke_lost_device:
                revoked = revoke_lost_device(
                    conn,
                    user_id=args.owner_id,
                    workspace_id=args.workspace_id,
                    device_id=args.device_id,
                    vault_id=args.vault_id,
                )
            else:
                create = create_intelligence_invitation if args.scope == "vault_intelligence" else create_invitation
                invitation, expires = create(
                    conn,
                    user_id=args.owner_id,
                    workspace_id=args.workspace_id,
                    device_id=args.device_id,
                    vault_id=args.vault_id,
                    fingerprint=args.fingerprint,
                )
    except (ValueError, psycopg.Error):
        print(
            "Pairing operation failed; verify owner, workspace binding, database readiness and pairing inputs.",
            file=sys.stderr,
        )
        return 1
    if args.ask_consent:
        print(
            "Separate local Ask consent enabled."
            if args.ask_consent == "enable"
            else "Separate local Ask consent revoked."
        )
        return 0
    if args.revoke_lost_device:
        print(
            "Inference grants revoked for the selected device and vault."
            if revoked
            else "No existing inference grant matched the selected device and vault."
        )
        return 0
    print(f"Invitation ID: {invitation}")
    print(f"Expires UTC: {expires.isoformat()}")
    print(f"Scope: {args.scope}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
