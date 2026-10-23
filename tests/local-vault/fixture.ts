import type { Page } from "@playwright/test";
import type { AskOutcome, AudioOperationStatus, HistoryAskOutcome, HistoryCitation, HistoryCapability, OrganizationCapability, OrganizationOperation, OrganizationProposal, ReadingOperation, VaultMemory, VaultReading, VaultRevision, VaultStatus } from "../../apps/desktop/src/platform/local-vault";

// Test-only native command boundary. This is neither a filesystem nor a production mode.
// Browser storage below simulates native restart; Rust tests establish real disk durability.
export async function installVaultFixture(page: Page) {
  await page.addInitScript(() => {
    const key = "synthetic.test.native";
    type Receipt = { command: string; payload: string; memoryId: string };
    type Temporal = { mode: "as_of" | "compare_to_current"; start_utc: string; end_exclusive_utc: string; display_date: string; display_timezone: string };
    type State = { status: VaultStatus; memories: VaultMemory[]; history: Record<string, VaultRevision[]>; receipts: Record<string, Receipt>; readings: Record<string, ReadingOperation>; organizations: Record<string, OrganizationOperation>; organizationEnabled: boolean; organizationReady: boolean; organizationEpoch: number; asks: Record<string, { question: string; outcome: AskOutcome }>; historyEnabled: boolean; historyVersion: number; historyAsks: Record<string, { question: string; temporal: Temporal; outcome: HistoryAskOutcome }>; sources: Record<string, { bytes: number[]; mime_type: string; sha256: string }>; audio: Record<string, { phase: "recording" | "saved"; memoryId: string | null }>; audioOrgEnabled: boolean; audioOrgEpoch: number; audioOrgOps: Record<string, OrganizationOperation> };
    const empty: State = { status: { root: null, vault_id: null, vault_identity: null }, memories: [], history: {}, receipts: {}, readings: {}, organizations: {}, organizationEnabled: false, organizationReady: false, organizationEpoch: 0, asks: {}, historyEnabled: false, historyVersion: 0, historyAsks: {}, sources: {}, audio: {}, audioOrgEnabled: false, audioOrgEpoch: 0, audioOrgOps: {} };
    const state: State = JSON.parse(localStorage.getItem(key) || JSON.stringify(empty));
    state.receipts ??= {};
    state.readings ??= {};
    state.asks ??= {};
    state.historyEnabled ??= false; state.historyVersion ??= 0; state.historyAsks ??= {};
    state.sources ??= {};
    state.audio ??= {}; state.audioOrgEnabled ??= false; state.audioOrgEpoch ??= 0; state.audioOrgOps ??= {};
    state.organizations ??= {}; state.organizationEnabled ??= false; state.organizationReady ??= false; state.organizationEpoch ??= 0;
    const control = { diagnosticReading: false, readingEnabled: false, askEnabled: false, unknownAsk: false, unknownHistoryAsk: false, delayAsk: false, askPending: false, releaseAsk: () => {}, askPairingState: "disconnected", audioDenied: false, audioTranscribe: false, delayReading: false, readingPending: false, releaseReading: () => {}, unknownReading: false, failRemovalOnce: false, failRebuildOnce: false, delayRemoval: false, removalPending: false, releaseRemoval: () => {}, cancelCapture: false, cancelFileImport: false, failFileImportAfterCommit: false, cancelSelect: false, conflict: false, switchVault: false, delaySource: false, sourcePending: false, releaseSource: () => {}, organizationNeedsSetup: false, organizationUnknown: false, relatedTargetId: null as string | null, finishOrganization: (_memoryId: string) => {}, finishAudioOrganization: (_memoryId: string, _suppressed?: boolean) => {}, calls: [] as { command: string; args: Record<string, unknown> }[], importCalls: JSON.parse(localStorage.getItem("synthetic.test.importCalls") || "[]") as { command: string; args: Record<string, unknown> }[] };
    Object.assign(window, { syntheticVault: control });
    const save = () => localStorage.setItem(key, JSON.stringify(state));
    const now = "2026-10-08T12:00:00Z";
    function queueOrganization(memory: VaultMemory) {
      if (!state.organizationEnabled || !state.organizationReady) return;
      const operationId = crypto.randomUUID();
      state.organizations[operationId] = { operation_id: operationId, memory_id: memory.id, state: "queued", error_code: null };
      save();
    }
    control.finishAudioOrganization = (memoryId: string, suppressed = false) => {
      const org = Object.values(state.audioOrgOps).find(op => op.memory_id === memoryId); const m = state.memories.find(item => item.id === memoryId);
      if (!org || !m?.audio_transcript) throw new Error("SYNTHETIC voice organization operation missing");
      const evidence = [{ page_id: m.id, quote: m.audio_transcript.machine.text.slice(0, 20) }];
      m.audio_organization = { binding: { schema_version: "3.0", operation_id: org.operation_id, vault_id: state.status.vault_identity!, memory_id: m.id, source_kind: "audio_transcript", source_sha256: m.source_sha256, expected_revision: m.revision, input_sha256: "a".repeat(64), derivative_sha256: "b".repeat(64), transcript_revision: m.revision, transcript_evidence_kind: "machine_unreviewed", consent_epoch: state.audioOrgEpoch, captured_at: m.captured_at }, media_type: "text/plain; charset=utf-8", payload_sha256: "c".repeat(64), result: { provider: "anthropic", model_id: "synthetic-model", input_manifest_sha256: "d".repeat(64), extraction: { summary: "SYNTHETIC voice summary: water the seedlings", summary_evidence: evidence, pages: [{ page_id: m.id, ordinal: 1, transcription: m.audio_transcript.machine.text, legibility: "mixed" }], mentions: [], statements: [], action_suggestions: [{ kind: "reminder", text: "SYNTHETIC water the seedlings", evidence }], uncertainties: [] }, validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed };
      m.revision++; state.history[m.id]!.push({ revision: m.revision, note: "", recorded_at: now, origin: "machine:anthropic", kind: "audio_organization", audio_organization: structuredClone(m.audio_organization) });
      org.state = "organized"; save();
    };
    control.finishOrganization = (memoryId: string) => {
      const operation = Object.values(state.organizations).find(op => op.memory_id === memoryId);
      const memory = state.memories.find(item => item.id === memoryId);
      if (!operation || !memory) throw new Error("SYNTHETIC organization operation missing");
      const target = control.relatedTargetId ? state.memories.find(item => item.id === control.relatedTargetId && item.state === "active" && !item.conflict) : undefined;
      const related = target ? [{ target_memory_id: target.id, source_quote: memory.note.slice(0, Math.min(memory.note.length, 40)), target_quote: target.note.slice(0, Math.min(target.note.length, 40)) }] : [];
      const isText = Boolean(memory.imported_text) || memory.source_name.toLowerCase().endsWith(".txt");
      const proposal: OrganizationProposal = { binding: { schema_version: related.length ? "2.0" : "1.0", operation_id: operation.operation_id, vault_id: state.status.vault_identity!, memory_id: memory.id, source_kind: isText ? "text" : "photo", source_sha256: memory.source_sha256, expected_revision: memory.revision, input_sha256: memory.source_sha256, consent_epoch: state.organizationEpoch, captured_at: memory.captured_at, ...(related.length ? { context_coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } } : {}) }, media_type: isText ? "text/plain; charset=utf-8" : "image/png", payload_sha256: "synthetic-payload", result: { provider: "anthropic", model_id: "synthetic-model", input_manifest_sha256: "synthetic-payload", extraction: { summary: "SYNTHETIC delayed organization complete", summary_evidence: [{ page_id: memory.id, quote: "SYNTHETIC delayed source" }], pages: [{ page_id: memory.id, ordinal: 1, transcription: memory.note, legibility: "clear" }], mentions: [], statements: [{ epistemic_state: "question", text: "SYNTHETIC question remains uncertain?", attribution_text: "SYNTHETIC someone asked", temporal_text: "SYNTHETIC last spring", evidence: [{ page_id: memory.id, quote: "SYNTHETIC source quote" }] }], action_suggestions: [], uncertainties: [{ kind: "unknown", description: "SYNTHETIC uncertain example", evidence: [{ page_id: memory.id, quote: "SYNTHETIC ?" }] }] }, ...(related.length ? { related_context: related } : {}), validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed: false };
      memory.organization = proposal;
      memory.related_context = target ? [{ ...related[0]!, label: "Possibly related (unreviewed)", note_basename: target.note_path ?? "SYNTHETIC related note.md" }] : undefined;
      const revisions = state.history[memory.id] ?? [];
      revisions.push({ revision: memory.revision + 1, note: memory.note, recorded_at: now, origin: "machine:anthropic", kind: "organization", organization: proposal });
      state.history[memory.id] = revisions; memory.revision++;
      operation.state = "organized"; save();
    };
    async function original() {
        // Generate visibly synthetic PNG bytes in test code, never the application.
        const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 420;
        const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fff8df"; ctx.fillRect(0, 0, 720, 420);
        ctx.fillStyle = "#263b31"; ctx.font = "bold 32px sans-serif"; ctx.fillText("SYNTHETIC TEST CARD", 40, 90);
        ctx.font = "24px sans-serif"; ctx.fillText("Garden workshop · example only", 40, 160); ctx.fillText("No personal or customer information", 40, 230); ctx.fillText("Seedlings 12? · uncertain example", 40, 300);
        const bytes = Array.from(atob(canvas.toDataURL("image/png").split(",")[1]!), c => c.charCodeAt(0));
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("");
        return { bytes, mime_type: "image/png", sha256: hash };
    }
    function projection(query: string, includeDeleted: boolean) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      return state.memories.filter(m => {
        if (terms.length) return m.state === "active" && m.conflict === null && terms.every(term => [m.note, m.reading?.human_correction ?? structuredSearchText(m), m.source_name, m.note_path ?? ""].some(field => field.toLowerCase().includes(term)));
        return includeDeleted || m.state !== "deleted";
      }).sort((a, b) => a.id.localeCompare(b.id));
    }
    function structuredSearchText(memory: VaultMemory) {
      if (!memory.reading || memory.reading.human_correction !== null) return "";
      const extraction = memory.reading.machine.result.extraction;
      const fields = ["raw_text", "text", "description", "quote", "attribution_text", "temporal_text", "value_text", "due_text"];
      const text = [extraction.summary ?? ""];
      for (const group of [extraction.mentions, extraction.statements, extraction.action_suggestions, extraction.uncertainties, extraction.summary_evidence]) for (const item of group) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        for (const key of fields) if (typeof record[key] === "string") text.push(record[key] as string);
        if (Array.isArray(record.evidence)) for (const evidence of record.evidence) {
          if (!evidence || typeof evidence !== "object") continue;
          const quote = (evidence as Record<string, unknown>).quote;
          if (typeof quote === "string") text.push(quote);
        }
      }
      return text.join(" ");
    }
    async function invoke(command: string, args: Record<string, unknown> = {}) {
      control.calls.push({ command, args });
      if (command === "vault_import_text_file") { control.importCalls.push({ command, args }); localStorage.setItem("synthetic.test.importCalls", JSON.stringify(control.importCalls)); }
      if (command === "vault_status") return state.status;
      if (command === "vault_select") {
        if (control.cancelSelect) { control.cancelSelect = false; return null; }
        const id = control.switchVault ? "b" : "a";
        state.status = { root: `/synthetic/vault-${id}`, vault_id: crypto.randomUUID(), vault_identity: `synthetic-${id}` };
        for (const op of Object.values(state.readings)) if (!["committed", "cancelled", "failed", "expired"].includes(op.state)) op.state = "cancelled";
        if (control.switchVault) { state.memories = []; state.history = {}; state.receipts = {}; state.readings = {}; state.organizations = {}; state.organizationEnabled = false; state.organizationReady = false; state.organizationEpoch = 0; state.asks = {}; state.historyEnabled = false; state.historyVersion = 0; state.historyAsks = {}; state.sources = {}; state.audio = {}; state.audioOrgEnabled = false; state.audioOrgEpoch = 0; state.audioOrgOps = {}; }
        save(); return state.status;
      }
      if (args.expectedVaultId !== state.status.vault_id) throw new Error("Stale vault session");
      if (command === "vault_intelligence_capability") return { enabled: control.askEnabled, scope: "vault_intelligence", consent: control.askEnabled ? "active" : "missing", explanation: control.askEnabled ? "SYNTHETIC Ask connection and consent confirmed for this vault." : "SYNTHETIC Ask is disabled; local keyword search remains available.", history_consent: control.askEnabled ? state.historyEnabled ? "active" : "missing" : "missing", history_enabled: control.askEnabled, consent_version: state.historyVersion, history_policy_version: state.historyEnabled ? "ask-history-v1|synthetic" : "ai_policy_version" };
      if (command === "vault_set_history_consent") {
        if (!control.askEnabled || args.expectedVersion !== state.historyVersion) throw new Error("Synthetic history decision changed; refresh capability");
        state.historyEnabled = args.enableHistory === true; state.historyVersion++; save();
        const capability: HistoryCapability = { scope: "vault_intelligence", history_consent: state.historyEnabled ? "active" : "missing", history_enabled: control.askEnabled, consent_version: state.historyVersion, history_policy_version: state.historyEnabled ? "ask-history-v1|synthetic" : "ai_policy_version" };
        return capability;
      }
      const organizationCapability = (): OrganizationCapability => {
        const readiness = state.organizationEnabled ? control.organizationUnknown ? "unknown" : state.organizationReady ? "ready" : "needs_setup" : "off";
        const enabled = state.organizationEnabled;
        return { schema_version: "1.0", scope: "vault_intelligence", purpose: "organize", vault_id: state.status.vault_identity!, policy_version: "organize-v1|synthetic", provider: "anthropic", consent: state.organizationEnabled ? "active" : "missing", enabled, consent_epoch: state.organizationEpoch, decided_at: state.organizationEnabled ? now : null, local_readiness: readiness, automatic_enabled: enabled && readiness === "ready" };
      };
      if (command === "vault_organization_capability") return organizationCapability();
      if (command === "vault_set_organization_consent") {
        if (args.expectedConsentEpoch !== state.organizationEpoch) throw new Error("Organization consent changed; refresh the setting");
        state.organizationEnabled = args.enabled === true; state.organizationReady = state.organizationEnabled && !control.organizationNeedsSetup; state.organizationEpoch++; save();
        return organizationCapability();
      }
      if (command === "vault_reconcile_organization_consent") { if (state.organizationEnabled) state.organizationReady = true; else state.organizationReady = false; control.organizationUnknown = false; save(); return organizationCapability(); }
      if (command === "vault_organization_operations") return Object.values(state.organizations).filter(op => op.memory_id === args.memoryId);
      if (command === "vault_recover_organization") return state.organizations[String(args.operationId)] ?? { operation_id: String(args.operationId), memory_id: "", state: "unknown", error_code: "SYNTHETIC_OPERATION_UNKNOWN" };
      if (command === "vault_organization_process_pending") { for (const op of Object.values(state.organizations)) if (op.state === "queued" || op.state === "prepared") op.state = "processing"; save(); return; }
      if (command === "vault_related_memory") {
        const source = state.memories.find(item => item.id === args.sourceMemoryId);
        const target = state.memories.find(item => item.id === args.targetMemoryId);
        const link = source?.related_context?.find(item => item.target_memory_id === args.targetMemoryId);
        if (!source || source.state !== "active" || source.conflict || !source.organization || source.organization.suppressed || !link || !target || target.state !== "active" || target.conflict || (target.note_path ?? "SYNTHETIC related note.md") !== link.note_basename) throw new Error("This related memory has changed or is no longer available.");
        const verifiedOriginal = state.sources[target.id] ?? await original();
        if (verifiedOriginal.sha256 !== target.source_sha256) throw new Error("Related memory original changed");
        return { memory_id: target.id, revision: target.revision, source_sha256: target.source_sha256, source_name: target.source_name, note_basename: link.note_basename, original: structuredClone(verifiedOriginal) };
      }
      if (command === "vault_intelligence_pairing_prepare") { control.askPairingState = "pending_owner_approval"; return { state: control.askPairingState, device_id: "synthetic-device", vault_id: state.status.vault_id!, fingerprint: null, scope: "vault_intelligence" }; }
      if (command === "vault_intelligence_pairing_claim") { if (!String(args.invitationId).startsWith("SYNTHETIC-")) throw new Error("Synthetic owner-issued invitation required"); control.askPairingState = "connected"; control.askEnabled = true; return { state: control.askPairingState, device_id: "synthetic-device", vault_id: state.status.vault_id!, fingerprint: "synthetic", scope: "vault_intelligence" }; }
      if (command === "vault_intelligence_pairing_status") return { state: control.askPairingState, device_id: control.askPairingState === "connected" ? "synthetic-device" : null, vault_id: state.status.vault_id!, fingerprint: control.askPairingState === "connected" ? "synthetic" : null, scope: "vault_intelligence" };
      if (command === "vault_intelligence_pairing_disconnect") { control.askPairingState = "disconnected"; control.askEnabled = false; return { state: control.askPairingState, device_id: null, vault_id: state.status.vault_id!, fingerprint: null, scope: "vault_intelligence" }; }
      if (command === "vault_ask_history" || command === "vault_recover_history_ask") {
        const operationId = String(args.operationId); const prior = state.historyAsks[operationId];
        if (command === "vault_recover_history_ask") {
          if (!prior) return { operation: { operation_id: operationId, state: "unknown", error_code: "SYNTHETIC_HISTORY_RECEIPT_NOT_FOUND" }, temporal: { mode: "as_of", start_utc: "2026-10-08T05:00:00Z", end_exclusive_utc: "2026-10-09T05:00:00Z", display_date: "2026-10-08", display_timezone: "America/Chicago" }, answer: null, history_evidence: [] };
          if (prior.outcome.operation.state === "unknown") { prior.outcome = completeHistoryAsk(operationId, prior.question, prior.temporal); save(); }
          return prior.outcome;
        }
        const question = String(args.question); const temporal = args.temporal as Temporal;
        if (!control.askEnabled || !state.historyEnabled) return { operation: { operation_id: operationId, state: "failed", error_code: "ASK_UNAVAILABLE" }, temporal, answer: null, history_evidence: [] };
        if (prior) { if (prior.question !== question || JSON.stringify(prior.temporal) !== JSON.stringify(temporal)) throw new Error("Historical Ask operation payload changed"); return prior.outcome; }
        const outcome: HistoryAskOutcome = control.unknownHistoryAsk ? { operation: { operation_id: operationId, state: "unknown", error_code: "SYNTHETIC_HISTORY_OUTCOME_UNKNOWN" }, temporal, answer: null, history_evidence: [] } : completeHistoryAsk(operationId, question, temporal);
        control.unknownHistoryAsk = false; state.historyAsks[operationId] = { question, temporal, outcome }; save(); return outcome;
      }
      if (command === "vault_ask_history_citation") {
        const prior = state.historyAsks[String(args.operationId)]; const evidence = prior?.outcome.history_evidence.find(item => item.citation_id === args.citationId);
        if (!prior || !evidence) throw new Error("Synthetic historical citation unavailable");
        const retained = state.history[evidence.memory_id]?.find(item => item.revision === evidence.memory_revision);
        const source = state.sources[evidence.memory_id];
        if (!retained || !source) throw new Error("Synthetic historical source unavailable");
        const citation: HistoryCitation = { memory_id: evidence.memory_id, revision: evidence.memory_revision, event_sha256: evidence.event_sha256, source_sha256: evidence.source_sha256, current_revision: evidence.current_revision, current: evidence.current_revision === evidence.memory_revision, quote: evidence.excerpt, retained_revision: structuredClone(retained), original: structuredClone(source) };
        return citation;
      }
      if (command === "vault_ask" || command === "vault_recover_ask") {
        const operationId = String(args.operationId); const prior = state.asks[operationId];
        if (command === "vault_recover_ask") {
          if (!prior) return { operation: { operation_id: operationId, state: "failed", error_code: "ASK_OPERATION_NOT_FOUND" }, answer: null };
          if (prior.outcome.operation.state === "unknown") {
            const recovered = completeAsk(operationId, prior.question); state.asks[operationId] = { question: prior.question, outcome: recovered }; save(); return recovered;
          }
          return prior.outcome;
        }
        const question = String(args.question);
        if (prior) { if (prior.question !== question) throw new Error("Ask operation question changed"); return prior.outcome; }
        if (!control.askEnabled) return { operation: { operation_id: operationId, state: "failed", error_code: "ASK_UNAVAILABLE" }, answer: null };
        const token = state.status.vault_id;
        const operation = { operation_id: operationId, state: "in_flight" as const, error_code: null };
        state.asks[operationId] = { question, outcome: { operation, answer: null } }; save();
        if (control.delayAsk) { control.askPending = true; await new Promise<void>(resolve => { control.releaseAsk = resolve; }); }
        if (token !== state.status.vault_id) throw new Error("SYNTHETIC stale Ask after vault switch");
        if (control.unknownAsk) { control.unknownAsk = false; const unknown = { operation: { operation_id: operationId, state: "unknown" as const, error_code: "PROVIDER_OUTCOME_UNKNOWN" }, answer: null }; state.asks[operationId] = { question, outcome: unknown }; save(); return unknown; }
        const result = completeAsk(operationId, question); state.asks[operationId] = { question, outcome: result }; save(); return result;
      }
      function completeAsk(operationId: string, question: string): AskOutcome {
        const eligible = state.memories.filter(m => m.state === "active" && !m.conflict && m.revision > 0 && Boolean(m.note || m.reading));
        const chosen = eligible.slice(0, 8);
        const citations = chosen.map((m, index) => ({ citation_id: `c${index + 1}`, memory_id: m.id, memory_revision: m.revision, source_sha256: m.source_sha256, evidence_kind: m.source_name.toLowerCase().endsWith(".txt") ? "text_source" as const : m.reading?.human_correction !== null && m.reading?.human_correction !== undefined ? "human_reading_correction" as const : m.reading ? "machine_reading" as const : "human_note" as const, quote: (m.source_name.toLowerCase().endsWith(".txt") ? m.note : (m.reading?.human_correction ?? m.note) || m.reading?.machine.result.extraction.pages[0]?.transcription || "").slice(0, 1500) }));
        const answer = chosen.length ? { status: "answered" as const, sentences: [{ text: `Synthetic source evidence considered for: ${question}`, citation_ids: citations.map(c => c.citation_id) }], citations, limitations: [], coverage: { eligible_count: eligible.length, selected_count: chosen.length, limited: eligible.length > chosen.length, truncated_count: chosen.filter((m, index) => citations[index]!.quote.length < (m.note || "").length).length } } : { status: "insufficient_evidence" as const, sentences: [], citations: [], limitations: [], coverage: { eligible_count: 0, selected_count: 0, limited: false, truncated_count: 0 } };
        return { operation: { operation_id: operationId, state: "complete", error_code: null }, answer };
      }
      function completeHistoryAsk(operationId: string, question: string, temporal: Temporal): HistoryAskOutcome {
        const eligible = state.memories.filter(m => m.state === "active" && !m.conflict && m.revision > 0 && Date.parse(m.captured_at) < Date.parse(temporal.end_exclusive_utc));
        const chosen = eligible.slice(0, 8);
        const history_evidence = chosen.flatMap((memory, index) => {
          const revision = [...(state.history[memory.id] ?? [])].filter(item => Date.parse(item.recorded_at) < Date.parse(temporal.end_exclusive_utc)).sort((a, b) => b.revision - a.revision)[0];
          if (!revision) return [];
          return [{ citation_id: `c${index + 1}`, memory_id: memory.id, memory_revision: revision.revision, event_sha256: "a".repeat(64), source_sha256: memory.source_sha256, captured_at: memory.captured_at, recorded_at: revision.recorded_at, current_revision: memory.revision, history_status: revision.revision < memory.revision ? "as_of_later_corrected" as const : "as_of" as const, evidence_kind: "human_note" as const, epistemic_state: "reported", excerpt: revision.note.slice(0, 1500) }];
        });
        const citations = history_evidence.map(item => ({ citation_id: item.citation_id, memory_id: item.memory_id, memory_revision: item.memory_revision, source_sha256: item.source_sha256, evidence_kind: item.evidence_kind, quote: item.excerpt }));
        const answer = citations.length ? { status: "answered" as const, sentences: [{ text: `Synthetic retained evidence considered for: ${question}`, citation_ids: citations.map(item => item.citation_id) }], citations, limitations: [], coverage: { eligible_count: eligible.length, selected_count: history_evidence.length, limited: eligible.length > history_evidence.length, truncated_count: 0 } } : { status: "insufficient_evidence" as const, sentences: [], citations: [], limitations: [], coverage: { eligible_count: eligible.length, selected_count: 0, limited: false, truncated_count: 0 } };
        return { operation: { operation_id: operationId, state: "complete", error_code: null }, answer, temporal, history_evidence };
      }
      if (command === "vault_reading_capability") return { enabled: control.readingEnabled, explanation: control.readingEnabled ? "SYNTHETIC configured connection" : "No private service connection has been installed." };
      if (command === "vault_reading_operations") return Object.values(state.readings).filter(op => op.memory_id === args.memoryId);
      if (command === "vault_cancel_reading") {
        const id = String(args.operationId); const op = state.readings[id] ?? { operation_id: id, memory_id: "", expected_revision: 0, state: "prepared", may_have_been_sent: false, error_code: null };
        if (op.state !== "committed") op.state = "cancelled"; state.readings[id] = op; save(); return op;
      }
      if (command === "vault_read_photo" || command === "vault_recover_reading") {
        const id = String(args.operationId); const existing = state.readings[id];
        if (existing?.state === "cancelled") return { operation: existing, memory: null };
        const m = state.memories.find(m => m.id === (existing?.memory_id ?? args.memoryId)); if (!m) throw new Error("Unknown reading memory");
        if (m.source_name.toLowerCase().endsWith(".txt")) throw new Error("Text sources cannot be sent to photo reading");
        if (!control.readingEnabled) throw new Error("SYNTHETIC service not connected");
        if (existing?.state === "committed") return { operation: existing, memory: m };
        if (m.state !== "active" || m.conflict || (existing?.expected_revision ?? args.expectedRevision) !== m.revision) throw new Error("Reading revision or state changed");
        const op: ReadingOperation = existing ?? { operation_id: id, memory_id: m.id, expected_revision: m.revision, state: "prepared", may_have_been_sent: false, error_code: null };
        state.readings[id] = op; op.may_have_been_sent = true; op.state = "in_flight"; save();
        const token = state.status.vault_id;
        if (control.delayReading) { control.readingPending = true; await new Promise<void>(resolve => { control.releaseReading = resolve; }); }
        if (token !== state.status.vault_id || state.readings[id]!.state === "cancelled") throw new Error("SYNTHETIC reading cancelled or stale");
        if (control.unknownReading && command === "vault_read_photo") { control.unknownReading = false; op.state = "unknown"; save(); return { operation: op, memory: null }; }
        const hash = m.source_sha256;
        const reading: VaultReading = { machine: { request: { binding: { schema_version: "1.0", operation_id: id, vault_id: state.status.vault_identity!, memory_id: m.id, source_id: m.id, source_sha256: hash, expected_revision: op.expected_revision, captured_at: m.captured_at }, media_type: "image/png" }, result: { provider: "anthropic", model_id: "synthetic-claude", review_state: "unreviewed", input_manifest_sha256: "b".repeat(64), derivative: { sha256: "c".repeat(64), transform_version: "jpeg-rgb-exif-orient-v1", media_type: "image/jpeg" }, extraction: { schema_version: "1.1", capture_id: id, input_manifest_sha256: "b".repeat(64), summary: "The source mentions seedlings; the count is unclear.", summary_evidence: [{ page_id: m.id, quote: "SYNTHETIC seedlings 12?" }], pages: [{ page_id: m.id, ordinal: 1, transcription: "SYNTHETIC seedlings 12?", legibility: "mixed" }], mentions: [], statements: [{ temporal_text: "after the storm", evidence: [{ page_id: m.id, quote: "rain had cleared" }] }], action_suggestions: [], uncertainties: [{ kind: "illegible", description: "The number may be 12; the question mark remains unresolved.", evidence: [{ page_id: m.id, quote: "12?" }] }] }, validation_notes: [] } }, human_correction: m.reading?.human_correction ?? null };
        m.reading = reading; m.revision++; op.state = "committed"; state.history[m.id]!.push({ revision: m.revision, note: m.note, reading: structuredClone(reading), recorded_at: now, origin: "machine:anthropic", kind: "machine_reading" }); save(); return { operation: op, memory: m };
      }
      // Synthetic audio: a 0.1 s silent 16 kHz mono WAV generated here in test code, never by the application.
      function audioStatus(op: string, over: Partial<AudioOperationStatus> = {}): AudioOperationStatus {
        return { schema_version: "1.0", operation_id: op, vault_id: state.status.vault_identity!, state: "recording", memory: null, error_code: null, limit_reason: null, source_sample_rate_hz: 16000, source_channels: 1, ...over };
      }
      const audioCapability = () => ({ schema_version: "1.0", scope: "vault_intelligence", purpose: "organize_audio", vault_id: state.status.vault_identity!, policy_version: "organize-audio-v1|synthetic", provider: "anthropic", consent: state.audioOrgEnabled ? "active" : "missing", enabled: state.audioOrgEnabled, consent_epoch: state.audioOrgEpoch, decided_at: state.audioOrgEnabled ? now : null, local_readiness: state.audioOrgEnabled ? "ready" : "off", automatic_enabled: state.audioOrgEnabled });
      if (command === "vault_audio_organization_capability" || command === "vault_reconcile_audio_organization_consent") return audioCapability();
      if (command === "vault_set_audio_organization_consent") {
        if (args.expectedConsentEpoch !== state.audioOrgEpoch) throw new Error("Voice organization consent changed; refresh the setting");
        state.audioOrgEnabled = args.enabled === true; state.audioOrgEpoch++;
        if (!state.audioOrgEnabled) for (const op of Object.values(state.audioOrgOps)) if (["awaiting_transcript", "queued"].includes(op.state)) { op.state = "stale"; op.error_code = "CONSENT_REVOKED"; }
        save(); return audioCapability();
      }
      if (command === "vault_audio_organization_operations") return Object.values(state.audioOrgOps).filter(op => op.memory_id === args.memoryId);
      if (command === "vault_recover_audio_organization") return state.audioOrgOps[String(args.operationId)] ?? { operation_id: String(args.operationId), memory_id: "", state: "unknown", error_code: "RECEIPT_UNAVAILABLE" };
      if (command === "vault_audio_start") {
        const op = String(args.operationId); const prior = state.audio[op];
        if (prior) return audioStatus(op, { state: prior.phase === "recording" ? "recording" : "saved_local", memory: state.memories.find(m => m.id === prior.memoryId) ?? null });
        if (control.audioDenied) return audioStatus(op, { state: "failed", error_code: "permission_denied" });
        state.audio[op] = { phase: "recording", memoryId: null }; save(); return audioStatus(op);
      }
      if (command === "vault_audio_stop" || command === "vault_audio_status") {
        const op = String(args.operationId); const entry = state.audio[op];
        if (!entry) throw new Error("Unknown audio operation");
        if (command === "vault_audio_status" && entry.phase === "recording") return audioStatus(op);
        if (entry.phase === "recording") {
          const rate = 16000, frames = 1600, wav = new Uint8Array(44 + frames * 2), view = new DataView(wav.buffer);
          const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
          tag(0, "RIFF"); view.setUint32(4, 36 + frames * 2, true); tag(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, frames * 2, true);
          const bytes = Array.from(wav); const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", wav)), b => b.toString(16).padStart(2, "0")).join("");
          const m: VaultMemory = { id: op, revision: 1, note: "", source_name: "SYNTHETIC-recording.wav", source_sha256: sha, captured_at: now, updated_at: now, conflict: null, state: "active", note_path: "synthetic-recording.md", audio_source: { capture_origin: "recorded", original_name: null, media_type: "audio/wav", source_sha256: sha, source_bytes: bytes.length, sample_rate_hz: 16000, channels: 1, pcm_bits: 16, duration_ms: 100 }, audio_transcript: null };
          state.memories.push(m); state.sources[op] = { bytes, mime_type: "audio/wav", sha256: sha }; state.history[op] = [{ revision: 1, note: "", recorded_at: now, origin: "human:recall", kind: "capture" }];
          entry.phase = "saved"; entry.memoryId = op;
          if (state.audioOrgEnabled) { const orgId = crypto.randomUUID(); state.audioOrgOps[orgId] = { operation_id: orgId, memory_id: op, state: "awaiting_transcript", error_code: null }; }
          save();
          return audioStatus(op, { state: "saved_local", memory: structuredClone(m) });
        }
        const m = state.memories.find(item => item.id === entry.memoryId)!;
        if (!m.audio_transcript && control.audioTranscribe) {
          const hash = "e".repeat(64);
          m.audio_transcript = { machine: { operation_id: crypto.randomUUID(), source_sha256: m.source_sha256, source_revision: 1, runtime_source_commit: "d".repeat(40), runtime_binary_sha256: hash, model_sha256: hash, derivative_sha256: hash, transform_version: "pcm16-mono-16khz-rubato-fft-v1", output_sha256: hash, text: "SYNTHETIC remember to water the seedlings.", segments: null, input_rms_pcm16: 1200, quality_flags: [], eligibility: "eligible", quality_state: "machine_unreviewed" }, human_correction: null };
          m.revision++; state.history[m.id]!.push({ revision: m.revision, note: "", recorded_at: now, origin: "machine:local", kind: "machine_audio_transcript" });
          for (const org of Object.values(state.audioOrgOps)) if (org.memory_id === m.id && org.state === "awaiting_transcript") org.state = "queued";
          save();
        }
        return audioStatus(op, { state: m.audio_transcript ? "transcribed" : command === "vault_audio_stop" ? "saved_local" : "transcription_processing", memory: structuredClone(m) });
      }
      // Durable native receipts are simulated separately from the renderer's persisted intent.
      const operation = typeof args.operationId === "string" ? args.operationId : null;
      const payload = JSON.stringify({ memoryId: args.memoryId, expectedRevision: args.expectedRevision, expectedState: args.expectedState, note: args.note, text: args.text });
      const previous = operation ? state.receipts[operation] : undefined;
      if (previous) {
        if (previous.command !== command || previous.payload !== payload) throw new Error("Operation payload changed");
        return state.memories.find(m => m.id === previous.memoryId)!;
      }
      function remember(m: VaultMemory) {
        if (!operation) throw new Error("Missing operation ID");
        state.receipts[operation] = { command, payload, memoryId: m.id }; save(); return m;
      }
      if (command === "vault_capture") {
        if (control.cancelCapture) { control.cancelCapture = false; return null; }
        const id = crypto.randomUUID(); const source = await original(); state.sources[id] = source;
        const m: VaultMemory = { id, revision: 1, note: String(args.note), source_name: "SYNTHETIC-test-card.png", source_sha256: source.sha256, captured_at: now, updated_at: now, conflict: null, state: "active", note_path: "synthetic.md" };
        state.memories.push(m); state.history[m.id] = [{ revision: 1, note: m.note, recorded_at: now, origin: "human:recall", kind: "capture" }]; queueOrganization(m); return remember(m);
      }
      if (command === "vault_capture_text") {
        const text = String(args.text); if (!text.trim() || text.includes("\0")) throw new Error("Text must be non-empty and contain no NUL bytes");
        const bytes = Array.from(new TextEncoder().encode(text)); const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("");
        const id = crypto.randomUUID(); state.sources[id] = { bytes, mime_type: "text/plain", sha256: hash };
        const m: VaultMemory = { id, revision: 1, note: text, source_name: "note.txt", source_sha256: hash, captured_at: now, updated_at: now, conflict: null, state: "active", note_path: "synthetic.md" };
        state.memories.push(m); state.history[m.id] = [{ revision: 1, note: m.note, recorded_at: now, origin: "human:recall", kind: "capture" }]; queueOrganization(m); return remember(m);
      }
      if (command === "vault_import_text_file") {
        if (control.cancelFileImport) { control.cancelFileImport = false; return null; }
        const fileName = "SYNTHETIC-import.md";
        const text = "---\npermissions: all\n<script>window.syntheticExecuted = true</script>\n# SYNTHETIC imported text\n";
        const bytes = Array.from(new TextEncoder().encode(text));
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("");
        const id = crypto.randomUUID(); state.sources[id] = { bytes, mime_type: "text/plain; charset=utf-8", sha256: hash };
        const imported: VaultMemory = { id, revision: 1, note: text, source_name: fileName, source_sha256: hash, captured_at: now, updated_at: now, conflict: null, state: "active", note_path: "synthetic.md", imported_text: { original_name: fileName, original_extension: "md", source_media_type: "text/plain; charset=utf-8", semantic_sha256: hash, semantic_bytes: bytes.length, semantic_characters: text.length } };
        state.memories.push(imported); state.history[id] = [{ revision: 1, note: text, recorded_at: now, origin: "human:recall", kind: "capture" }]; queueOrganization(imported);
        const result = structuredClone(remember(imported));
        if (control.failFileImportAfterCommit) { control.failFileImportAfterCommit = false; throw new Error("SYNTHETIC import response was interrupted after commit"); }
        return result;
      }
      if (command === "vault_list") {
        if (control.diagnosticReading) return state.memories.map(m => ({ id: m.id, revision: 0, note: "", source_name: "", source_sha256: "", captured_at: "", updated_at: "", conflict: "SYNTHETIC memory authority unavailable", state: "conflict", note_path: null }));
        return projection(String(args.query), args.includeDeleted === true);
      }
      if (command === "vault_rebuild") {
        if (control.failRebuildOnce) { control.failRebuildOnce = false; throw new Error("SYNTHETIC rebuild unavailable"); }
        return projection("", args.includeDeleted === true);
      }
      const memory = state.memories.find(m => m.id === args.memoryId);
      if (["vault_correct", "vault_correct_reading", "vault_audio_correct", "vault_history", "vault_source", "vault_restore_note", "vault_remove"].includes(command) && !memory) throw new Error("Unknown memory ID");
      if (command === "vault_correct_reading") {
        const m = memory!; if (m.state !== "active" || m.conflict || !m.reading) throw new Error("Memory not eligible for reading correction");
        if (control.conflict) { control.conflict = false; m.note = "SYNTHETIC external annotation"; m.revision++; state.history[m.id]!.push({ revision: m.revision, note: m.note, reading: structuredClone(m.reading), recorded_at: now, origin: "human:obsidian", kind: "external" }); save(); throw new Error("Revision conflict: review latest reading"); }
        if (args.expectedRevision !== m.revision) throw new Error("Revision conflict");
        m.reading.human_correction = String(args.text); m.revision++; state.history[m.id]!.push({ revision: m.revision, note: m.note, reading: structuredClone(m.reading), recorded_at: now, origin: "human:recall", kind: "reading_correction" }); return remember(m);
      }
      if (command === "vault_audio_correct") {
        const m = memory!; if (m.state !== "active" || m.conflict || !m.audio_transcript) throw new Error("There is no machine transcript to correct yet");
        if (args.expectedRevision !== m.revision) throw new Error("Conflict: the recording changed. Refresh, review it, then retry your correction");
        m.audio_transcript.human_correction = { operation_id: String(args.operationId), text: String(args.text), corrected_at: now }; m.revision++;
        state.history[m.id]!.push({ revision: m.revision, note: "", recorded_at: now, origin: "human:recall", kind: "audio_transcript_correction" }); return remember(m);
      }
      if (command === "vault_correct") {
        const m = memory!;
        if (m.state !== "active" || m.conflict) throw new Error("Memory not eligible for correction");
        if (control.conflict) {
          control.conflict = false; m.note = "SYNTHETIC external Obsidian edit"; m.revision++;
          state.history[m.id]!.push({ revision: m.revision, note: m.note, recorded_at: now, origin: "human:obsidian", kind: "external" }); save(); throw new Error("Revision conflict: review latest note");
        }
        if (args.expectedRevision !== m.revision) throw new Error("Revision conflict");
        m.note = String(args.note); m.revision++; state.history[m.id]!.push({ revision: m.revision, note: m.note, ...(m.reading ? { reading: structuredClone(m.reading) } : {}), recorded_at: now, origin: "human:recall", kind: "correct" }); return remember(m);
      }
      if (command === "vault_restore_note" || command === "vault_remove") {
        const m = memory!;
        if (args.expectedRevision !== m.revision) throw new Error("Revision conflict");
        if (command === "vault_restore_note") {
          if (m.state !== "missing") throw new Error("Note is no longer missing");
          m.state = "active"; m.conflict = null; m.note_path = "SYNTHETIC-restored.md";
        } else {
          if (!["active", "missing"].includes(m.state) || args.expectedState !== m.state || (m.state === "active" && m.conflict)) throw new Error("Removal state changed");
          if (control.failRemovalOnce) { control.failRemovalOnce = false; throw new Error("SYNTHETIC removal interrupted"); }
          m.state = "deleted"; m.conflict = null;
        }
        m.revision++;
        state.history[m.id]!.push({ revision: m.revision, note: m.note, ...(m.reading ? { reading: structuredClone(m.reading) } : {}), recorded_at: now, origin: "human:recall", kind: command === "vault_remove" ? "remove" : "restore" });
        // Commit before delaying the reply; vault selection may change while IPC is in flight.
        const result = structuredClone(remember(m));
        if (command === "vault_remove" && control.delayRemoval) {
          control.removalPending = true; await new Promise<void>(resolve => { control.releaseRemoval = resolve; });
        }
        return result;
      }
      if (command === "vault_history") return state.history[memory!.id];
      if (command === "vault_source") {
        if (memory!.state !== "active" || memory!.conflict) throw new Error("Memory evidence unavailable");
        const source = state.sources[memory!.id] ?? await original();
        if (control.delaySource) { control.sourcePending = true; await new Promise<void>(resolve => { control.releaseSource = resolve; }); }
        return source;
      }
      throw new Error(`Unexpected native command: ${command}`);
    }
    // Tauri IPC transfers values, not references into the native store.
    Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string, args?: Record<string, unknown>) => structuredClone(await invoke(command, args)) } });
  });
}
export async function control(page: Page, values: Record<string, boolean>) {
  await page.evaluate(values => Object.assign((window as unknown as { syntheticVault: object }).syntheticVault, values), values);
}
export async function finishOrganization(page: Page, memoryId: string) {
  await page.evaluate(memoryId => (window as unknown as { syntheticVault: { finishOrganization: (id: string) => void } }).syntheticVault.finishOrganization(memoryId), memoryId);
}
export async function finishAudioOrganization(page: Page, memoryId: string) {
  await page.evaluate(memoryId => (window as unknown as { syntheticVault: { finishAudioOrganization: (id: string) => void } }).syntheticVault.finishAudioOrganization(memoryId), memoryId);
}
export async function relateToMemory(page: Page, memoryId: string) {
  await page.evaluate(memoryId => { (window as unknown as { syntheticVault: { relatedTargetId: string | null } }).syntheticVault.relatedTargetId = memoryId; }, memoryId);
}
