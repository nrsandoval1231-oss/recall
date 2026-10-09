# Recall pilot product contract — 2026-10-09

Status: **CURRENT OWNER DECISION — normative for the pilot.** This file overrides conflicting pilot instructions in older requirements, designs, implementation notes, acceptance ledgers and builder handoffs. Existing reports remain historical evidence, not active requirements.

## Product promise
**Your life remembers itself.** Capture -> Understand -> Connect -> Remember -> Recall -> Act. The first pilot must prove: photograph a real handwritten note on iPhone, save the verified original, later ask an imperfect natural-language question on iPhone or Windows, receive a supported answer and open its original evidence. Preserve uncertainty, versioned corrections, source immutability, temporal history, and workspace isolation.

## Pilot delivery platform
- **One installable web app (PWA), not a native-app pilot.** Open in mobile Safari and use **Add to Home Screen**; launch standalone with correct icon, name, manifest, viewport/safe-area handling and service worker as appropriate. The same URL works on Windows desktop browsers. No App Store, TestFlight, Expo install, Tauri/NSIS install, or mandatory native distribution for pilot acceptance.
- The existing `apps/web` React/TypeScript implementation is an acceptable **web app** foundation. “No React app” means **no separate installed React Native/native application**, not an unsupported requirement to rewrite the web app in vanilla JavaScript. Do not start a second client or a framework rewrite without demonstrated benefit.
- Cloudflare web edge, shared backend API, PostgreSQL and private object storage remain. Keep mobile camera/photo workflows and durable pending captures. Offline capability must be described honestly; a PWA install alone does not guarantee offline sync.

## Absolutely no login UX in the pilot
- No sign-in, sign-up, password, passkey prompt, email magic link, OTP, auth callback screen, or recurring credential ceremony in the user journey. A visitor who has been securely provisioned opens Recall directly.
- **No anonymous public access to private memory.** Before issuing any access, an operator securely provisions a specific trusted pilot device/workspace using a single-use, short-lived enrollment capability or equivalent controlled handoff. Enrollment should be handled without a login screen or typing credentials; the server issues a device-bound-or-device-scoped revocable session stored in a Secure, HttpOnly, SameSite cookie. Treat browser reinstall/storage clearing as requiring secure re-provisioning; do not silently grant universal access.
- The server enforces authorization and workspace isolation on **every** API and original-source request. Support session revocation, lost-device recovery, rate limits, audit logging, CSRF/origin protections, and an operator kill switch. Never put an unrestricted API key, service-role secret, owner token, or reusable access token into client bundles, URLs retained in history, or localStorage.
- Retire Supabase email-provider sign-in as an **active pilot dependency**, but preserve prior incident evidence in historical documentation. Disallow credentialless access until a tested private enrollment mechanism exists.

## Canonical UI — non-negotiable
- Preserve the approved **Memory Surface** in `docs/UX-SPEC.md`: quiet, warm ivory/charcoal, editorial typography, layered glass understanding above **physical original evidence**, restrained light, contextual depth/time, and reversible focus rather than a generic SaaS dashboard or chat app.
- On phone prioritize **Ask** and **Capture** with one primary glass board and originals one gesture away. Home Screen standalone layout must respect notch, keyboard, safe areas, reduced-motion and accessibility. Desktop is the richer view over the same web client.
- The owner referenced an additional exact visual image, but **no image was available in the 2026-10-09 message**. Do not fabricate, substitute, or claim to have locked that unseen reference. When supplied, add it as a versioned visual reference and reconcile implementation against it; until then, `UX-SPEC.md` remains the visual authority.

## Pilot release gates
1. PWA manifest/icon/standalone display, Safari Add to Home Screen manual proof, and Windows browser smoke proof.
2. Secure owner/device provisioning with **zero login UI**; negative tests for unprovisioned browser, revoked device, cross-workspace reads/writes, CSRF and stolen/replayed enrollment token.
3. Real iPhone photo -> durable private server original (hash checked) -> Windows browser retrieval of exactly the same source; intermittent network retry and consent behaviors tested.
4. Explicitly authorized, spend-capped live multimodal handwriting interpretation; measured vague-memory retrieval with cited original, correction, and safe abstention.
5. Security/dependency triage, backups/recovery, honest operational status, independent review, and real-device evidence. Synthetic CI does not substitute for human pilot acceptance.

## Scope and sequencing
**Now:** consolidate web-only pilot, replace email login, finish secure enrollment, make installable PWA, preserve/verify Memory Surface, complete real cross-device and live-AI acceptance. **Later:** native shells, additional ingestion sources, broader integrations, agent features, teams and billing. Do not delete reusable native source code merely to change the pilot delivery channel; archive/deprioritize it and remove native install instructions from the active pilot path.

## Documentation governance
This is the single source of truth for pilot delivery/auth UX. PRD describes outcomes; UX-SPEC governs visual interaction; ARCHITECTURE and SECURITY describe the design and controls; ACCEPTANCE defines gates; ROADMAP sequences work; DEVELOPMENT and BUILD-HANDOFF instruct implementers. Historical status/CI results must be date-labeled and must not be rewritten as new proof. Do not declare deployed flows operational until verified.
