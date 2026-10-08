"""Prepare ignored placeholder files so Compose can validate its offline configuration."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
examples = root / "examples"
secrets = root / "secrets"
recovery = root / "recovery"
secrets.mkdir(mode=0o700, exist_ok=True)
recovery.mkdir(mode=0o755, exist_ok=True)
os.chmod(recovery, 0o755)  # noqa: S103 -- non-secret directory must be traversable by API UID
copies = {
    "operator_password.example": "operator_password.local",
    "migration_password.example": "migration_password.local",
    "api_password.example": "api_password.local",
    "migration_database_url.example": "migration_database_url.local",
    "operator_database_url.example": "operator_database_url.local",
    "api_database_url.example": "api_database_url.local",
    "activation_record.example": "activation_record.local",
    "ai_api_key.example": "ai_api_key.local",
    "runtime.env.example": "runtime.env.local",
}
for source_name, target_name in copies.items():
    target = secrets / target_name
    if target.exists():
        raise SystemExit("Refusing to replace an existing local secret/config file.")
    shutil.copyfile(examples / source_name, target)
    os.chmod(target, 0o400)
hold = recovery / "hold.json"
if hold.exists():
    raise SystemExit("Refusing to replace an existing external recovery hold.")
shutil.copyfile(examples / "recovery_hold.example", hold)
os.chmod(hold, 0o644)
print(
    "Unapproved example placeholders and an external recovery hold were prepared. They cannot pass runtime preflight."
)
