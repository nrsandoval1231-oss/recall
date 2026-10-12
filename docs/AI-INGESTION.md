# AI ingestion and grounded retrieval

## Jev capability discovery — 2026-10-12

Primary sources: [API](https://docs.typesafe.ai/api), [state](https://docs.typesafe.ai/concepts/state), [models](https://docs.typesafe.ai/models), [Python SDK](https://docs.typesafe.ai/sdk/python), [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13), and [legal terms](https://docs.typesafe.ai/legal). These were inspected directly; independent similarly named sites are not authority.

Jev accepts text, not images/audio/video, and produces bounded Choice, Score or Noul decisions, not generated transcriptions. The supported endpoint is `POST https://api.typesafe.ai/v1/systemone` with Bearer authentication, `model`, `state`, and a named question map. The documented concrete model is `jev-1.13.0`; moving aliases exist, but the native adapter requires a concrete version and response-model equality. Python `typesafe-sdk` and Node 20+ `@typesafe-ai/sdk` exist; Recall reuses its existing Rust HTTPS dependency instead of adding a runtime or SDK. Hosted account/customer terms govern model use; no open-weight/local Jev distribution was established by these sources. SDK licensing is separate from model rights.

The native `jev.rs` boundary builds exact UTF-8 evidence spans and token candidates, asks typed classifications, and returns unresolved entity/date/quantity/unit mentions and observation/question/follow-up/decision/possible-commitment/conflict candidates. It preserves raw text, source hash, source ID, offsets, model and token usage. It does not perform arithmetic, infer a year, normalize identities, or turn model confidence into verification. Retraction scope is conservatively retained through the rest of the source after a crossed-out marker. Uncertainty remains lexical and model-based, not a semantic proof. Token-level entity candidates can miss multiword identities; do not merge them without separate evidence.

Limits: 16 KiB text, 64 spans, 128 mention candidates, configured maximum request bytes capped at 128 KiB, 128 KiB response and 30-second transport timeout. No redirects, URL overrides or automatic retries. Consent, credentials, source digest, version and response distributions are checked. Provider errors are generic and never include credentials or response bodies.

The adapter now participates in durable native jobs, Claude organization and deterministic vault publication, exposed through desktop capture and optional consented phone processing. Photos use the existing Claude reader as a narrowly scoped, explicitly unreviewed visual adapter before text-only Jev. Original photos, machine transcripts and reader uncertainties retain separate native provenance. Financial reservations, source revisions and corrections gate every call. Actual authenticated inference and handwriting evaluation remain blocked by missing keys/model pins/current prices/budgets; synthetic responses establish validation and orchestration only. Jev itself does not perform handwriting OCR. See the current native status in docs/ACCEPTANCE.md for exact commits/CI and device gates.


## Active Claude librarian status (2026-10-11)

The active desktop-vault product intends consented Claude interpretation of handwritten notes, source-grounded organization, cross-note relationships, and vague retrieval. Current keyword matching is not generative recall. Existing provider-independent contracts and cloud embeddings below are reusable safety guidance, not evidence that live Claude or pgvector are integrated into the active vault path. Validate real handwriting, ambiguity, source citations, correction precedence, and abstention before claiming the librarian works. See [Canonical Foundation](CANONICAL-FOUNDATION.md).


## V1 correction and embedding implementation

Canonical user overrides are applied before saving a new machine revision, and canonical claim revisions retain user text/status/validity across reprocessing. Evidence keys carry identity decisions across revisions without accepting same-name candidates automatically. Corrected canonical claims produce explicit claim-linked search chunks; superseded/retracted/out-of-validity claims are excluded from current retrieval while historical revisions remain addressable.

Voyage embeddings require explicit provider key/model/dimensions/config version/pricing, matching workspace configuration, consent and budgets. Input and batch sizes are bounded; reservations precede calls, source revisions are rechecked before writing, and incompatible spaces fail closed. No live provider quality is asserted by synthetic fixtures. See [V1-STATUS](V1-STATUS.md).


Version: 0.2 | Provider-independent behavior contract

## Boundary

AI reads authorized sources and proposes interpretations. It never owns canonical state, identity, permissions, filesystem access, or external actions. Original evidence remains separate from transcription and synthesis.

V1 evaluates one multimodal configuration. Later input adapters may support audio, screenshots, documents, links, and connected sources without changing the memory trust model.

## Input envelope

Provide capture/source IDs, input manifest hash, source order, capture timezone, separately known event context, optional user context, and minimal authorized candidate memory. Do not pass an entire memory store by default.

Source content is data, not instruction. Provider adapters have no arbitrary browser, email, filesystem, permission, or mutation capability.

## Extraction output

The contract must support:
- ordered source transcription/description and legibility;
- source-backed summary;
- raw mentions of universal entities: person, organization, place, thing, event, project, topic;
- observations/claims preserving raw wording, attribution, time, and uncertainty;
- ideas, decisions, preferences, questions, actions/commitments when supported;
- uncertainty records and specific reasons;
- source references for every material derived item.

Do not force domain-specific fields into the universal extraction schema. Domain attributes may be proposed as typed key/value data only when supported by evidence.

## Validation

1. Structural: schema, enums, bounded lengths, IDs.
2. Referential: source/capture/workspace ownership and valid evidence references.
3. Semantic: source excerpts support derived statements; numbers/units/time are not silently changed.
4. Authority: model output cannot grant access, merge identities, verify facts, complete tasks, or cause external actions.
5. Temporal: event time and validity are not fabricated from processing/capture time.
6. Concurrency: current lease/input revision and user corrections win over stale model results.

Malformed output receives bounded repair attempts. Repeated failure becomes visible review/failure, never silent certainty.

## Interpretation policy

- “800 psi?” remains uncertain even if perfectly legible.
- “coolant leak?” remains a suspected cause.
- “Sarah said try Luca in Florence” is not enough to identify a specific venue without context/evidence.
- “Mike” is an unresolved mention unless accumulated authorized context yields one safe candidate.
- A changed date, employer, plan, preference, or measurement creates temporal history rather than destructive replacement.
- Crossed-out/illegible content remains crossed-out/illegible.
- Relative dates require valid context.
- Multiple topics may remain in one source memory; V1 does not atomize every sentence.

Do not display model self-confidence as factual reliability. Prefer legibility, resolution state, epistemic state, attribution, and user-confirmation state.

## Deterministic commit

Automatically preserve capture/source, transcription, supported reported/uncertain statements, and harmless suggestions. Saving never requires approving every field.

Automatically link an entity only when deterministic approved matching plus context yields one compatible candidate. Fuzzy similarity alone is insufficient. Proposed entities/merges remain reviewable.

User corrections create canonical revisions and override later reprocessing unless explicitly changed again.

## Retrieval

Build keyword/entity retrieval first, then measured hybrid retrieval with pgvector.

Questions are often vague and associative. Retrieval should use:
- literal terms;
- entity aliases and relationships;
- temporal clues;
- source type;
- semantic similarity;
- recent conversational disambiguation;
- current versus historical intent.

Examples:
- “that guy Sarah introduced me to last summer who did solar”
- “the restaurant we talked about in Florence”
- “what did we originally expect for the delivery date?”
- “what is the latest number?”

The answer model receives a bounded evidence packet with server-issued citation IDs, dates, temporal/epistemic state, and excerpts. It answers only from that packet, distinguishes recorded statements from inference, and abstains when evidence is insufficient.

Citation validity is necessary but not sufficient: evaluation checks whether the cited source actually supports the claim.

## Synthesized memory

Post-V1, Recall may create source-backed synthesis across memories. A synthesis is never silently promoted to observed fact. Store its supporting memory IDs, generation/config version, generated time, and inference label. When underlying evidence changes or is corrected, dependent synthesis becomes stale until recomputed.

## Provider selection

Evaluate on a private, consented multi-domain corpus. Paul's handwriting is an important stress set, but model selection must also include general-domain sources and vague-recall questions so the product does not overfit one profession.

Compare transcription/interpretation quality, uncertainty retention, numeric/name/time handling, retrieval grounding, latency, failure rate, cost, privacy terms, and structured-output support.

No provider/model credential is committed to this public repository.

## Phone native processing and local retrieval

The tailnet companion preserves original text and photo captures in the selected vault. Each capture may explicitly authorize native Jev and Claude processing with at most four relevant vault excerpts; no consent means no provider work. Keys, models, prices and budgets are read only by the desktop native process. Deterministic stage IDs and durable source-bound consent records protect duplicate attempts. Native receipt verification alone establishes publication; a cached published flag becomes needs-review if its original or receipt cannot be verified.

Background workers are in-memory threads. Restart preserves evidence, consent and completed stages, but does not automatically resume pending provider work. Retry the same capture operation to resume safely; uncertain delivery requires desktop inspection and does not automatically resend. Ask returns bounded local source-backed quotes with original hashes and inspection links; it is explicitly not a Claude-generated answer. Cross-origin requests and repeated/invalid consent values are refused. Capture acknowledgement remains truthful if later processing metadata fails.

Live inference and iPhone/Tailscale execution require credentials, consent/configuration and devices. Fixture tests prove native orchestration/storage only.

## Durable native Jev operations

`processing_parse` accepts only a selected-vault token, canonical operation/memory UUIDs, expected revision and explicit consent. Native configuration uses `TYPESAFE_API_KEY`, a supported pinned `RECALL_JEV_MODEL`, `RECALL_JEV_INPUT_USD_PER_MTOK`, `RECALL_JEV_DAILY_BUDGET_USD` and `RECALL_JEV_MONTHLY_BUDGET_USD`. Prices and budgets are positive USD decimals. Keys never travel through IPC or job status. Configure current provider prices yourself; Recall does not assume a price or model deployment.

Before sending text, Recall saves its initial capture bytes under the assigned UUID in `Recall/Sources`, then flushes an immutable operation input and conservative 100,000-input-token reservation. Native process locking serializes reservations. Results are bounded, strictly parsed, source-linked and checked against the prepared spans before being stored. The status command reloads and validates persisted state. A reserved attempt without a valid result blocks resend after restart; no automatic retry can safely infer whether the provider billed an interrupted request. Reservations remain charged conservatively even on success. Review unresolved operations manually; deleting budget records is not a supported retry mechanism.

Provider agents honor the approved environment proxy and native/system CA trust. Redirects are disabled. Photo captures return `needs_transcription`; human-corrected captures return `needs_review`. Parsed text returns `parsed`, explicitly awaiting the Claude librarian and deterministic publishing stages.

## Claude meeting organization

After a durable Jev operation is `parsed`, `meeting_organize` takes its native operation ID, a new UUID, the selected-vault token and explicit consent. It uses the existing `RECALL_CLAUDE_*` configuration and the same budget ledger as photo reading. Messages API tool selection is automatic because Sonnet 5.5 rejects forced `tool` and `any` selection. A successful result still requires `stop_reason: tool_use` and exactly one closed `organize_memory` tool call. Bounded text/thinking/redacted-thinking blocks are discarded; unknown blocks, other tools, duplicate calls and incomplete outputs fail closed. Only the tool layout reaches deterministic validation and publication. HTTP failures expose only the numeric status, never provider error bodies, and retain their conservative reservation/resend fence. Evidence and context are bounded before reserving budget. The native renderer supplies quoted source text, valid JSON-quoted YAML scalars, stable native destinations and authorized wikilinks. Proposals remain under assigned `Recall/_meta/organizations/<UUID>.json` records until `meeting_publish` validates and commits them through the native journal writer. An unvalidated organization plan from the earlier free-form proposal API is never automatically published.

## Validated Obsidian publication

`meeting_publish` resolves native parser/organization UUID records, renders the closed proposal and commits through the native vault writer. Model data never controls the destination. The current managed basename remains stable across user renames. Original text evidence and SHA-256 are revalidated before publication and interrupted-journal recovery; related memory revisions, excerpts and destinations must remain authorized. A v3 manifest fence is written before modern Markdown publication. Older Recall binaries refuse that vault rather than flatten frontmatter. Obsidian remains readable/editable, and native correction/history/recovery remains authoritative.

`memory_ask` is a bounded local quote retriever. It uses active nonconflicting current notes, recognizes delay/late wording, and returns current excerpts plus verified original source excerpts/hashes. Results survive restart and link to native originals. It does not claim that these retrieved quotes are a generated or comprehensive answer.

## Photo-to-memory bridge

The processing command uses Claude only as the visual transcription adapter when the original source is a photo. It uses the existing reader, native budgets and explicit source-specific consent. Jev receives the bounded machine transcript as text, never the image. Original photo identity and transcript identity are separate, and native reading metadata/uncertainties remain linked to both. Unknown delivery stops automatic resend. Missing Jev native key/model/price/budgets stops before paid visual reading.

Generated Obsidian notes link the original photo and the immutable unreviewed transcription attachment. They retain explicit visual-review status and all reader uncertainties. Librarian context includes those uncertainties and provenance, not only plain transcribed words. Source-backed Ask returns current notes and the original-photo inspection reference without pretending photo bytes are verified text. Handwriting accuracy requires actual provider evaluation with approved samples; synthetic image signatures in tests prove orchestration only. Current bounds are16KiB parser text,64 source spans,128 mention candidates and one photo up to25MiB; oversized/malformed input is retained locally and fails processing safely.
