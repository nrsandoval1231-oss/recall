# Recall — Canonical Foundation (2026-10-11)

## Authority

`PILOT-CONTRACT.md` (2026-10-10 amendment) governs product intent. `UX-SPEC.md` plus its 2026-10-11 owner cuts governs visual behavior. This document disambiguates active implementation from historical architecture. Acceptance evidence, not prose or PR descriptions, governs claims of readiness.

## Active product

Recall lets people capture and retrieve memory without learning to organize Obsidian. The desktop Tauri Memory Surface is the primary experience. The user-selected Obsidian vault is the durable memory store. Original images are preserved in `Recall/Sources`; organized Markdown lives in `Recall/Memories`; revisions and user corrections must be preserved. The phone is a lightweight Capture and Ask companion served from the desktop over an explicitly restricted Tailscale network, without login UX or Obsidian mobile. Jev is the required first interpretation layer; Claude is the required organizational librarian. Provider calls require consent and configuration, but the Jev-to-Claude workflow is a core product requirement, not an optional feature. The complete real-world loop has not yet been accepted.

## Boundaries

The Expo app, FastAPI/Postgres cloud architecture, Cloudflare PWA, server-side identity model, pgvector and cloud-managed Markdown export remain historical or optional components. They must not silently become the authority for the active desktop vault. No builder should reintroduce a sign-in screen, require a cloud deployment for local capture, or describe keyword matching as a Claude answer. No migration or deletion of legacy code is authorized by this documentation cleanup.

## Security and trust

No login UX does not mean unauthenticated public access. Phone access depends on verified Tailscale ACLs and host firewall restrictions. Current HTTP transport and missing real-device acceptance are open risks. Save originals before interpretation. Model outputs never determine filesystem paths, permissions, identity merges, or actions. Preserve uncertainty and human corrections. Never overwrite an externally edited vault note silently. Never commit real notes, keys, or vault exports.

## Evidence gates before feature expansion

1. Verify desktop app starts in an installed Windows environment, selects an existing vault, writes and reopens an original and Markdown note, and respects external edits.
2. Verify iPhone over the intended Tailscale ACL can capture both a photo and text-only note, and Ask can retrieve each; test unreachable/offline behavior and unauthorized peers.
3. Verify consented live Claude interpretation on representative handwriting, including ambiguous values and source attribution, then test correction survival.
4. Verify a vague question returns a supported answer with the correct original, and unsupported questions abstain.
5. Record exact commits, environment, devices, tests, skipped gates and failures in `ACCEPTANCE.md`. Synthetic and loopback evidence must not be promoted to live acceptance.

## Documentation hygiene

Treat `BUILD-HANDOFF.md` RCL-001 cloud instructions, `SYNC-AND-EXPORT.md` section 1 cloud authority, and cloud-first passages in `ARCHITECTURE.md`, `ROADMAP.md`, `PRD.md`, `README.md`, and `DEVELOPMENT.md` as legacy-path documentation whenever they conflict with this active pilot. The authoritative pilot amendment overrides them. Do not delete historical evidence; label it clearly. Future builder tasks must explicitly identify which path they modify and must update the relevant acceptance ledger alongside implementation.

## Canonical intelligence and Obsidian pipeline — owner decision 2026-10-11

1. **Capture:** Accept a frictionless dump of photos, handwritten notes, text and supported documents. Persist original bytes before model processing.
2. **Jev — parse and structure:** Extract readable text, candidate entities, source references, dates, units, questions and uncertainty. Preserve illegibility and ambiguity. Do not claim a model capability or provider integration without runtime evidence.
3. **Claude — librarian:** Using bounded authorized vault context and Jev output, propose note titles, stable folder destinations, YAML frontmatter properties, Obsidian wikilinks, entity relationships, tags, and safe updates to existing notes. Prefer linking and properties over deep folder hierarchies; never invent unsupported facts.
4. **Deterministic writer:** Validate a versioned schema, paths against an allowlist, source citations, existing-file revisions, YAML serialization, link targets, idempotency and conflicts. Commit atomically; preserve original artifacts, user corrections and history. Models do not write arbitrary paths or files directly.
5. **Obsidian memory:** Store human-readable Markdown with YAML frontmatter as the primary user-owned representation. Use JSON for internal manifests, indexes, audit records or structured interchange only when useful; do not replace native Markdown with opaque JSON.
6. **Recall:** Support natural-language retrieval across note text, metadata, relationships and original sources, with citations and abstention on unsupported answers.

**Product requirement:** Jev and Claude are core to the intended Recall experience, not optional roadmap extras. Consent and credential configuration still gate external provider calls. If unavailable, capture must remain durable and clearly show pending interpretation; keyword-only results must not be represented as completed intelligent organization.

**Acceptance gate:** A representative note dump must pass through real Jev parsing, real Claude organization proposals, validated vault writes, YAML/property and wikilink checks, correction-safe reprocessing, and a vague cited recall question on actual Windows/iPhone hardware before this pipeline is called production-ready. PR #26 remains isolated and is not part of this documentation change.
