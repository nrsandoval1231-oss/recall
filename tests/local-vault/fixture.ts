import type { Page } from "@playwright/test";
import type { ReadingOperation, VaultMemory, VaultReading, VaultRevision, VaultStatus } from "../../apps/desktop/src/platform/local-vault";

// Test-only native command boundary. This is neither a filesystem nor a production mode.
// Browser storage below simulates native restart; Rust tests establish real disk durability.
export async function installVaultFixture(page: Page) {
  await page.addInitScript(() => {
    const key = "synthetic.test.native";
    type Receipt = { command: string; payload: string; memoryId: string };
    type State = { status: VaultStatus; memories: VaultMemory[]; history: Record<string, VaultRevision[]>; receipts: Record<string, Receipt>; readings: Record<string, ReadingOperation> };
    const empty: State = { status: { root: null, vault_id: null, vault_identity: null }, memories: [], history: {}, receipts: {}, readings: {} };
    const state: State = JSON.parse(localStorage.getItem(key) || JSON.stringify(empty));
    state.receipts ??= {};
    state.readings ??= {};
    const control = { diagnosticReading: false, readingEnabled: false, delayReading: false, readingPending: false, releaseReading: () => {}, unknownReading: false, failRemovalOnce: false, failRebuildOnce: false, delayRemoval: false, removalPending: false, releaseRemoval: () => {}, cancelCapture: false, cancelSelect: false, conflict: false, switchVault: false, delaySource: false, sourcePending: false, releaseSource: () => {}, calls: [] as { command: string; args: Record<string, unknown> }[] };
    Object.assign(window, { syntheticVault: control });
    const save = () => localStorage.setItem(key, JSON.stringify(state));
    const now = "2026-10-08T12:00:00Z";
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
        if (terms.length) return m.state === "active" && m.conflict === null && terms.every(term => [m.note, m.reading?.human_correction ?? m.reading?.machine.result.extraction.pages[0]?.transcription ?? "", m.source_name, m.note_path ?? ""].some(field => field.toLowerCase().includes(term)));
        return includeDeleted || m.state !== "deleted";
      }).sort((a, b) => a.id.localeCompare(b.id));
    }
    async function invoke(command: string, args: Record<string, unknown> = {}) {
      control.calls.push({ command, args });
      if (command === "vault_status") return state.status;
      if (command === "vault_select") {
        if (control.cancelSelect) { control.cancelSelect = false; return null; }
        const id = control.switchVault ? "b" : "a";
        state.status = { root: `/synthetic/vault-${id}`, vault_id: crypto.randomUUID(), vault_identity: `synthetic-${id}` };
        for (const op of Object.values(state.readings)) if (!["committed", "cancelled", "failed", "expired"].includes(op.state)) op.state = "cancelled";
        if (control.switchVault) { state.memories = []; state.history = {}; state.receipts = {}; state.readings = {}; }
        save(); return state.status;
      }
      if (args.expectedVaultId !== state.status.vault_id) throw new Error("Stale vault session");
      if (command === "vault_reading_capability") return { enabled: control.readingEnabled, explanation: control.readingEnabled ? "SYNTHETIC configured connection" : "No private service connection has been installed." };
      if (command === "vault_reading_operations") return Object.values(state.readings).filter(op => op.memory_id === args.memoryId);
      if (command === "vault_cancel_reading") {
        const id = String(args.operationId); const op = state.readings[id] ?? { operation_id: id, memory_id: "", expected_revision: 0, state: "prepared", may_have_been_sent: false, error_code: null };
        if (op.state !== "committed") op.state = "cancelled"; state.readings[id] = op; save(); return op;
      }
      if (command === "vault_read_photo" || command === "vault_recover_reading") {
        if (!control.readingEnabled) throw new Error("SYNTHETIC service not connected");
        const id = String(args.operationId); const existing = state.readings[id];
        if (existing?.state === "cancelled") return { operation: existing, memory: null };
        const m = state.memories.find(m => m.id === (existing?.memory_id ?? args.memoryId)); if (!m) throw new Error("Unknown reading memory");
        if (existing?.state === "committed") return { operation: existing, memory: m };
        if (m.state !== "active" || m.conflict || (existing?.expected_revision ?? args.expectedRevision) !== m.revision) throw new Error("Reading revision or state changed");
        const op: ReadingOperation = existing ?? { operation_id: id, memory_id: m.id, expected_revision: m.revision, state: "prepared", may_have_been_sent: false, error_code: null };
        state.readings[id] = op; op.may_have_been_sent = true; op.state = "in_flight"; save();
        const token = state.status.vault_id;
        if (control.delayReading) { control.readingPending = true; await new Promise<void>(resolve => { control.releaseReading = resolve; }); }
        if (token !== state.status.vault_id || state.readings[id]!.state === "cancelled") throw new Error("SYNTHETIC reading cancelled or stale");
        if (control.unknownReading && command === "vault_read_photo") { control.unknownReading = false; op.state = "unknown"; save(); return { operation: op, memory: null }; }
        const hash = m.source_sha256;
        const reading: VaultReading = { machine: { request: { binding: { schema_version: "1.0", operation_id: id, vault_id: state.status.vault_identity!, memory_id: m.id, source_id: m.id, source_sha256: hash, expected_revision: op.expected_revision, captured_at: m.captured_at }, media_type: "image/png" }, result: { provider: "anthropic", model_id: "synthetic-claude", review_state: "unreviewed", input_manifest_sha256: "b".repeat(64), derivative: { sha256: "c".repeat(64), transform_version: "jpeg-rgb-exif-orient-v1", media_type: "image/jpeg" }, extraction: { schema_version: "1.1", capture_id: id, input_manifest_sha256: "b".repeat(64), summary: null, summary_evidence: [], pages: [{ page_id: m.id, ordinal: 1, transcription: "SYNTHETIC seedlings 12?", legibility: "mixed" }], mentions: [], statements: [], action_suggestions: [], uncertainties: [{ kind: "illegible", description: "The number may be 12; the question mark remains unresolved.", evidence: [{ page_id: m.id, quote: "12?" }] }] }, validation_notes: [] } }, human_correction: m.reading?.human_correction ?? null };
        m.reading = reading; m.revision++; op.state = "committed"; state.history[m.id]!.push({ revision: m.revision, note: m.note, reading: structuredClone(reading), recorded_at: now, origin: "machine:anthropic", kind: "machine_reading" }); save(); return { operation: op, memory: m };
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
        const m: VaultMemory = { id: crypto.randomUUID(), revision: 1, note: String(args.note), source_name: "SYNTHETIC-test-card.png", source_sha256: (await original()).sha256, captured_at: now, updated_at: now, conflict: null, state: "active", note_path: "synthetic.md" };
        state.memories.push(m); state.history[m.id] = [{ revision: 1, note: m.note, recorded_at: now, origin: "human:recall", kind: "capture" }]; return remember(m);
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
      if (["vault_correct", "vault_correct_reading", "vault_history", "vault_source", "vault_restore_note", "vault_remove"].includes(command) && !memory) throw new Error("Unknown memory ID");
      if (command === "vault_correct_reading") {
        const m = memory!; if (m.state !== "active" || m.conflict || !m.reading) throw new Error("Memory not eligible for reading correction");
        if (control.conflict) { control.conflict = false; m.note = "SYNTHETIC external annotation"; m.revision++; state.history[m.id]!.push({ revision: m.revision, note: m.note, reading: structuredClone(m.reading), recorded_at: now, origin: "human:obsidian", kind: "external" }); save(); throw new Error("Revision conflict: review latest reading"); }
        if (args.expectedRevision !== m.revision) throw new Error("Revision conflict");
        m.reading.human_correction = String(args.text); m.revision++; state.history[m.id]!.push({ revision: m.revision, note: m.note, reading: structuredClone(m.reading), recorded_at: now, origin: "human:recall", kind: "reading_correction" }); return remember(m);
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
        const source = await original();
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
