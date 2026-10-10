# Recall pilot product contract

## Amendment — 2026-10-10 (current)

Status: **CURRENT OWNER DECISION — normative for the product center.** This amendment supersedes conflicting parts of the 2026-10-09 PWA-only pilot contract preserved below, and conflicting pilot-center sentences in older requirements, designs, implementation notes, acceptance ledgers, and builder handoffs. The 2026-10-09 text stays in this file, labeled historical. PR #16 stays in the repository.

### Owner vision

Nick Sandoval, original vision, restated 2026-10-10:

> Let me use Obsidian to its full potential without having to learn how to organize and maintain it.

Recall gives:

- A simple, polished interface for capturing notes, especially photos of handwritten pages.
- An LLM (Claude) as librarian: reading notes, organizing them, and connecting people, projects, and ideas.
- Everything saved as useful organized notes in **Obsidian**, with the original pages preserved.
- Natural-language questions for vague recall.
- Phone and computer access without account-login friction and without requiring the Obsidian mobile app.

You capture and ask. Recall organizes. **Obsidian holds your memory.**

Desktop-first. The broader universal-memory application grows from making that experience work.

### Product center

- **The desktop Memory Surface is the primary shell.** The visual target is the owner-supplied reference [memory-surface-reference-2026-10-10.jpg](assets/memory-surface-reference-2026-10-10.jpg) (1536×1024 JPEG). Credit: owner-supplied reference, Nick Sandoval, dated 2026-10-10. Recall did not invent this composition. It is visual authority for the desktop surface alongside [UX-SPEC](UX-SPEC.md). Names, counts, and project facts drawn in the picture are the existing Brooks Campus design fixture, not verified customer memory.
- **The Obsidian vault is the memory the user keeps.** Recall writes useful organized notes and preserves original photos. The user does not learn or maintain a taxonomy.
- **The phone is the capture and ask companion.** It is not the primary shell. It does not require the Obsidian mobile app.
- **The installable web app from PR #16 is an optional companion and enrollment transport.** The merged manifest, service worker, and operator device enrollment stay in `apps/web`. That app is not the product people start using. Do not deploy it as the launch. The [real-device deploy checklist](audits/2026-10-10-real-device-deploy-checklist.md) remains a gate for that optional web companion only.
- **No login and no email-auth UX.** The user journey has no sign-in, sign-up, password, passkey, email magic link, OTP, or auth callback. A provisioned device opens Recall directly. Private memory is not anonymously public. The server authorizes every private read and write. Session revocation, lost-device recovery, and an operator kill switch remain required. Never put an unrestricted API key, service-role secret, owner token, or reusable access token into client bundles, URLs retained in history, or localStorage.

### What this amendment does not change by itself

- Nothing is deployed, and draft PRs #11–#14 are not merged by this document. Those drafts are the Tauri/Obsidian vault stack to revive and rebase. See [the realignment audit](audits/2026-10-10-obsidian-desktop-realignment.md).
- The desktop slice writes the local vault and does not consult Cloud Postgres on that path. The web companion and `?mode=legacy-cloud` still use Cloud Postgres, private object storage, and Markdown export. ARCHITECTURE, PRD, ROADMAP, AGENTS.md, and SYNC-AND-EXPORT record both. This amendment does not add a second architecture document. Device install, live Claude, and the phone companion are not claimed done.
- A question mark, hypothesis, illegible number, or unresolved first name stays uncertain.
- A locally edited Obsidian file is never silently replaced.
- Offline keyword search is not described as a fresh generative answer.
- Original bytes are saved durably before AI processing. Local-only, uploaded, processed, and failed states stay honest.
- Model output stays untrusted input. The model cannot choose permissions, paths, SQL, or arbitrary tools. Human corrections survive reprocessing. Material answers need eligible source evidence.

### What to build next

The next engineering slice is the desktop Memory Surface, matching the reference, writing organized notes into a local Obsidian vault, with photo capture, Claude reading, and natural-language ask. Revive and rebase draft PRs #11–#14 onto current `main`. Do not close them. Do not merge them unchanged over this amendment.

### Still in force from 2026-10-09

- Zero login UX, and private revocable access before any memory is shown.
- Original evidence immutable; interpretation and correction are separate layers.
- Workspace isolation before retrieval, model context, source access, and mutation.
- Glass is understanding. Physical originals are evidence.

## Historical contract — 2026-10-09

Status: **HISTORICAL.** Superseded for product center by the 2026-10-10 amendment above. Retained so the PWA decision and PR #16 stay explainable. Do not execute this section as the current pilot.

The 2026-10-09 text follows, unchanged except for the heading level and one note under the image bullet.

### Product promise

**Your life remembers itself.** Capture -> Understand -> Connect -> Remember -> Recall -> Act. The first pilot must prove: photograph a real handwritten note on iPhone, save the verified original, later ask an imperfect natural-language question on iPhone or Windows, receive a supported answer and open its original evidence. Preserve uncertainty, versioned corrections, source immutability, temporal history, and workspace isolation.

### Pilot delivery platform

- **One installable web app (PWA), not a native-app pilot.** Open in mobile Safari and use **Add to Home Screen**; launch standalone with correct icon, name, manifest, viewport/safe-area handling and service worker as appropriate. The same URL works on Windows desktop browsers. No App Store, TestFlight, Expo install, Tauri/NSIS install, or mandatory native distribution for pilot acceptance.
- The existing `apps/web` React/TypeScript implementation is an acceptable **web app** foundation. “No React app” means **no separate installed React Native/native application**, not an unsupported requirement to rewrite the web app in vanilla JavaScript. Do not start a second client or a framework rewrite without demonstrated benefit.
- Cloudflare web edge, shared backend API, PostgreSQL and private object storage remain. Keep mobile camera/photo workflows and durable pending captures. Offline capability must be described honestly; a PWA install alone does not guarantee offline sync.

### Absolutely no login UX in the pilot

- No sign-in, sign-up, password, passkey prompt, email magic link, OTP, auth callback screen, or recurring credential ceremony in the user journey. A visitor who has been securely provisioned opens Recall directly.
- **No anonymous public access to private memory.** Before issuing any access, an operator securely provisions a specific trusted pilot device/workspace using a single-use, short-lived enrollment capability or equivalent controlled handoff. Enrollment should be handled without a login screen or typing credentials; the server issues a device-bound-or-device-scoped revocable session stored in a Secure, HttpOnly, SameSite cookie. Treat browser reinstall/storage clearing as requiring secure re-provisioning; do not silently grant universal access.
- The server enforces authorization and workspace isolation on **every** API and original-source request. Support session revocation, lost-device recovery, rate limits, audit logging, CSRF/origin protections, and an operator kill switch. Never put an unrestricted API key, service-role secret, owner token, or reusable access token into client bundles, URLs retained in history, or localStorage.
- Retire Supabase email-provider sign-in as an **active pilot dependency**, but preserve prior incident evidence in historical documentation. Disallow credentialless access until a tested private enrollment mechanism exists.

### Canonical UI — non-negotiable

- Preserve the approved **Memory Surface** in `docs/UX-SPEC.md`: quiet, warm ivory/charcoal, editorial typography, layered glass understanding above **physical original evidence**, restrained light, contextual depth/time, and reversible focus rather than a generic SaaS dashboard or chat app.
- On phone prioritize **Ask** and **Capture** with one primary glass board and originals one gesture away. Home Screen standalone layout must respect notch, keyboard, safe areas, reduced-motion and accessibility. Desktop is the richer view over the same web client.
- The owner referenced an additional exact visual image, but **no image was available in the 2026-10-09 message**. Do not fabricate, substitute, or claim to have locked that unseen reference. When supplied, add it as a versioned visual reference and reconcile implementation against it; until then, `UX-SPEC.md` remains the visual authority.

  *2026-10-10 note: this bullet was true on 2026-10-09 and is now false. The owner supplied the reference. It is checked in at `docs/assets/memory-surface-reference-2026-10-10.jpg`.*

### Pilot release gates

1. PWA manifest/icon/standalone display, Safari Add to Home Screen manual proof, and Windows browser smoke proof.
2. Secure owner/device provisioning with **zero login UI**; negative tests for unprovisioned browser, revoked device, cross-workspace reads/writes, CSRF and stolen/replayed enrollment token.
3. Real iPhone photo -> durable private server original (hash checked) -> Windows browser retrieval of exactly the same source; intermittent network retry and consent behaviors tested.
4. Explicitly authorized, spend-capped live multimodal handwriting interpretation; measured vague-memory retrieval with cited original, correction, and safe abstention.
5. Security/dependency triage, backups/recovery, honest operational status, independent review, and real-device evidence. Synthetic CI does not substitute for human pilot acceptance.

### Scope and sequencing

**Now:** consolidate web-only pilot, replace email login, finish secure enrollment, make installable PWA, preserve/verify Memory Surface, complete real cross-device and live-AI acceptance. **Later:** native shells, additional ingestion sources, broader integrations, agent features, teams and billing. Do not delete reusable native source code merely to change the pilot delivery channel; archive/deprioritize it and remove native install instructions from the active pilot path.

### Documentation governance

This is the single source of truth for pilot delivery/auth UX. PRD describes outcomes; UX-SPEC governs visual interaction; ARCHITECTURE and SECURITY describe the design and controls; ACCEPTANCE defines gates; ROADMAP sequences work; DEVELOPMENT and BUILD-HANDOFF instruct implementers. Historical status/CI results must be date-labeled and must not be rewritten as new proof. Do not declare deployed flows operational until verified.

*2026-10-10 note: the amendment at the top of this file is now that source of truth for product center. The governance roles in this paragraph still apply. PR #16 implemented the web half of the “Now” line above and remains historical relative to the amendment.*
