# Canonical Memory Surface — first browser slice

This implements the approved experience from PR #7 in the active browser product. It does not complete the whole Recall vision. PR #6 remains closed and unmerged. Product authority stays in PRD.md and UX-SPEC.md.

## Architecture and real boundaries

`apps/web/src/surface/MemorySurface.tsx` owns a bounded, reversible focus history with question, temporal selection, context expansion, scroll and keyboard focus. Ask, memory, entity, evidence and correction are successive compositions of the same environment. `GlassBoard`, `EvidenceArtifact`, `AskSurface`, `Reconstruction`, `MemoryFocus`, `EntityFocus` and `CorrectionSurface` retain semantic DOM order. Warm material tokens and CSS approach/recede hierarchy live in web styles; reduced motion removes transforms and animation.

Production uses the existing browser session and workspace boundary, shared API client, Ask citations and status, getMemory/getEntity, as_of and temporal_mode, authorized fetchSource with SHA-256 verification, expected-revision correction with idempotency, and durable scoped IndexedDB capture before upload. No backend contract or architecture was rewritten. Pending originals survive session loss. Verified object URLs are ephemeral, bounded by inspected sources, revoked on context/session exit, and reauthorized on inspection. Source bytes are never loaded speculatively. After inspection, the verified artifact may remain beneath its interpretation until leaving the context.

Current entity detail is not used inside historical focus: the API does not offer historical entity projection. Historical views show returned evidence and revision provenance, avoiding invented state. Recorded timeline dates are explicitly distinguished from event dates. Corrections invalidate earlier reconstruction snapshots instead of displaying stale answers.

## Synthetic development world

Run `npm run dev -w @recall/web` and open `/?fixture=memory-surface`. Every view is prominently marked synthetic. Brooks Campus, Mara Chen, Alder Works, notebook, site photograph and email are fictional. The fixture uses in-memory implementations of existing API types; it never authenticates, uploads, persists or sends a production write. Reload resets corrections. Capture is disabled in the fixture; browser capture tests exercise the actual application with intercepted canonical HTTP responses and a tiny synthetic image.

Additional scenarios: `&scenario=empty`, `unavailable`, `ambiguous`, `corrupt`, `slow`. Vite DEV gates both entry and factory. Every production web build checks that fixture identifiers, code and original artifacts are absent from output. These screenshots contain synthetic data only.

## Rendered states

| State | Desktop | Mobile |
| --- | --- | --- |
| Home | [image](desktop-home.jpg) | [image](mobile-home.jpg) |
| Reconstruction | [image](desktop-reconstruction.jpg) | [image](mobile-reconstruction.jpg) |
| Memory | [image](desktop-memory.jpg) | [image](mobile-memory.jpg) |
| Original evidence | [image](desktop-evidence.jpg) | [image](mobile-evidence.jpg) |
| Verified evidence under glass | [image](desktop-layered-memory.jpg) | [image](mobile-layered-memory.jpg) |
| Person focus | [image](desktop-person.jpg) | [image](mobile-person.jpg) |
| Historical understanding | [image](desktop-historical.jpg) | [image](mobile-historical.jpg) |
| Correction scope | [image](desktop-correction.jpg) | [image](mobile-correction.jpg) |
| Capture | [image](desktop-capture.jpg) | [image](mobile-capture.jpg) |

## Verification and limits

Initial slice verification: 146 client tests passed (API 26, tokens 4, sync 30, desktop 36, mobile 9, web 41); 36 browser checks passed across desktop/mobile/reduced motion (30 full-suite cases plus six added correction-keyboard/320px cases). Root lint/typecheck and both production builds passed. Actual production preview with the fixture query still entered normal signed-out authentication, with no synthetic banner. Independent review found and resolved temporal-label, summary-correction, authorization-owner and correction-focus findings.

Commands: root `npm run lint`, `npm run typecheck`, `npm test`; `npm run test:ui`; web and desktop production builds. Playwright covers the canonical journey, stale composition/focus restoration, keyboard Ask/evidence, reduced motion, narrow viewport, empty/unavailable/ambiguous/slow/corrupt sources, actual durable capture/reload/retry, and axe WCAG A/AA checks for Home/reconstruction/memory/evidence. Unit tests cover stale reads, authorization denial, source integrity and ownership, historical focus, correction conflict/revision/idempotency, context restoration, session races and fixture production isolation. CI runs browser checks and production isolation alongside existing native/backend checks.

Initial local backend verification used isolated PostgreSQL: 197 passed, eight pgvector-dependent tests skipped locally because the extension is unavailable; CI retains its pgvector configuration. Ruff, format and mypy passed. At that initial verification, native Rust/hardware and live model/email-provider acceptance remained open release gates.

### Correction-conflict recovery repair (2026-10-07)

A stale correction now preserves its draft and offers **Reload latest understanding**. Reload uses the existing authorized `getMemory` contract and updates the focused current memory revision. The user must explicitly acknowledge the newer summary/statements and review affected scope before confirming with the fresh `If-Match`. Every subsequent conflict requires another reload/review; removed or retracted statement targets cannot redirect a write. Cancelled or unmounted reloads ignore late responses. Current cached contexts are invalidated, while historical answers/evidence remain unchanged.

Fresh local validation: **205 backend tests, no skips; 153 client tests** (API 26, tokens 4, sync 30, desktop 36, mobile 9, web 48); **42 browser checks** across desktop, mobile, and reduced motion; **32 Linux native Rust tests** and `cargo check --locked` passed. Backend Ruff/format/mypy, root lint/typecheck, web and desktop production builds, production fixture-isolation checks, and the unsigned iOS JavaScript export passed. The production backend image also built and its API/worker/backup imports passed as restricted runtime UID 10001; this environment required a build-only proxy-CA secret overlay, with the repository Dockerfile unchanged. Seven added unit tests exercise successful/repeated recovery, cancellation, failed reload, authorization denial, removed targets/focus restoration, and historical-context preservation. Two added browser tests per viewport exercise the actual application/API client against clearly synthetic HTTP fixtures, including global Refresh, newer revisions, review gating, distinct operation keys, and late-response cancellation. Desktop/mobile recovery screenshots were inspected locally.

Independent diff review checked draft retention, stale responses, revision/idempotency handling, authorization boundaries, and historical evidence. It found a missing keyboard-focus fallback when a correction target disappears; the repair and regression assertion restore focus to the memory heading. Full validation also exposed an existing upload-test synchronization race and insufficient contrast in the original-preserved caption; both were repaired without weakening assertions or accessibility checks.

Read-only investigation of CI run `37655488705`: overall conclusion remains **failure**, while all four recorded jobs/check runs report success. Archived logs confirm 205 backend, 146 client, 36 browser, and 32 Rust tests passed at the older head. The workflow declares a Windows job that is absent from the returned jobs/checks/logs; no failure annotation explains the aggregate result. Its cause remains unresolved, and the run is not represented as green.

This is fixture/local acceptance, not real signed-in cross-device, live AI/provider, Windows hardware/installer, or physical iPhone acceptance. Those release gates remain open.

`performance.json` reports a local headless Chromium frame/long-task sample across Ask → focus → evidence → Back → person. It is a development fixture measurement, not a physical-device or production latency guarantee. The final sample recorded median 16.7 ms, p95 66.7 ms, longest frame 83.3 ms and one 53 ms long task. This does not meet a universal 60 fps claim; evidence decoding and backdrop compositing need continued real-device profiling. Automated contrast checks supplement keyboard and rendered inspection; they do not establish universal screen-reader/device accessibility.

## Open implementation gaps and next slice

- Browser is the first canonical surface. Tauri and Expo retain their accepted UI, offline, export and deletion behavior. Next recommended slice: reuse the focus/state primitives and material semantics in native adapters, retaining native durable capture/outbox and cached-source boundaries.
- Transition entry, depth hierarchy, evidence yield and Back restoration work; full choreography keeping both departing and arriving compositions alive is still an open motion refinement. No free-roaming 3D or GPU scene was introduced.
- Originals in this browser slice use the existing image capture contract. Arbitrary email/PDF/document import and rich authorized document renderers need a separate capability slice. Synthetic email is a clearly marked rendered correspondence artifact, not production email ingestion.
- Historical entity projection is not available; no fabricated old identity/relationship state. Broader concept evolution needs a minimal evidence-backed historical contract if product discovery requires it.
- Production reconstruction primarily exposes cited memories, then contextual entity focus. Ask currently provides no complete reconstructed entity/relationship layout contract; the UI does not invent uncited relationships.
- No claim of live AI answer quality, production deployment, physical-device smoothness, or exhaustive hundreds-of-memories acceptance. Context is bounded and can expand sequentially; broader corpus/device profiling follows this slice.
