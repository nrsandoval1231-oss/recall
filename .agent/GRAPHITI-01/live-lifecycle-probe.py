"""Synthetic-only HTTP lifecycle verification against the real running service."""
import hashlib
import json
import time
import urllib.request

BASE = "http://127.0.0.1:8766"
TOKEN = "recall-synthetic-verification-only-20261012-local"
SCOPE = "44444444-4444-4444-8444-444444444444"


def post(path, body):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def source(number, text, date, revision=1, original_hash=None):
    digest = hashlib.sha256(text.encode()).hexdigest()
    return dict(id=f"55555555-5555-4555-8555-{number:012d}", revision=revision,
        source_sha256=original_hash or digest, note_sha256=digest, text=text,
        source_name=f"synthetic-{number}.txt", note_path=f"synthetic-{number}.md",
        captured_at=date, updated_at=date)


def snapshot(generation, sources, enabled=True, rebuild=False, dismissed=None):
    return dict(version=1, scope=SCOPE, generation=generation, processing_allowed=enabled,
        sources=sources, eligible_ids=[s["id"] for s in sources] if enabled else [],
        suppressed_facts=dismissed or [], rebuild=rebuild)


def search(generation):
    return post("/v1/search", dict(version=1, scope=SCOPE, generation=generation,
        query="", limit=50, include_history=False))


def settle(generation):
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        result = search(generation)
        if result["status"]["state"] in ("ready", "disabled"):
            return result
        if result["status"]["state"] in ("failed", "unavailable"):
            raise AssertionError(result["status"])
        time.sleep(1)
    raise AssertionError("Bounded indexing deadline exceeded")


first = source(1, "Synthetic fiction: Alice Chen is an engineer employed exclusively by Example Labs as of January 1, 2026.", "2026-01-01T00:00:00Z")
second = source(2, "Synthetic fiction update: The same Alice Chen left Example Labs on February 1, 2026 and now works exclusively for Northstar Labs. Her employment with Example Labs ended on that date.", "2026-02-01T00:00:00Z")
post("/v1/snapshot", snapshot(1, [first]))
initial = settle(1)
assert initial["relationships"], initial
ids = {r["id"] for r in initial["relationships"]}
post("/v1/snapshot", snapshot(1, [first]))
assert ids == {r["id"] for r in settle(1)["relationships"]}
print(json.dumps({"duplicate_snapshot": "PASS", "initial_relationships": len(ids)}), flush=True)
post("/v1/snapshot", snapshot(2, [first, second]))
updated = settle(2)
print(json.dumps({"temporal_relationships": updated["relationships"]}), flush=True)
assert updated["relationships"], updated
temporal = any(r["invalid_at"] for r in updated["relationships"])
print(json.dumps({"temporal_invalidation": "PASS" if temporal else "NOT_OBSERVED"}), flush=True)
post("/v1/snapshot", snapshot(3, [second]))
removed = settle(3)
assert all(s["source_id"] != first["id"] for r in removed["relationships"] for s in r["supports"])
print(json.dumps({"source_deletion_rebuild": "PASS", "remaining_relationships": len(removed["relationships"])}), flush=True)
post("/v1/snapshot", snapshot(4, [], enabled=False))
revoked = settle(4)
assert revoked["relationships"] == [] and revoked["status"]["state"] == "disabled"
print(json.dumps({"scope_revocation": "PASS"}), flush=True)
