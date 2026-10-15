"""One explicit synthetic recovery attempt; preserves prior results and budget."""
import ast
import hashlib
import json
import os
import time
import uuid
from pathlib import Path

import httpx

path = Path(os.environ["RECALL_SYNTHETIC_EVAL_PATH"])
evidence = json.loads(path.read_text(encoding="utf-8"))
tree = ast.parse(Path(__file__).with_name("live-answer-eval.py").read_text(encoding="utf-8"))
notes = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "NOTES" for t in n.targets))
if "recovery_v2" in evidence:
    raise SystemExit("Recovery already recorded; do not repeat paid work.")

with httpx.Client(base_url="http://127.0.0.1:8766", headers={"Authorization": "Bearer " + os.environ["RECALL_GRAPH_TOKEN"]}, timeout=65) as client:
    provider = client.get("/v1/health").json()["providers"]["extraction"]
    sources = []
    for index, text in enumerate(notes):
        digest = hashlib.sha256(text.encode()).hexdigest()
        date = "2026-05-08T12:00:00Z" if index == 1 else "2026-05-01T12:00:00Z"
        sources.append({"id": evidence["sources"][index], "revision": 1, "source_sha256": digest, "note_sha256": digest,
                        "text": text, "source_name": f"synthetic-{index}.txt", "note_path": f"synthetic-{index}.md", "captured_at": date, "updated_at": date})
    snapshot = {"version": 1, "scope": evidence["scope"], "generation": 2, "processing_allowed": True,
                "answer_allowed": True, "answer_provider": provider, "sources": sources,
                "eligible_ids": evidence["sources"], "suppressed_facts": [], "rebuild": True}
    response = client.post("/v1/snapshot", json=snapshot)
    response.raise_for_status()
    deadline = time.monotonic() + 240
    while True:
        response = client.post("/v1/search", json={"version": 1, "scope": evidence["scope"], "generation": 2, "query": "", "limit": 50})
        response.raise_for_status()
        graph = response.json()
        if graph["status"]["state"] == "ready":
            break
        if graph["status"]["state"] in {"failed", "unavailable"} or time.monotonic() > deadline:
            raise SystemExit("Synthetic recovery indexing failed; do not replay blindly.")
        time.sleep(1)
    question = evidence["results"][2]["question"]
    response = client.post("/v1/answer", json={"version": 1, "scope": evidence["scope"], "generation": 2,
                           "request_id": str(uuid.uuid5(uuid.UUID(evidence["scope"]), "answer-case-2-recovery-v2")),
                           "question": question, "candidate_ids": evidence["sources"]})
    response.raise_for_status()
    answer = response.json()
    expected = set(evidence["sources"][:2])
    passed = answer["status"] == "supported" and expected.issubset({s["source_id"] for s in answer["selections"]})
    evidence["recovery_v2"] = {"graph": graph, "comparison_answer": answer, "comparison_pass": passed}
    stage = path.with_suffix(".stage.json")
    stage.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    stage.replace(path)
    print(json.dumps({"comparison_pass": passed, "relationships": len(graph["relationships"]), "status": answer["status"]}), flush=True)
    raise SystemExit(0 if passed and graph["relationships"] else 1)
