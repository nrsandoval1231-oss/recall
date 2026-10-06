# Recall acceptance and evaluation

Version: 0.2 | Test specification; no application tests have run yet

## Evidence standard

Record exact commit, environment/device, provider/configuration, dataset version, procedure, results, skips, and limitations. Synthetic tests, live-provider tests, installed-client tests, and private-user acceptance are distinct evidence.

## Core release scenarios

1. Authenticated ordered photo capture preserves exact originals across phone/cloud/desktop.
2. Local save survives force-close before upload.
3. Network retries are idempotent and do not duplicate captures or processing.
4. Corrupt/oversized/unsupported media fails recoverably.
5. Offline/permission-denied capture preserves recoverable work.
6. Clear source yields supported interpretation and answer with correct original.
7. Ambiguous number/unit/name remains unresolved or uncertain.
8. Relative dates do not acquire fabricated exact dates.
9. Same-name people/things do not unsafe-auto-merge.
10. User correction survives reprocessing and stale indexes are excluded.
11. Unsupported/conflicting question abstains or reports conflict.
12. Cross-workspace source/search/mutation access is denied.
13. Malicious instructions inside a source remain inert content.
14. Worker crash/expired lease cannot commit stale results.
15. Concurrent device edits surface conflicts instead of silently losing changes.
16. Offline desktop clearly distinguishes cached search from fresh synthesis.
17. Export preserves local edits/conflicts and cannot escape approved paths.
18. Delete/reconnect/retry cannot resurrect deleted evidence.
19. Independent export/restore verifies database plus originals.
20. Historical query returns prior state while “latest” returns current eligible state.
21. Vague associative query can recover the right memory when evidence supports it.
22. Real-user first run succeeds without builder assistance.

## Evaluation corpus

Use two private sets.

### Design-partner stress set
Consented real Paul material representing difficult handwriting, technical values, people, organizations, equipment, projects, arrows, cross-outs, margins, multipage notes, and ambiguity.

### Universal-memory set
Consented/private or carefully constructed representative cases across domains such as:
- education/lecture notes;
- sales/relationship notes;
- household/personal logistics;
- travel/place recommendations;
- contractor/measurement notes;
- ideas/voice-like text;
- executive/project decisions;
- receipts/screenshots/files when those adapters exist.

The held-out set must contain vague associative questions, exact questions, historical/latest contrasts, ambiguity, contradictions, and deliberately unsupported prompts.

Do not tune prompts/models against holdout answers.

## Metrics

- capture success and organizational effort;
- transcription/critical-field accuracy where a gold reading exists;
- uncertainty/abstention quality where it does not;
- entity-resolution precision and unsafe-merge count;
- temporal latest-vs-historical correctness;
- evidence recall@k and correct-source rank;
- supported-answer rate and unsupported-claim rate;
- vague-recall recovery success;
- source-opening success;
- corrections/review burden;
- latency, failures, retry amplification, and cost.

## Proposed pass criteria

At least 90% of answerable held-out recall questions return a supported answer with the correct original source. Deliberately unsupported questions abstain or clearly report insufficient evidence.

Any observed fabricated confirmation, material silent number/unit alteration, unsafe identity merge, temporal overwrite that destroys required history, or cross-workspace leak blocks release until fixed and regressed.

Performance targets remain requirements to measure: local Save feedback p95 under 1 second; clear 3-page processing p95 within 60 seconds after upload; online Ask p95 under 10 seconds; cached desktop keyword search p95 under 500 ms on the documented reference setup.

## Pilot interpretation

Paul's two-week pilot proves usefulness for one demanding user, not universal product-market fit. Record what he actually captures, asks, corrects, and reuses.

Universal readiness requires separate evidence that the memory model and retrieval behavior work across multiple domains without adding domain-specific core schema or prompt hacks.

The goal is not high note count. The goal is trustworthy recovery from imperfect human recollection.
