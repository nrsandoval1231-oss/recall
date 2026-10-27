# Documentation map and disposition

## Current continuation — native voice

REALIGN-01 and TEXT-01 have independent local acceptance in `.agent/REALIGN-01/COMPLETION.json` and `.agent/FINISH-02/TEXT-COMPLETION.json`. INTELLIGENCE-01 has independent bounded acceptance for grounded Ask over current vault evidence in `.agent/INTELLIGENCE-01/COMPLETION.json`. ORGANIZE-01 has bounded independent acceptance at c6ba1029: one remembered purpose-specific opt-in enables future text/photo organization. CONTEXT-01 has bounded independent acceptance for current evidence-backed related-memory links at 4ec20fdb; evidence is in `.agent/CONTEXT-01/COMPLETION.json`. HISTORY-01 has bounded independent acceptance at d506c8de for anchored retained historical Ask. TEXT-FILE-01 has bounded independent acceptance at 2aa36435 for UTF-8 .txt/.md import. VOICE-01 native implementation is active after offline feasibility; product acceptance remains open. Ask uses a separate, default-disabled `vault_intelligence` permission and versioned excerpt-processing consent. Photo permission does not authorize Ask. No live activation or provider processing is implied.

Ask considers up to eight current eligible memories, with bounded excerpts and visible coverage limits. It preserves uncertainty, opens cited memories/originals, and suppresses answers after source or vault changes. Keyword search remains available locally; it is not an offline generated answer. Anchored historical questions, current links and UTF-8 file import have bounded acceptance. Broader/vague recall quality, voice, broader files, phone transport and full real-device/live acceptance remain open.

Current product truth lives in [PRD](PRD.md), [ARCHITECTURE](ARCHITECTURE.md), [ROADMAP](ROADMAP.md), [UX-SPEC](UX-SPEC.md), [AI-INGESTION](AI-INGESTION.md), [DATA-MODEL](DATA-MODEL.md), [SYNC-AND-EXPORT](SYNC-AND-EXPORT.md), [ACCEPTANCE](ACCEPTANCE.md), and [V1-STATUS](V1-STATUS.md). The table inventories every tracked Markdown file from the realignment base plus documentation files created for this realignment; supplemental controller-owned untracked packet/evidence files are listed separately below. Historical implementation results remain attached to their original scope and are not regraded here.

The product target is low-friction capture of notes, photos, voice and files; automatic organization in the user-owned Obsidian memory spine; and natural-language recall with evidence. Delivery is staged photo organization → text → grounded Ask → voice and broader files. The native v4 renderer and simplified surface have bounded local acceptance recorded in `.agent/REALIGN-01/COMPLETION.json`. Full product/platform acceptance remains open. No per-note approval chore, name-based cross-note identity merge, migration of real vaults, provider expansion, deployment or release is implied.

`docs/BUILD-HANDOFF.md` is the concise current handoff. Its former RCL-001/RCL-002 packet bytes are preserved byte-for-byte in [the archive](archive/BUILD-HANDOFF-RCL-001-002.md). No historical records were deleted.

## Tracked Markdown dispositions

| File | Disposition |
|---|---|
| `.agent/AGENT_RULES.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/CURRENT_STATE.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/DIAG-01.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/DIAG-02-REPAIR.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/DIAG-02.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/EPISODE-PAIRING.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/EVAL-01.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/NATIVE-CI-COMPILE-REPAIR.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/NATIVE-PAIR-REPAIR.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/NATIVE-SPLIT-CREDENTIAL-REPAIR.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/PAIR-01.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/VALIDATION_PLAN.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/WORK_GRAPH.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/archive/CURRENT_STATE-before-diag02.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.agent/archive/CURRENT_STATE-before-diagnostics.md` | Controller-owned graph/evidence; outside documentation ownership, retained unchanged. |
| `.github/pull_request_template.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `AGENTS.md` | Updated builder contract to the automatic-memory target and renderer safety rules. |
| `README.md` | Reconciled product thesis, truthful current status, and staged delivery sequence. |
| `apps/desktop/README.md` | Reconciled local capture/keyword/Claude reading scope and candidate acceptance boundaries. |
| `apps/desktop/src-tauri/README.md` | Reconciled v1-v4 format fences, properties, external edit rules and correction precedence. |
| `apps/mobile/README.md` | Reconciled preserved cloud capture, Ask, Detail and AI-consent behavior; legacy auth remains explicit. |
| `apps/web/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `docs/ACCEPTANCE.md` | Added exact-candidate gates and explicit open product gates. |
| `docs/AI-INGESTION.md` | Added model-derived organization trust boundary. |
| `docs/API-CONTRACT.md` | Technical contract/reference retained; product semantics defer to PRD and ARCHITECTURE; no conflicting active direction found. |
| `docs/ARCHITECTURE.md` | Reconciled local/native versioning and current owner-approved pairing boundaries. |
| `docs/BUILD-HANDOFF.md` | Replaced with concise current direction; prior packet archived. |
| `docs/archive/BUILD-HANDOFF-RCL-001-002.md` | Prior handoff bytes preserved as historical reference, not current dispatch. |
| `docs/DATA-MODEL.md` | Documented actual v4 flat properties/link syntax and versioned direct-edit/correction behavior. |
| `docs/DOCUMENTATION-MAP.md` | Created inventory and current reading order. |
| `docs/DEVELOPMENT.md` | Corrected local reading/edit workflow, pairing boundary and optional WSL2 native-test command. |
| `docs/FOLDER-TREE.md` | Corrected module inventory and implemented cloud/native capability descriptions. |
| `docs/PRD.md` | Canonical product target; photo/text/voice/files and natural Ask treated as required outcomes. |
| `docs/REFERENCES.md` | Added official Obsidian Properties and Links references; other technical references retained. |
| `docs/ROADMAP.md` | Added staged delivery sequence and candidate status. |
| `docs/SECURITY-AND-OPERATIONS.md` | Technical contract/reference retained; product semantics defer to PRD and ARCHITECTURE; no conflicting active direction found. |
| `docs/SYNC-AND-EXPORT.md` | Clarified what local candidate does not establish. |
| `docs/UX-SPEC.md` | Clarified capture/maintenance direction and corrected the distinction between PAIR-01 photo-inference association and phone-to-vault transport. |
| `docs/V1-STATUS.md` | Labeled dated ledger as historical and added the 173-test development-only v4 candidate checkpoint. |
| `docs/implementation/claude-evaluation/README.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/implementation/claude-vault-reading/README.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/implementation/local-vault-lifecycle/README.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/implementation/local-vault/README.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/implementation/memory-surface/README.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/implementation/owner-device-pairing/README.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/implementation/owner-device-pairing/do-inference.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/implementation/owner-device-pairing/pilot-setup.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/superpowers/plans/2026-10-07-local-vault-foundation.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/superpowers/plans/2026-10-07-memory-surface.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/superpowers/plans/2026-10-08-claude-vault-reading.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/superpowers/plans/2026-10-08-local-vault-lifecycle.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/superpowers/specs/2026-10-07-rcl-005b-no-signin-vault-design.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `docs/superpowers/specs/2026-10-08-claude-vault-reading-design.md` | Historical implementation evidence or approved design/plan; retained with bounded scope and canonical links, not current dispatch. |
| `infra/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `infra/do-inference/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `infra/supabase/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `packages/api-client/README.md` | Corrected route scope; explicitly identifies the hand-written client as the legacy authenticated mobile/cloud client, not local-vault implementation. |
| `packages/contracts/README.md` | Corrected schema/runtime and generated-client claims to match actual validators and hand-written client. |
| `packages/design-tokens/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `packages/sync/README.md` | Clarified preserved mobile/cloud capture scope versus backend change feed and unfinished vault transport. |
| `scripts/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `services/backend/README.md` | Reconciled actual API/worker, AI/retrieval and selected-photo inference modules. |
| `services/backend/migrations/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `services/backend/src/monolith/README.md` | Replaced obsolete reserved sync/export claims with implemented route/service locations. |
| `services/backend/tests/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `tests/e2e/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |
| `tests/evaluation/README.md` | Corrected obsolete reserved/no-harness description; records synthetic tools and explicit provider-call boundary. |
| `tests/fixtures/synthetic/README.md` | Inspected against the current tree; component-specific setup and behavior are accurate, with no conflicting active product claim. |

## Supplemental controller-owned untracked context

These controller-owned work artifacts were not edited by the documentation worker. The inventory covers every tracked Markdown file at the realignment base plus the newly created documentation map and preserved handoff archive.

| File | Disposition |
|---|---|
| `.agent/REALIGN-01.md` | Accepted predecessor packet, controller-owned. |
| `.agent/TEXT-01.md` | Accepted text-capture packet; exact evidence in FINISH-02. |
| `.agent/INTELLIGENCE-01.md` | Accepted bounded Ask; exact evidence and review in its evidence directory. |
| `.agent/ORGANIZE-01.md` | Active automatic text/photo organization packet after Ask acceptance. |
| `.agent/FINISH_CONTRACT.md` | Current finish contract, controller-owned. |
| `.agent/archive/2026-10-09-realignment/CURRENT_STATE.md` | Preserved prior state snapshot. |
| `.agent/archive/2026-10-09-realignment/WORK_GRAPH.md` | Preserved prior graph snapshot. |
