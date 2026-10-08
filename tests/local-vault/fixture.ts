import type { Page } from "@playwright/test";
import type { VaultMemory, VaultRevision, VaultStatus } from "../../apps/desktop/src/platform/local-vault";

// Test-only native command boundary. This is neither a filesystem nor a production mode.
// Browser storage below simulates native restart; Rust tests establish real disk durability.
export async function installVaultFixture(page: Page) {
  await page.addInitScript(() => {
    const key = "synthetic.test.native";
    type State = { status: VaultStatus; memories: VaultMemory[]; history: Record<string, VaultRevision[]> };
    const empty: State = { status: { root: null, vault_id: null, vault_identity: null }, memories: [], history: {} };
    const state: State = JSON.parse(localStorage.getItem(key) || JSON.stringify(empty));
    const control = { cancelCapture: false, cancelSelect: false, conflict: false, switchVault: false, delaySource: false, sourcePending: false, releaseSource: () => {}, calls: [] as { command: string; args: Record<string, unknown> }[] };
    Object.assign(window, { syntheticVault: control });
    const save = () => localStorage.setItem(key, JSON.stringify(state));
    const now = "2026-10-08T12:00:00Z";
    async function original() {
        // Generate visibly synthetic PNG bytes in test code, never the application.
        const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 420;
        const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fff8df"; ctx.fillRect(0, 0, 720, 420);
        ctx.fillStyle = "#263b31"; ctx.font = "bold 32px sans-serif"; ctx.fillText("SYNTHETIC TEST CARD", 40, 90);
        ctx.font = "24px sans-serif"; ctx.fillText("Garden workshop · example only", 40, 160); ctx.fillText("No personal or customer information", 40, 230);
        const bytes = Array.from(atob(canvas.toDataURL("image/png").split(",")[1]!), c => c.charCodeAt(0));
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("");
        return { bytes, mime_type: "image/png", sha256: hash };
    }
    Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, unknown> = {}) => {
      control.calls.push({ command, args });
      if (command === "vault_status") return state.status;
      if (command === "vault_select") {
        if (control.cancelSelect) { control.cancelSelect = false; return null; }
        const id = control.switchVault ? "b" : "a";
        state.status = { root: `/synthetic/vault-${id}`, vault_id: crypto.randomUUID(), vault_identity: `synthetic-${id}` };
        if (control.switchVault) { state.memories = []; state.history = {}; }
        save(); return state.status;
      }
      if (args.expectedVaultId !== state.status.vault_id) throw new Error("Stale vault session");
      if (command === "vault_capture") {
        if (control.cancelCapture) { control.cancelCapture = false; return null; }
        const m: VaultMemory = { id: crypto.randomUUID(), revision: 1, note: String(args.note), source_name: "SYNTHETIC-test-card.png", source_sha256: (await original()).sha256, captured_at: now, updated_at: now, conflict: null };
        state.memories.push(m); state.history[m.id] = [{ revision: 1, note: m.note, recorded_at: now, origin: "human:recall" }]; save(); return m;
      }
      if (command === "vault_list") {
        const terms = String(args.query).toLowerCase().split(/\s+/).filter(Boolean);
        return state.memories.filter(m => terms.length === 0 || (m.conflict === null && terms.every(term => m.note.toLowerCase().includes(term) || m.source_name.toLowerCase().includes(term))));
      }
      const memory = state.memories.find(m => m.id === args.memoryId);
      if (["vault_correct", "vault_history", "vault_source"].includes(command) && !memory) throw new Error("Unknown memory ID");
      if (command === "vault_correct") {
        const m = memory!;
        if (control.conflict) {
          control.conflict = false; m.note = "SYNTHETIC external Obsidian edit"; m.revision++;
          state.history[m.id]!.push({ revision: m.revision, note: m.note, recorded_at: now, origin: "human:obsidian" }); save(); throw new Error("Revision conflict: review latest note");
        }
        if (args.expectedRevision !== m.revision) throw new Error("Revision conflict");
        m.note = String(args.note); m.revision++; state.history[m.id]!.push({ revision: m.revision, note: m.note, recorded_at: now, origin: "human:recall" }); save(); return m;
      }
      if (command === "vault_history") return state.history[memory!.id];
      if (command === "vault_source") {
        if (memory!.conflict) throw new Error("Memory evidence unavailable");
        const source = await original();
        if (control.delaySource) { control.sourcePending = true; await new Promise<void>(resolve => { control.releaseSource = resolve; }); }
        return source;
      }
      throw new Error(`Unexpected native command: ${command}`);
    } } });
  });
}
export async function control(page: Page, values: Record<string, boolean>) {
  await page.evaluate(values => Object.assign((window as unknown as { syntheticVault: object }).syntheticVault, values), values);
}
