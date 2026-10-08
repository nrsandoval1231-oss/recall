"""Synthetic runtime/receipt proof against the PostgreSQL container started by DO-OPS CI."""

from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
import uuid
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from conftest import sha, synthetic_image
from fake_provider import FakeProvider, faithful_extraction
from recall.api.inference import create_inference_app
from recall.config import Settings
from recall.db.database import Database
from recall.db.inference_bootstrap import bootstrap_owner
from recall.pairing import create_invitation, digest


@pytest.mark.skipif(shutil.which("docker") is None, reason="requires Docker Compose CLI for offline config resolution")
def test_do_ops_compose_resolves_tmpfs_as_single_mount() -> None:
    root = Path(__file__).resolve().parents[3] / "infra" / "do-inference"
    resolved = subprocess.run(
        [
            "docker",
            "compose",
            "-p",
            "recall-do-inference-test",
            "-f",
            "compose.yml",
            "--profile",
            "maintenance",
            "--profile",
            "runtime",
            "config",
            "--format",
            "json",
        ],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )
    assert resolved.returncode == 0, resolved.stderr
    services = json.loads(resolved.stdout)["services"]
    for name in ("migrate", "bootstrap", "api"):
        assert services[name]["tmpfs"] == ["/tmp:size=32m,mode=1777"]


def test_ci_negative_activation_mutation_preserves_container_secret_ownership() -> None:
    workflow = (Path(__file__).resolve().parents[3] / ".github" / "workflows" / "do-inference-ops.yml").read_text(
        encoding="utf-8"
    )
    assert 'sudo cp -- secrets/activation_record.local "$original_activation"' in workflow
    assert 'sudo chown "$(id -u):$(id -g)" "$original_activation"' in workflow
    assert 'chmod 600 "$candidate_activation"' in workflow
    assert 'ACTIVATION_CANDIDATE="$candidate_activation" python3' in workflow
    assert workflow.count("sudo install -o 10001 -g 10001 -m 0400") >= 2
    assert 'Path("secrets/activation_record.local")' not in workflow


def test_ci_activation_candidate_becomes_runner_writable_before_mutation(tmp_path) -> None:
    original = tmp_path / "activation-record-original.json"
    candidate = tmp_path / "activation-record-candidate.json"
    original.write_text('{"review_id":"synthetic"}', encoding="utf-8")
    os.chmod(original, 0o400)
    shutil.copyfile(original, candidate)
    os.chmod(candidate, 0o600)
    record = json.loads(candidate.read_text(encoding="utf-8"))
    record.pop("review_id")
    candidate.write_text(json.dumps(record), encoding="utf-8")
    assert json.loads(candidate.read_text(encoding="utf-8")) == {}
    assert json.loads(original.read_text(encoding="utf-8")) == {"review_id": "synthetic"}


def test_ci_preflight_negatives_use_supported_compose_run_and_prove_refusal_marker() -> None:
    workflow = (Path(__file__).resolve().parents[3] / ".github" / "workflows" / "do-inference-ops.yml").read_text(
        encoding="utf-8"
    )
    command = "--entrypoint python api /ops/preflight.py"
    marker = "Inference preflight failed; verify the private activation, role, and recovery records."
    assert command in workflow
    assert "--no-ports" not in workflow
    assert workflow.count("run_preflight") >= 8  # clean before mutations and after each restoration
    assert f"grep -Fqx '{marker}'" in workflow
    assert "runtime_env uid=%u gid=%g mode=%a" in workflow
    assert "10001:10001:400" in workflow
    assert "$(id -u):$(id -g):600" in workflow
    restored_transitions = (
        'sudo install -o 10001 -g 10001 -m 0400 "$original_activation" secrets/activation_record.local\n          run_preflight',
        'cp "$RUNNER_TEMP/runtime.env" secrets/runtime.env.local\n          run_preflight\n          sed -i \'s/^AI_MODEL_ID=',
        'cp "$RUNNER_TEMP/runtime.env" secrets/runtime.env.local\n          run_preflight\n          sed -i \'s/^ANTHROPIC_CUSTOM_HEADERS=',
        'cp "$RUNNER_TEMP/runtime.env" secrets/runtime.env.local\n          run_preflight\n          docker compose -p "$RECALL_CI_PROJECT" -f compose.yml exec -T db psql',
        "-c 'REVOKE pg_read_all_data FROM recall_api'\n          run_preflight",
        "WHERE version='0001_trusted_capture.sql'\"\n          run_preflight",
    )
    assert all(transition in workflow for transition in restored_transitions)


def test_ci_restore_sentinel_uses_stdin_sql_for_literal_and_checks_it_before_restore() -> None:
    workflow = (Path(__file__).resolve().parents[3] / ".github" / "workflows" / "do-inference-ops.yml").read_text(
        encoding="utf-8"
    )
    setup = "psql -U recall_operator -d recall_restore -v ON_ERROR_STOP=1 <<'SQL'"
    literal = "INSERT INTO restore_refusal_sentinel VALUES ('preserved');"
    verification = 'psql -U recall_operator -d recall_restore -tAc "SELECT value FROM restore_refusal_sentinel"'
    assert setup in workflow and literal in workflow
    assert "VALUES (''preserved'')" not in workflow
    refusal = workflow.index("if uv run --project ../../services/backend python ops/restore.py; then exit 1; fi", workflow.index(literal))
    assert workflow.index(literal) < refusal < workflow.index(verification)


def test_ci_restore_records_and_pins_postgres_16_clients_before_backup() -> None:
    workflow = (Path(__file__).resolve().parents[3] / ".github" / "workflows" / "do-inference-ops.yml").read_text(
        encoding="utf-8"
    )
    original = 'original_pg_dump_version="$(pg_dump --version)"'
    pinned_path = 'export PATH="$AGE_BIN:/usr/lib/postgresql/16/bin:$PATH"'
    selected = 'selected_pg_dump_version="$(pg_dump --version)"'
    backup = "uv run --project ../../services/backend python ops/backup.py"
    assert workflow.index(original) < workflow.index(pinned_path) < workflow.index(selected) < workflow.index(backup)
    assert "original_pg_restore_version" in workflow
    assert "restore_server_version_num" in workflow
    assert "'pg_dump (PostgreSQL) 16.'*" in workflow
    assert "'pg_restore (PostgreSQL) 16.'*" in workflow
    assert "16[0-9][0-9][0-9][0-9]" in workflow


def test_ci_secret_writers_keep_protected_files_final_mode_and_runtime_runner_writable() -> None:
    root = Path(__file__).resolve().parents[3] / "infra" / "do-inference" / "ops"
    prepare = (root / "prepare-ci.py").read_text(encoding="utf-8")
    connections = (root / "write-ci-connections.py").read_text(encoding="utf-8")
    assert "mode: int = 0o400" in prepare
    assert '"runtime.env"' in prepare and "0o600" in prepare
    assert "def replace_runner_file" in connections
    assert "os.O_EXCL, 0o600" in connections
    assert "os.chmod(temporary, 0o400)" in connections
    assert "os.replace(temporary, path)" in connections


def test_ci_connection_replacement_is_atomic_and_leaves_final_file_protected(tmp_path) -> None:
    path = Path(__file__).resolve().parents[3] / "infra" / "do-inference" / "ops" / "write-ci-connections.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    helper = next(
        node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "replace_runner_file"
    )
    namespace = {"os": os, "Path": Path}
    exec(compile(ast.Module(body=[helper], type_ignores=[]), str(path), "exec"), namespace)
    target = tmp_path / "ci_api_database_url.local"
    target.write_text("old\n", encoding="utf-8")
    namespace["replace_runner_file"](target, "new\n")  # type: ignore[operator]
    assert target.read_text(encoding="utf-8") == "new\n"
    if os.name == "posix":
        assert target.stat().st_mode & 0o777 == 0o400
    assert not (tmp_path / ".ci_api_database_url.local.tmp").exists()


def _restore_module():  # type: ignore[no-untyped-def]
    path = Path(__file__).resolve().parents[3] / "infra" / "do-inference" / "ops" / "restore.py"
    spec = spec_from_file_location("do_ops_restore", path)
    assert spec and spec.loader
    module = module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)
    return module


def test_audit_dict_rows_use_named_membership_aliases() -> None:
    path = Path(__file__).resolve().parents[3] / "infra" / "do-inference" / "ops" / "audit-database.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    helpers = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in {"api_inherits_app", "api_memberships"}
    ]
    assert {helper.name for helper in helpers} == {"api_inherits_app", "api_memberships"}
    namespace: dict[str, object] = {}
    exec(compile(ast.Module(body=helpers, type_ignores=[]), str(path), "exec"), namespace)

    class DictRowConnection:
        def execute(self, statement: str):  # type: ignore[no-untyped-def]
            if "pg_has_role" in statement:
                return type("Result", (), {"fetchone": lambda self: {"is_app_member": True}})()
            return iter(({"parent_role": "recall_app"},))

    connection = DictRowConnection()
    assert namespace["api_inherits_app"](connection) is True  # type: ignore[operator]
    assert namespace["api_memberships"](connection) == {"recall_app"}  # type: ignore[operator]


def test_preflight_dict_rows_use_named_membership_aliases() -> None:
    path = Path(__file__).resolve().parents[3] / "infra" / "do-inference" / "ops" / "preflight.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "api_memberships")
    namespace: dict[str, object] = {}
    exec(compile(ast.Module(body=[helper], type_ignores=[]), str(path), "exec"), namespace)

    class DictRowConnection:
        def execute(self, statement: str):  # type: ignore[no-untyped-def]
            assert "as parent_role" in statement
            return iter(({"parent_role": "recall_app"},))

    assert namespace["api_memberships"](DictRowConnection()) == {"recall_app"}  # type: ignore[operator]


def test_restore_verifier_passes_target_connection_mapping_as_keywords() -> None:
    path = Path(__file__).resolve().parents[3] / "infra" / "do-inference" / "ops" / "verify-ci-restore.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    mapping_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "psycopg"
        and node.func.attr == "connect"
        and any(isinstance(argument, ast.Name) and argument.id == "restored_operator" for argument in node.args + [keyword.value for keyword in node.keywords])
    ]
    assert len(mapping_calls) == 2
    for call in mapping_calls:
        assert not call.args
        assert len(call.keywords) == 1
        assert call.keywords[0].arg is None
        assert isinstance(call.keywords[0].value, ast.Name) and call.keywords[0].value.id == "restored_operator"


def test_restore_checksum_refusal_sets_external_hold(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    archive = tmp_path / "backup.age"
    archive.write_bytes(b"corrupted-synthetic-backup")
    archive.with_name(archive.name + ".sha256").write_text("0" * 64 + f"  {archive.name}\n", encoding="utf-8")
    dsn = tmp_path / "unused-dsn"
    dsn.write_text("postgresql://invalid", encoding="utf-8")
    hold = tmp_path / "hold.json"
    hold.write_text(
        json.dumps(
            {
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
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("RECALL_RESTORE_ARCHIVE", str(archive))
    monkeypatch.setenv("RECALL_RESTORE_AGE_IDENTITY_FILE", str(tmp_path / "unused-key"))
    monkeypatch.setenv("RECALL_RESTORE_DATABASE_URL_FILE", str(dsn))
    monkeypatch.setenv("RECALL_RESTORE_HOLD_PATH", str(hold))
    with pytest.raises(SystemExit, match="checksum mismatch"):
        _restore_module().main()
    assert json.loads(hold.read_text(encoding="utf-8"))["hold"] is True


@pytest.mark.skipif(os.name != "posix", reason="directory fsync is a Linux recovery guarantee")
def test_restore_hold_fsyncs_parent_after_atomic_replace(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    module = _restore_module()
    hold = tmp_path / "hold.json"
    hold.write_text('{"record_type":"recall.do-inference.recovery-clearance.v1"}', encoding="utf-8")
    events: list[str] = []
    original_replace, original_fsync = module.os.replace, module.os.fsync

    def record_replace(source, target):  # type: ignore[no-untyped-def]
        events.append("replace")
        return original_replace(source, target)

    def record_fsync(descriptor: int) -> None:
        events.append("fsync")
        original_fsync(descriptor)

    monkeypatch.setattr(module.os, "replace", record_replace)
    monkeypatch.setattr(module.os, "fsync", record_fsync)
    module.set_hold(hold)
    assert events[-1] == "fsync"
    assert events.index("replace") < len(events) - 1


@pytest.mark.parametrize(
    ("stderr", "expected"),
    (
        (b"pg_restore: error: --single-transaction requires a database", "PG_RESTORE_DATABASE_TARGET_NOT_SELECTED"),
        (b"pg_restore: error: unsupported version (1.15) in file header", "PG_RESTORE_ARCHIVE_VERSION_UNSUPPORTED"),
        (b"ERROR: unrecognized configuration parameter \"transaction_timeout\"", "PG_RESTORE_UNSUPPORTED_PARAMETER"),
        (b"ERROR: role \"recall_migrator\" does not exist", "PG_RESTORE_ROLE_MISSING"),
        (b"ERROR: permission denied for schema public", "PG_RESTORE_PERMISSION_DENIED"),
        (b"ERROR: extension \"vector\" already exists", "PG_RESTORE_EXTENSION_CONFLICT"),
        (b"pg_restore: error: connection to server failed", "PG_RESTORE_CONNECTION_FAILED"),
        (b"private detail must not escape", "PG_RESTORE_FAILED"),
    ),
)
def test_restore_pg_failure_classifier_returns_only_fixed_codes(stderr: bytes, expected: str) -> None:
    module = _restore_module()
    code = module.pg_restore_failure_code(stderr)
    assert code == expected
    assert "private detail" not in f"pg_restore failed ({code}); recovery hold remains active."


def test_restore_pg_command_targets_validated_database_without_destructive_flags(tmp_path) -> None:  # type: ignore[no-untyped-def]
    module = _restore_module()
    dump = tmp_path / "database.dump"
    command = module.pg_restore_command("pg_restore", dump, "recall_restore")
    assert command == ["pg_restore", "--dbname", "recall_restore", "--exit-on-error", "--single-transaction", str(dump)]
    assert "--clean" not in command and "--create" not in command
    environment = module.pg_environment("postgresql://recall_operator:synthetic@restore-host:5432/recall_restore")
    assert environment["PGHOST"] == "restore-host" and environment["PGDATABASE"] == "recall_restore"
    assert environment["PGUSER"] == "recall_operator" and "PGPASSWORD" in environment


def test_runtime_preflight_rejects_unapproved_example_without_echoing_settings(tmp_path) -> None:  # type: ignore[no-untyped-def]
    ops = Path(__file__).resolve().parents[3] / "infra" / "do-inference" / "ops"
    activation = tmp_path / "activation.json"
    hold = tmp_path / "hold.json"
    dsn = tmp_path / "api-dsn.local"
    key = tmp_path / "key.local"
    activation.write_text(
        json.dumps({"record_type": "recall.do-inference.activation.v1", "status": "unapproved-example"}),
        encoding="utf-8",
    )
    hold.write_text("{}", encoding="utf-8")
    dsn.write_text("postgresql://recall_api:synthetic-marker@db/recall", encoding="utf-8")
    key.write_text("synthetic-provider-key-marker", encoding="utf-8")
    environment = {
        "RECALL_ACTIVATION_RECORD_FILE": str(activation),
        "RECALL_RECOVERY_HOLD_FILE": str(hold),
        "RECALL_API_DATABASE_URL_FILE": str(dsn),
        "RECALL_AI_API_KEY_FILE": str(key),
    }
    result = subprocess.run(
        [sys.executable, str(ops / "preflight.py")],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    assert result.returncode != 0
    assert "preflight failed" in result.stderr.lower()
    assert "synthetic-marker" not in result.stdout + result.stderr
    assert "provider-key-marker" not in result.stdout + result.stderr


@pytest.mark.parametrize(
    "failure", ["missing-new-approval", "budget-mismatch", "wrong-workspace-header", "recovery-hold"]
)
def test_runtime_preflight_rejects_production_gate_mismatches_before_database_access(tmp_path, failure: str) -> None:  # type: ignore[no-untyped-def]
    ops = Path(__file__).resolve().parents[3] / "infra" / "do-inference" / "ops"
    activation = {
        "record_type": "recall.do-inference.activation.v1",
        "status": "reviewed",
        "review_id": "SYNTHETIC-CI-REVIEW-ONLY",
        "new_production_approval_ref": "SYNTHETIC-CI-NEW-PRODUCTION-APPROVAL-ONLY",
        "reviewed_at": "2026-10-08T00:00:00Z",
        "origin": "https://synthetic.invalid",
        "owner_id": str(uuid.uuid4()),
        "workspace_id": str(uuid.uuid4()),
        "device_id": str(uuid.uuid4()),
        "vault_id": str(uuid.uuid4()),
        "scope": "inference-only",
        "device_scope": "photo_inference",
        "consent_version": "synthetic-ci-v1",
        "provider_account": "synthetic-provider-workspace",
        "provider": "anthropic",
        "model_id": "synthetic-ci-model",
        "input_usd_per_mtok": 1,
        "output_usd_per_mtok": 1,
        "daily_budget_usd": 0,
        "monthly_budget_usd": 0,
    }
    hold = {
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
    if failure == "missing-new-approval":
        activation.pop("new_production_approval_ref")
    elif failure == "budget-mismatch":
        activation["daily_budget_usd"] = 100
    elif failure == "recovery-hold":
        hold["hold"] = True
    activation_path, hold_path = tmp_path / "activation.json", tmp_path / "hold.json"
    activation_path.write_text(json.dumps(activation), encoding="utf-8")
    hold_path.write_text(json.dumps(hold), encoding="utf-8")
    dsn, key = tmp_path / "api-dsn.local", tmp_path / "key.local"
    dsn.write_text("postgresql://recall_api:synthetic-marker@127.0.0.1:1/recall", encoding="utf-8")
    key.write_text("synthetic-provider-key-marker", encoding="utf-8")
    env = {
        "RECALL_ACTIVATION_RECORD_FILE": str(activation_path),
        "RECALL_RECOVERY_HOLD_FILE": str(hold_path),
        "RECALL_API_DATABASE_URL_FILE": str(dsn),
        "RECALL_AI_API_KEY_FILE": str(key),
        "RECALL_PUBLIC_ORIGIN": "https://synthetic.invalid",
        "RECALL_SERVICE_PROFILE": "inference",
        "RECALL_AUTO_PROVISION_WORKSPACES": "false",
        "RECALL_DEVICE_PAIRING_ENABLED": "true",
        "AI_PROVIDER": "anthropic",
        "AI_MODEL_ID": "synthetic-ci-model",
        "AI_INPUT_USD_PER_MTOK": "1",
        "AI_OUTPUT_USD_PER_MTOK": "1",
        "RECALL_AI_DAILY_BUDGET_USD": "0",
        "RECALL_AI_MONTHLY_BUDGET_USD": "0",
        "ANTHROPIC_CUSTOM_HEADERS": "anthropic-workspace-id: wrong-synthetic-workspace",
    }
    if failure != "wrong-workspace-header":
        env.pop("ANTHROPIC_CUSTOM_HEADERS")
    result = subprocess.run(
        [sys.executable, str(ops / "preflight.py")],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    assert result.returncode != 0
    assert "preflight failed" in result.stderr.lower()
    assert "synthetic-marker" not in result.stdout + result.stderr
    assert "provider-key-marker" not in result.stdout + result.stderr


@pytest.mark.skipif(
    not os.environ.get("DO_OPS_TEST_CONNECTION_FILE"), reason="requires the isolated DO-OPS Docker database"
)
def test_synthetic_inference_receipt_survives_restart_and_revoke() -> None:
    connection_file = os.environ["DO_OPS_TEST_CONNECTION_FILE"]
    with open(connection_file, encoding="utf-8") as source:
        connections = json.load(source)
    admin_dsn = connections["operator"]
    app_dsn = connections["api"]
    owner_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    assert bootstrap_owner(admin_dsn, owner_id, workspace_id, name="Synthetic DO-OPS workspace")
    device_id, vault_id = uuid.uuid4(), uuid.uuid4()
    bearer = "d" * 64
    with psycopg.connect(admin_dsn) as conn:
        invitation, _ = create_invitation(
            conn,
            user_id=owner_id,
            workspace_id=workspace_id,
            device_id=device_id,
            vault_id=vault_id,
            fingerprint=digest(bearer),
        )

    settings = Settings(
        service_profile="inference",
        database_url=app_dsn,
        auto_provision_workspaces=False,
        device_pairing_enabled=True,
        ai_provider="anthropic",
        # FakeProvider reports this fixed model id; runtime preflight continues to use synthetic-ci-model.
        ai_model_id="fake-model",
        ai_api_key="synthetic-ci-key-not-a-credential",
        ai_input_usd_per_mtok=1,
        ai_output_usd_per_mtok=1,
        # The deployed synthetic runtime remains zero-budget. This host-side fake-provider
        # receipt test alone needs one bounded positive reservation to exercise recovery.
        ai_daily_budget_usd=1,
        ai_monthly_budget_usd=1,
    )
    app_db = Database(app_dsn)
    app_db.open()
    with app_db.tx(owner_id) as tx:
        tx.run(
            "insert into ai_consents(workspace_id,enabled,policy_version,decided_by,provider) "
            "values(%s,true,%s,%s,'anthropic')",
            (workspace_id, settings.ai_policy_version, owner_id),
        )
    original = synthetic_image()
    binding = {
        "schema_version": "1.0",
        "operation_id": str(uuid.uuid4()),
        "vault_id": str(vault_id),
        "memory_id": str(uuid.uuid4()),
        "source_id": str(uuid.uuid4()),
        "source_sha256": sha(original),
        "expected_revision": 1,
        "captured_at": "2026-10-08T12:00:00Z",
    }
    headers = {"authorization": f"Bearer {bearer}"}
    photo_headers = {**headers, "content-type": "image/jpeg", "x-recall-reading": json.dumps(binding)}
    provider = FakeProvider()
    provider.interpret_script = [lambda request: json.dumps(faithful_extraction(request, ["Synthetic CI note"]))]
    app = create_inference_app(settings, database=app_db, provider=provider)
    with TestClient(app) as client:
        assert client.post(f"/v1/device-pairings/{invitation}/claim", json={"secret": bearer}).status_code == 200
        first = client.post("/v1/local-readings", content=original, headers=photo_headers)
        assert first.status_code == 200, json.dumps(first.json(), sort_keys=True)
        assert first.json()["state"] == "complete", json.dumps(first.json(), sort_keys=True)
        receipt = client.get(f"/v1/local-readings/{binding['operation_id']}", headers=headers)
        assert receipt.json() == first.json()
    app_db.close()

    # A fresh app/pool process can recover the same receipt and must not call the provider again.
    restarted_db = Database(app_dsn)
    restarted_db.open()
    restart_provider = FakeProvider()
    restarted = create_inference_app(settings, database=restarted_db, provider=restart_provider)
    with TestClient(restarted) as client:
        replay = client.post("/v1/local-readings", content=original, headers=photo_headers)
        assert replay.status_code == 200 and replay.json() == first.json()
        assert not restart_provider.interpret_calls
        revoked = client.delete("/v1/device-pairings", headers=headers)
        assert revoked.status_code == 200 and revoked.json()["revoked"] is True
        assert client.get(f"/v1/local-readings/{binding['operation_id']}", headers=headers).status_code == 403
    restarted_db.close()
