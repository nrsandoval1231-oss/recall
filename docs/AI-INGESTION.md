# AI ingestion and grounded retrieval

Version: 0.1 | Provider-independent behavior contract

## 1. Boundary

AI reads an authorized derivative of a captured page and proposes an interpretation. It never owns the database, filesystem, permissions, canonical identity, or external actions. There is one evaluated multimodal configuration, not an agent swarm.

The original remains separate from the transcription. Preserving the source is successful even if transcription is impossible. A source image is not searchable as handwriting until extraction or manual transcription has actually completed.

## 2. Input envelope

Provide capture ID, authorized page IDs/order, input manifest hash, known capture timezone, separately known event date, optional user context, and minimal authorized candidate context. Do not pass the entire vault by default.

Normalize rotation/format for model consumption as a derivative. Keep transformation metadata and parent hash. Remove unnecessary location/EXIF data from provider derivatives while preserving the accepted original privately. Never request device location for this workflow.

No source can add instructions to the system. The prompt explicitly treats handwritten instructions, URLs, and embedded requests as content to describe, not commands to execute. The provider adapter has no browser, email, filesystem, or arbitrary tool capability.

## 3. Extraction output

Draft contract: [extraction.schema.json](../packages/contracts/extraction.schema.json). The synthetic [maintenance example](../tests/fixtures/synthetic/maintenance-extraction.json) is contract data, not a successful live handwriting test.

Required sections:

- Schema version, capture ID, and input manifest hash.
- Ordered pages with transcription and legibility.
- A nullable summary and source references supporting it.
- Raw entity mentions with local IDs, kind, literal text, and evidence.
- Statements/claims retaining meaning and uncertainty.
- Action suggestions with literal due wording, not invented deadlines.
- Uncertainty records with evidence and a specific reason.

Evidence identifies an input page and a transcription quote. Optional page regions can be added in a future compatible extension only after visual grounding is tested. Do not invent bounding boxes or imply verified word-level highlighting.

## 4. Validation layers

1. **Structural:** known schema version, required fields, enums, bounded lengths, valid IDs, and no unexpected mutation/tool fields.
2. **Referential:** capture/hash matches the job; every page and reference belongs to this capture/workspace; local mention IDs are unique and referenced IDs exist.
3. **Semantic:** quotes are present in the indicated transcription; summaries have support; uncertain raw text remains uncertain; numeric values and units are not silently changed; no date normalization without a valid basis.
4. **Authority:** returned suggestions cannot confer membership, alter storage keys, confirm technical facts, merge identities, or mark a task completed.
5. **Concurrency:** the job lease/input revision is still current; accepted user corrections take precedence; stale model results are rejected or staged for review.

A quote matching a model transcription is not independent verification that the handwriting was read correctly. Corpus evaluation and the original-source UI address that separate problem.

Malformed output gets at most one bounded format-repair attempt within the overall three-attempt job limit. Repeated invalid or ambiguous output becomes a visible failed/review state. Do not silently drop uncertain fields to make the schema pass.

## 5. Interpretation policy

- Read "800 psi?" as an uncertain pressure claim, even when handwriting is perfectly clear.
- Read "coolant leak?" as a suspected cause, not a diagnosis or instruction to repair.
- Preserve crossed-out or illegible text as such; do not fill missing digits, units, surnames, or dates from plausibility.
- Separate a reported current condition from a proposed future step and an already made decision.
- Preserve the speaker only when attribution is explicit. A nearby first name is not enough.
- Relative dates require event context, not merely photograph time. Leave unresolved dates null and ask a targeted question when useful.
- Multiple unrelated topics on one page may stay in one source memory with several mentions. V1 does not need to fragment every sentence into a standalone knowledge note.

Do not display model self-confidence as factual reliability. Use clear/mixed/unreadable legibility, unresolved/linked identity, and reported/uncertain/user-confirmed evidence states. Any later auto-link threshold must be calibrated on held-out data; the earlier conversational 90/70 percent examples are not requirements.

## 6. Deterministic commit policy

Automatically preserve the capture, source memory, transcription, supported reported/uncertain statements, and harmless suggestions. Saving the note does not require user approval of every extracted field.

Automatically link an existing entity only when deterministic exact/approved-alias matching plus context yields a unique candidate with no conflicting identifiers. A first name, a repeated unit number, or fuzzy similarity alone is insufficient. Store an unresolved mention instead of a fake canonical person such as "Sam - unknown".

Create proposed entities and merges as reviewable suggestions. User-entered explicit identities may create canonical records. Suggested actions stay separate from accepted obligations. No autonomous outbound action exists in V1.

## 7. Retrieval pipeline

Build a keyword/entity baseline before embeddings. Then combine authorized entity matches, full-text candidates, and vector candidates. Rank fusion should be deterministic for a fixed candidate set/configuration. Use current eligible revisions and include relevant contradictory/superseded evidence when the question is historical or a conflict matters.

The provider receives a bounded evidence packet with stable server-issued citation IDs, excerpts, dates, and epistemic states. It must answer only from that packet, distinguish inference from recorded statements, and abstain when evidence is insufficient.

Validate citation IDs, source availability, current eligibility, and basic answer/evidence consistency. Do not claim software can perfectly prove semantic entailment; measure unsupported claims in evaluation. Never present an uncited confident guess because retrieval returned something vaguely similar.

## 8. Provider selection gate

Use Paul's consented handwriting evaluation set in private storage. Compare candidate quality, uncertainty retention, numeric/name handling, latency, failure rate, actual usage cost, privacy terms, and structured-output support. Select one configuration and record provider/model identifier, version/date, prompt hash, image settings, schema version, and evaluation artifact hash.

Do not claim a chat subscription pays for backend API use. API credentials stay server-side. AI remains disabled for live private inputs until consent, retention review, and owner-approved spending caps are configured. There is no provider chosen or credential installed in this scaffold.

## 9. Reprocessing

Key processing by source/input revision, schema version, prompt/model configuration, and pipeline version. Keep prior runs for traceability subject to deletion policy. Reprocessing should reuse unchanged originals, avoid duplicate jobs, compare material differences, preserve human overrides, invalidate stale answer caches, and mark the memory's current revision explicitly.
