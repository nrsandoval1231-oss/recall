# AI ingestion and grounded retrieval

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
