"""Emit paired synthetic keyword/hybrid recall metrics; this is not live-provider evidence."""

from __future__ import annotations

import json
import math
from pathlib import Path

CORPUS = Path(__file__).with_name("rcl003b_hybrid_corpus.json")


def cosine(left: list[float], right: list[float]) -> float:
    denominator = math.sqrt(sum(value * value for value in left) * sum(value * value for value in right))
    return sum(a * b for a, b in zip(left, right, strict=True)) / denominator


def main() -> int:
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    items = corpus["items"]
    queries = corpus["held_out_queries"]
    keyword_hits = 0
    hybrid_hits = 0
    for query in queries:
        wanted = query["expected"]
        terms = set(query["query"].lower().split())
        ranked_keyword = sorted(items, key=lambda item: -sum(term in item["text"].lower() for term in terms))
        keyword_hits += int(ranked_keyword[0]["id"] == wanted)
        ranked_hybrid = sorted(
            items,
            key=lambda item: (
                -sum(term in item["text"].lower() for term in terms) - cosine(item["vector"], query["vector"]),
                item["id"],
            ),
        )
        hybrid_hits += int(ranked_hybrid[0]["id"] == wanted)
    result = {
        "synthetic": True,
        "queries": len(queries),
        "keyword_recall_at_1": keyword_hits / len(queries),
        "hybrid_recall_at_1": hybrid_hits / len(queries),
        "note": "Synthetic vector lane only; no live Voyage quality claim.",
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
