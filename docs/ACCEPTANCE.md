# Recall acceptance and evaluation

Version: 0.1 | Test specification; no application tests have run yet

## Evidence standard

Report the exact commit, environment/device, provider/configuration, dataset version, commands, results, skips, and limitations. Distinguish schema/docs checks, synthetic behavioral tests, live provider tests, installed-client tests, and private-pilot acceptance. None substitutes automatically for another.

A mocked camera plus a fake transcript is useful development evidence, not proof of handwriting capture. A public text fixture is not Paul's handwriting corpus. A correct citation ID is not proof that the source supports the answer.

## Release scenarios

| Test | Requirements | Expected evidence |
| --- | --- | --- |
| A01 authenticated 3-page capture | CAP-01/03, PRIV-01 | Ordered originals visible on phone and minimal desktop, server hashes verified |
| A02 local save then force-close | CAP-02 | Draft and pages recover on restart before upload; no false cloud-ready status |
| A03 retry every network boundary | CAP-03 | Stable capture/source IDs; no duplicate jobs/memories; same bytes |
| A04 missing/corrupt/oversized page | CAP-04 | Clear recoverable error; no false finalization |
| A05 offline/denied camera | CAP-04 | Import/recovery route; saved local work remains intact |
| A06 clear maintenance page | AI-01/02, ASK-01/02 | Supported answer, correct original, uncertainty retained |
| A07 ambiguous number/unit/name | AI-02, REV-01 | No invented digit/unit/surname; unresolved field can be deferred |
| A08 old page with "Thursday" | AI-02, ACT-01 | Upload time not substituted for event date; due date remains unresolved |
| A09 two same-name people/assets | MEM-01, REV-01 | No unsafe auto-merge or association across organizations/sites |
| A10 reprocess corrected memory | AI-03, MEM-02 | User correction survives; old source/revision inspectable; stale chunks excluded |
| A11 unsupported/conflicting question | ASK-01 | Abstention or explicit conflict with source evidence, not a confident synthesis |
| A12 second-workspace attack | PRIV-01 | Direct/indirect search, source, mutation, alias, and citation leaks denied |
| A13 malicious instruction in page | AI-01, PRIV-01 | Treated as content; no tool execution or permission change |
| A14 worker crash/expired lease | CAP-03, AI-01 | Bounded retry; stale worker cannot commit; original remains accessible |
| A15 two devices edit same record | SYN-01 | Version conflict surfaced; neither change silently lost |
| A16 cursor ordering and snapshot | SYN-01 | Concurrent commits/replay/expired cursor produce no missing or duplicate effective state |
| A17 offline desktop use | OFF-01 | Cached search works; missing original and unavailable online AI are clearly labeled |
| A18 Obsidian local edit + export | EXP-01 | Local bytes preserved; conflict shown; no silent overwrite |
| A19 path escape/crash/disk-full | EXP-01, PRIV-01 | No write outside approved root; recoverable exporter and valid manifests |
| A20 delete then reconnect/retry | PRIV-01, SYN-01 | Tombstones prevent resurrection; revoked/deleted evidence excluded |
| A21 independent export/restore | OPS-01 | Markdown+JSON+originals manifest verified; isolated DB/object restore succeeds |
| A22 real-user first-run test | All core flows | Paul completes capture and source retrieval without builder assistance |

## Private handwriting evaluation set

Collect 30 consented representative pages: 20 development pages and 10 held-out pages. Include legible and difficult writing, names, technical numbers, units, equipment identifiers, arrows, cross-outs, margin notes, multiple topics, multipage sequences, and unknown dates. Include consulting, maintenance, and general business material.

Store images and labels outside the public repository. Record source hashes, capture/event-date distinctions, human transcription, ambiguity annotations, entities, supported claims, and expected abstentions. Paul confirms unclear labels; do not manufacture a gold answer where the original is genuinely unreadable.

Freeze the holdout before prompt/model tuning. Create at least 20 held-out retrieval questions spanning answerable, ambiguous, contradictory, and deliberately unsupported questions. Keep answers and tuning notes out of prompts. Record the exact denominators used in each metric.

The checked-in synthetic examples test contract shape only. They do not contain image bytes and must not be reported as live vision cases.

## Metrics

- Handwriting: report transcription error rates where the gold text is legible, plus abstention/uncertainty handling where it is not.
- Critical fields: exact match of names, asset IDs, numeric values, units, and temporal qualifiers; separately record abstained fields.
- Entity resolution: precision and coverage, with unsafe merges counted explicitly. Do not hide low precision inside aggregate extraction accuracy.
- Retrieval: evidence recall@k, correct-source rank, and coverage by case type.
- Answer quality: supported material claims, correct source page, uncertainty preservation, explicit conflict handling, and unsupported-claim rate.
- Usability: unassisted capture success, required typing, corrections per page, review burden, and source-opening success.
- Reliability/cost: end-to-end p50/p95 latency, upload/model failures, retry amplification, input/output usage, actual estimated cost per processed capture, and cache/export consistency.

## Proposed pass criteria

At least 90% of answerable held-out questions return a supported answer and the correct original page. All deliberately unsupported questions abstain or clearly report insufficient evidence. Every observed invented confirmation, material number/unit alteration, or unsafe identity merge is a release blocker until fixed and regressed. Zero events in a small sample does not prove zero real-world risk.

The 22 scenarios must pass at the appropriate packet before full pilot acceptance. Record skips as open gates, especially real iPhone/Windows, live provider, restore, deletion, and cross-workspace checks.

Performance targets on a documented reference setup: local Save feedback p95 under 1 second; processing a clear 3-page batch p95 within 60 seconds after upload; online Ask p95 under 10 seconds; local cached keyword search p95 under 500 ms. These are requirements to measure, not measured claims.

## User pilot

After technical gates, observe a two-week private pilot. Paul should capture useful pages in his normal cadence and retrieve real details without guidance. Record what he actually uses, not only what he praises. Investigate failures before adding voice, pattern detection, dashboards, or external connectors.

Owner acceptance should consider whether the app reduces search friction, whether corrections are tolerable, whether original evidence earns trust, and whether cost/operation is sustainable. The goal is a useful memory loop, not a high note count.

## Evidence record template

```text
Packet / requirement IDs:
Exact commit:
Device / OS / app build:
Provider / model / prompt / schema versions:
Dataset manifest hash:
Commands / test procedure:
Passed / failed / skipped:
Latency and usage measurements:
Source/export/restore checks:
Remaining limitations:
Artifact location (private for real data):
```
