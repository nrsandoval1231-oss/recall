"""Durable exclusive budget guard for one synthetic selected-photo batch."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

if os.name == "nt":
    import msvcrt
else:
    import fcntl

MODEL = "claude-sonnet-5-5"
INPUT_RATE = 2.0
OUTPUT_RATE = 10.0
INPUT_HOLD = 24_784
OUTPUT_HOLD = 64_000
MAX_USD = 5.0
DIAG02_CASES = ("numbers_uncertainty", "dense_full_page")
DIAG02_INPUT_HOLD = INPUT_HOLD
DIAG02_OUTPUT_HOLD = OUTPUT_HOLD
DIAG02_MAX_USD = 1.50


def default_journal_path() -> Path:
    """Fixed ignored repository-local state prevents selecting another batch path."""
    return (
        Path(__file__).resolve().parents[3]
        / ".recall-storage"
        / "claude-selected-photo-eval"
        / "batch.json"
    )


def diag02_journal_path() -> Path:
    """Separate fixed identity for the approved two-case diagnostic run."""
    return (
        Path(__file__).resolve().parents[3]
        / ".recall-storage"
        / "claude-selected-photo-eval"
        / "diag-02-batch.json"
    )


def open_diag02_journal() -> BatchJournal:
    """Open only DIAG-02's fixed identity, allowlist, holds, and cap."""
    return BatchJournal(
        diag02_journal_path(),
        list(DIAG02_CASES),
        max_usd=DIAG02_MAX_USD,
        input_hold=DIAG02_INPUT_HOLD,
        output_hold=DIAG02_OUTPUT_HOLD,
        stop_on_unknown=True,
    )


def hold_usd(inputs: int = INPUT_HOLD, outputs: int = OUTPUT_HOLD) -> float:
    return (inputs * INPUT_RATE + outputs * OUTPUT_RATE) / 1_000_000


def usage_within_hold(model_id: str, inputs: object, outputs: object) -> bool:
    return (
        model_id == MODEL
        and type(inputs) is int
        and type(outputs) is int
        and 0 <= inputs <= INPUT_HOLD
        and 0 <= outputs <= OUTPUT_HOLD
    )


class BatchJournal:
    """A single-use journal. A crash after reservation consumes the batch permanently."""

    def __init__(
        self,
        path: Path,
        cases: list[str],
        *,
        max_usd: float = MAX_USD,
        input_hold: int = INPUT_HOLD,
        output_hold: int = OUTPUT_HOLD,
        stop_on_unknown: bool = False,
    ) -> None:
        if not cases or len(cases) != len(set(cases)):
            raise ValueError("batch must contain distinct cases")
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.max_usd = max_usd
        self.input_hold = input_hold
        self.output_hold = output_hold
        self.stop_on_unknown = stop_on_unknown
        self.lock = path.with_suffix(path.suffix + ".lock").open("a+b")
        try:
            if os.name == "nt":
                self.lock.seek(0)
                if self.lock.read(1) == b"":
                    self.lock.write(b"0")
                    self.lock.flush()
                self.lock.seek(0)
                msvcrt.locking(self.lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError):
            self.lock.close()
            raise RuntimeError("another evaluation batch owns this journal") from None
        if path.exists():
            # An interrupted dispatch is irrevocably UNKNOWN. Keep its reservation
            # and receipt and refuse to resume any pending case.
            try:
                self.data = json.loads(path.read_text(encoding="utf-8"))
                for record in self.data.get("cases", {}).values():
                    if record.get("state") == "in_flight":
                        record["state"] = "unknown"
                self._write()
            finally:
                self.close()
            raise RuntimeError(
                "this batch journal has already been used; start no second batch"
            )
        self.data: dict[str, Any] = {
            "schema_version": 1,
            "model": MODEL,
            "max_usd": self.max_usd,
            "input_token_hold": self.input_hold,
            "output_token_hold": self.output_hold,
            "cases": {case: {"state": "pending"} for case in cases},
            "reserved_usd": 0.0,
            "actual_usage": [],
        }
        self._write()

    def _write(self) -> None:
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        with temporary.open("w", encoding="utf-8", newline="\n") as stream:
            json.dump(self.data, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)
        if os.name != "nt":
            fd = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def reserve_before_dispatch(
        self,
        case: str,
        *,
        fixture_sha256: str,
        operation_id: str,
        binding: dict[str, Any],
    ) -> None:
        record = self.data["cases"].get(case)
        amount = hold_usd(self.input_hold, self.output_hold)
        if self.stop_on_unknown and any(
            item.get("state") in {"unknown", "in_flight"}
            for item in self.data["cases"].values()
        ):
            raise RuntimeError(
                "diagnostic batch requires known prior usage before dispatch"
            )
        if record is None or record["state"] != "pending":
            raise RuntimeError(
                "case is outside the fixed batch or has already been reserved"
            )
        if len(fixture_sha256) != 64 or any(
            c not in "0123456789abcdef" for c in fixture_sha256
        ):
            raise ValueError("fixture hash must be lowercase SHA-256")
        import uuid

        if str(uuid.UUID(operation_id)) != operation_id:
            raise ValueError("operation ID must be a canonical UUID")
        if (
            binding.get("operation_id") != operation_id
            or binding.get("source_sha256") != fixture_sha256
        ):
            raise ValueError(
                "journal binding must match the reserved operation and fixture"
            )
        if self.data["reserved_usd"] + amount > self.max_usd:
            raise RuntimeError("batch reserve cap would be exceeded")
        self.data["reserved_usd"] = round(self.data["reserved_usd"] + amount, 8)
        record.update(
            state="in_flight",
            reserved_usd=amount,
            input_token_hold=self.input_hold,
            output_token_hold=self.output_hold,
            fixture_sha256=fixture_sha256,
            operation_id=operation_id,
            binding=binding,
        )
        self._write()

    def settle(
        self,
        case: str,
        *,
        state: str,
        input_tokens: int | None,
        output_tokens: int | None,
        model_id: str = MODEL,
        response: dict[str, Any] | None = None,
    ) -> None:
        record = self.data["cases"][case]
        if record["state"] != "in_flight":
            raise RuntimeError("only a reserved case can be settled")
        if state not in {"complete", "failed", "unknown"}:
            raise ValueError("invalid case state")
        if state == "unknown":
            # Keep the full reservation. Never infer a zero-cost outcome after interruption.
            record["state"] = "unknown"
            if response is not None:
                record["response"] = response
            self._write()
            return
        if not (
            model_id == MODEL
            and type(input_tokens) is int
            and type(output_tokens) is int
            and 0 <= input_tokens <= self.input_hold
            and 0 <= output_tokens <= self.output_hold
        ):
            raise ValueError(
                "actual provider usage is missing or exceeds its reserved model hold"
            )
        record["state"] = state
        if input_tokens is not None and output_tokens is not None:
            cost = hold_usd(input_tokens, output_tokens)
            self.data["actual_usage"].append(
                {
                    "case": case,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "estimated_usd": cost,
                }
            )
            record["actual_usage_usd"] = cost
        if response is not None:
            record["response"] = response
        self._write()

    def close(self) -> None:
        if os.name == "nt":
            self.lock.seek(0)
            msvcrt.locking(self.lock.fileno(), msvcrt.LK_UNLCK, 1)
        self.lock.close()
