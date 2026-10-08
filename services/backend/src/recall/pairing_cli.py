"""Trusted owner invitation command; run only on the operator's secured server host."""

from __future__ import annotations

import argparse
import os
import sys
import uuid

import psycopg

from .pairing import create_invitation, revoke_lost_device


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-id", required=True, type=uuid.UUID)
    parser.add_argument("--workspace-id", required=True, type=uuid.UUID)
    parser.add_argument("--device-id", required=True, type=uuid.UUID)
    parser.add_argument("--vault-id", required=True, type=uuid.UUID)
    parser.add_argument("--fingerprint", help="64-character fingerprint shown by the paired device")
    parser.add_argument(
        "--revoke-lost-device", action="store_true", help="revoke all inference grants for this exact device and vault"
    )
    parser.add_argument("--approve", action="store_true", help="confirm owner-approved inference-only pairing")
    args = parser.parse_args()
    dsn = os.environ.get("RECALL_MIGRATION_DATABASE_URL")
    if not dsn:
        print("RECALL_MIGRATION_DATABASE_URL (owner role) is required", file=sys.stderr)
        return 2
    if not args.approve:
        print(
            "No pairing change made. Re-run with --approve after confirming owner, workspace, device and vault.",
            file=sys.stderr,
        )
        return 2
    if not args.revoke_lost_device and args.fingerprint is None:
        print("An invitation requires the device fingerprint.", file=sys.stderr)
        return 2
    try:
        revoked = False
        with psycopg.connect(dsn) as conn:
            if args.revoke_lost_device:
                revoked = revoke_lost_device(
                    conn,
                    user_id=args.owner_id,
                    workspace_id=args.workspace_id,
                    device_id=args.device_id,
                    vault_id=args.vault_id,
                )
            else:
                invitation, expires = create_invitation(
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
    if args.revoke_lost_device:
        print(
            "Inference grants revoked for the selected device and vault."
            if revoked
            else "No existing inference grant matched the selected device and vault."
        )
        return 0
    print(f"Invitation ID: {invitation}")
    print(f"Expires UTC: {expires.isoformat()}")
    print("Scope: photo_inference")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
