"""Create short-lived synthetic Docker-drill credentials and activation records."""

from __future__ import annotations

import json
import os
import secrets
import uuid
from pathlib import Path
from urllib.parse import quote

root = Path(__file__).resolve().parents[1]
secret_dir = root / "secrets"
recovery_dir = root / "recovery"
secret_dir.mkdir(mode=0o700, exist_ok=True)
recovery_dir.mkdir(mode=0o755, exist_ok=True)
os.chmod(secret_dir, 0o700)
os.chmod(recovery_dir, 0o755)  # noqa: S103 -- non-secret directory must be traversable by API UID
ids = {name: str(uuid.uuid4()) for name in ("owner", "workspace", "device", "vault")}
passwords = {name: secrets.token_urlsafe(32) for name in ("operator", "migration", "api")}
db_host = "db"


def write(name: str, content: str, uid: int | None = None, mode: int = 0o400) -> None:
    path = secret_dir / f"{name}.local"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(content)
        if not content.endswith("\n"):
            stream.write("\n")
    os.chmod(path, mode)
    if os.name == "posix" and os.geteuid() == 0:
        owner = uid if uid is not None else int(os.environ["SUDO_UID"])
        group = uid if uid is not None else int(os.environ["SUDO_GID"])
        os.chown(path, owner, group)


def url(user: str, password: str) -> str:
    return f"postgresql://{user}:{quote(password, safe='')}@{db_host}:5432/recall"


write("operator_password", passwords["operator"], 999)
write("migration_password", passwords["migration"], 999)
write("api_password", passwords["api"], 999)
write("migration_database_url", url("recall_migrator", passwords["migration"]), 10001)
write("api_database_url", url("recall_api", passwords["api"]), 10001)
write("operator_database_url", url("recall_operator", passwords["operator"]), 10001)
write("ci_api_database_url", url("recall_api", passwords["api"]), None)
write("ci_operator_database_url", url("recall_operator", passwords["operator"]), None)
write("ci_migration_database_url", url("recall_migrator", passwords["migration"]), None)
write("ai_api_key", "synthetic-ci-key-not-a-credential", 10001)

origin = "https://synthetic.invalid"
account = "synthetic-provider-workspace"
activation = {
    "record_type": "recall.do-inference.activation.v1",
    "status": "reviewed",
    "review_id": "SYNTHETIC-CI-REVIEW-ONLY",
    "new_production_approval_ref": "SYNTHETIC-CI-NEW-PRODUCTION-APPROVAL-ONLY",
    "reviewed_at": "2026-10-08T00:00:00Z",
    "origin": origin,
    "owner_id": ids["owner"],
    "workspace_id": ids["workspace"],
    "device_id": ids["device"],
    "vault_id": ids["vault"],
    "scope": "inference-only",
    "device_scope": "photo_inference",
    "consent_version": "synthetic-ci-v1",
    "provider_account": account,
    "provider": "anthropic",
    "model_id": "synthetic-ci-model",
    "input_usd_per_mtok": 1,
    "output_usd_per_mtok": 1,
    "daily_budget_usd": 0,
    "monthly_budget_usd": 0,
}
write("activation_record", json.dumps(activation, sort_keys=True), 10001)
clearance = {
    "record_type": "recall.do-inference.recovery-clearance.v1",
    "hold": False,
    "provider_usage_reconciled": True,
    "pending_vault_operations_reconciled": True,
    "previous_grants_revoked": True,
    "fresh_pairing_required": True,
    "cleared_by": "synthetic-ci-only",
    "clearance_ref": "SYNTHETIC-CI-ONLY",
    "cleared_at": "2026-10-08T00:00:00Z",
}
hold_path = recovery_dir / "hold.json"
with hold_path.open("x", encoding="utf-8") as stream:
    stream.write(json.dumps(clearance, sort_keys=True) + "\n")
os.chmod(hold_path, 0o644)
write(
    "runtime.env",
    "\n".join(
        (
            f"RECALL_PUBLIC_ORIGIN={origin}",
            "AI_PROVIDER=anthropic",
            "AI_MODEL_ID=synthetic-ci-model",
            "AI_INPUT_USD_PER_MTOK=1",
            "AI_OUTPUT_USD_PER_MTOK=1",
            "RECALL_AI_DAILY_BUDGET_USD=0",
            "RECALL_AI_MONTHLY_BUDGET_USD=0",
            "AI_EFFORT=low",
            f"ANTHROPIC_CUSTOM_HEADERS=anthropic-workspace-id: {account}",
        )
    ),
    None,
    0o600,
)
print("Synthetic CI-only secret files prepared.")
if os.name == "posix" and os.geteuid() == 0:
    os.chown(secret_dir, int(os.environ["SUDO_UID"]), int(os.environ["SUDO_GID"]))
    os.chown(recovery_dir, int(os.environ["SUDO_UID"]), int(os.environ["SUDO_GID"]))
    os.chown(hold_path, int(os.environ["SUDO_UID"]), int(os.environ["SUDO_GID"]))
