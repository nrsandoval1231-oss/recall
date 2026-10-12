# AI ingestion and grounded retrieval

## Jev capability discovery — 2026-10-12

Primary sources: [API](https://docs.typesafe.ai/api), [state](https://docs.typesafe.ai/concepts/state), [models](https://docs.typesafe.ai/models), [Python SDK](https://docs.typesafe.ai/sdk/python), [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13), and [legal terms](https://docs.typesafe.ai/legal). These were inspected directly; independent similarly named sites are not authority.

Jev accepts text, not images/audio/video, and produces bounded Choice, Score or Noul decisions, not generated transcriptions. The supported endpoint is `POST https://api.typesafe.ai/v1/systemone` with Bearer authentication, `model`, `state`, and a named question map. The documented concrete model is `jev-1.13.0`; moving aliases exist, but the native adapter requires a concrete version and response-model equality. Python `typesafe-sdk` and Node 20+ `@typesafe-ai/sdk` exist; Recall reuses its existing Rust HTTPS dependency instead of adding a runtime or SDK. Hosted account/customer terms govern model use; no open-weight/local Jev distribution was established by these sources. SDK licensing is separate from model rights.

The native `jev.rs` boundary builds exact UTF-8 evidence spans and token candidates, asks typed classifications, and returns unresolved entity/date/quantity/unit mentions and observation/question/follow-up/decision/possible-commitment/conflict candidates. It preserves raw text, source hash, source ID, offsets, model and token usage. It does not perform arithmetic, infer a year, normalize identities, or turn model confidence into verification. Retraction scope is conservatively retained through the rest of the source after a crossed-out marker. Uncertainty remains lexical and model-based, not a semantic proof. Token-level entity candidates can miss multiword identities; do not merge them without separate evidence.

Limits: 16 KiB text, 64 spans, 128 mention candidates, configured maximum request bytes capped at 128 KiB, 128 KiB response and 30-second transport timeout. No redirects, URL overrides or automatic retries. Consent, credentials, source digest, version and response distributions are checked. Provider errors are generic and never include credentials or response bodies.

This is an executable provider adapter, not a completed workflow. It is deliberately not exposed through the UI until durable jobs/reservations, original-photo transcription provenance, and revision-safe downstream organization exist. A byte bound is not a financial budget. External calls still require explicit consent and configured spend reservations. Real Jev execution and handwriting evaluation are blocked by missing credentials; Jev itself cannot perform handwriting OCR. Evaluate the existing consented Claude photo reader as the narrow transcription adapter, preserving crossed-out text and legibility, before librarian organization. No synthetic response establishes provider quality.


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
