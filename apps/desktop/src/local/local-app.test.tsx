// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopEntry } from "../entry";
import { operationLabel } from "./Organization";
import type { AskOutcome, LocalVault, OrganizationCapability, OrganizationOperation, OrganizationProposal, VaultMemory, VaultStatus } from "../platform/local-vault";

const selected: VaultStatus = { root: "/synthetic/vault", vault_id: "session-a", vault_identity: "manifest-a" };
const memory: VaultMemory = { id: "m1", revision: 1, note: "Synthetic garden note", source_name: "synthetic.png", source_sha256: "hash", captured_at: "2026-10-08T12:00:00Z", updated_at: "2026-10-08T12:00:00Z", conflict: null, state: "active", note_path: "renamed-garden.md" };
function vault(over: Partial<LocalVault> = {}): LocalVault {
  const capability = (enabled = false): OrganizationCapability => ({ schema_version: "1.0", scope: "vault_intelligence", purpose: "organize", vault_id: "manifest-a", policy_version: "organize-v1|synthetic", provider: "anthropic", consent: enabled ? "active" : "missing", enabled, consent_epoch: enabled ? 1 : 0, decided_at: enabled ? "2026-10-09T12:00:00Z" : null, local_readiness: enabled ? "ready" : "off", automatic_enabled: enabled });
  return { organizationCapability: vi.fn(async () => capability()), setOrganizationConsent: vi.fn(async (_v, enabled) => capability(enabled)), reconcileOrganizationConsent: vi.fn(async () => capability(true)), organizationOperations: vi.fn(async () => [] as OrganizationOperation[]), recoverOrganization: vi.fn(async (_v, operationId) => ({ operation_id: operationId, memory_id: memory.id, state: "unknown" as const, error_code: null })), processPendingOrganization: vi.fn(async () => {}), relatedMemory: vi.fn(async () => { throw new Error("Related memory verification is unavailable"); }), readingCapability: vi.fn(async () => ({ enabled: false, explanation: "Not connected" })), readingOperations: vi.fn(async () => []), readPhoto: vi.fn(async () => { throw new Error("Not connected"); }), recoverReading: vi.fn(async () => { throw new Error("Not connected"); }), cancelReading: vi.fn(async () => { throw new Error("No operation"); }), correctReading: vi.fn(async () => memory), askCapability: vi.fn(async () => ({ enabled: false, scope: "vault_intelligence" as const, consent: "missing" as const, explanation: "Ask consent is missing; local keyword search remains available." })), ask: vi.fn(async (_vault, operationId) => ({ operation: { operation_id: operationId, state: "failed" as const, error_code: "ASK_UNAVAILABLE" }, answer: null })), recoverAsk: vi.fn(async (_vault, operationId) => ({ operation: { operation_id: operationId, state: "failed" as const, error_code: "ASK_OPERATION_NOT_FOUND" }, answer: null })), intelligencePairingPrepare: vi.fn(async () => ({ state: "pending_owner_approval" as const, device_id: "synthetic-device", vault_id: "session-a", fingerprint: null, scope: "vault_intelligence" as const })), intelligencePairingClaim: vi.fn(async () => ({ state: "connected" as const, device_id: "synthetic-device", vault_id: "session-a", fingerprint: "synthetic", scope: "vault_intelligence" as const })), intelligencePairingStatus: vi.fn(async () => ({ state: "disconnected" as const, device_id: null, vault_id: "session-a", fingerprint: null, scope: "vault_intelligence" as const })), intelligencePairingDisconnect: vi.fn(async () => ({ state: "disconnected" as const, device_id: null, vault_id: "session-a", fingerprint: null, scope: "vault_intelligence" as const })), available: true, status: vi.fn(async () => selected), select: vi.fn(async () => selected), capture: vi.fn(async () => memory), list: vi.fn(async () => [memory]), correct: vi.fn(async (_s, _id, _r, _op, note) => ({ ...memory, note, revision: 2 })), source: vi.fn(async () => ({ bytes: [137,80,78,71], mime_type: "image/png", sha256: "hash" })), history: vi.fn(async () => [{ revision: 1, note: memory.note, recorded_at: memory.captured_at, origin: "human:recall" as const, kind: "capture" as const }]), rebuild: vi.fn(async () => [memory]), restoreNote: vi.fn(async () => ({ ...memory, revision: 2 })), remove: vi.fn(async () => ({ ...memory, state: "deleted" as const, revision: 2 })), ...over };
}
const mount = (v: LocalVault) => render(<DesktopEntry vault={v} search="" />);
async function clickTool(name: "Removed items" | "Rebuild local search") { const details = Array.from(document.querySelectorAll("details.local-tools")).find(el => el.querySelector("summary")?.textContent === "Memory tools") as HTMLDetailsElement; if (!details.open) await userEvent.click(screen.getByText("Memory tools", { exact: true })); await userEvent.click(screen.getByRole("button", { name })); }

it.each([null, "Obsidian note changed outside Recall"]) ("shows unresolved related-link repair status independently of note conflict (%s)", async conflict => {
  const repairPending: VaultMemory = { ...memory, context_repair_pending: true, ...(conflict ? { state: "conflict" as const, conflict } : {}) };
  mount(vault({ list: vi.fn(async () => [repairPending]) }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  expect((await screen.findByRole("status")).textContent).toContain("A related link changed. Recall could not update the Obsidian note.");
  if (conflict) expect(screen.getByRole("alert").textContent).toContain(conflict);
});

it("saves exact text with a durable retry identity and shows its immutable original as inert text", async () => {
  const textMemory: VaultMemory = { ...memory, id: "text-memory", note: "  A thought\nwith a second line.  ", source_name: "note.txt" };
  const captureText = vi.fn().mockRejectedValueOnce(new Error("Temporary vault interruption")).mockResolvedValue(textMemory);
  const v = vault({ captureText, list: vi.fn(async () => [textMemory]), source: vi.fn(async () => ({ bytes: Array.from(new TextEncoder().encode(textMemory.note)), mime_type: "text/plain", sha256: textMemory.source_sha256 })) });
  const first = mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Write a note" }));
  await userEvent.type(screen.getByLabelText("Your note"), textMemory.note);
  await userEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByText("Temporary vault interruption");
  first.unmount();
  mount(v);
  expect(await screen.findByRole("button", { name: "Retry pending capture" })).toBeTruthy();
  expect((screen.getByLabelText("Your note") as HTMLTextAreaElement).value).toBe(textMemory.note);
  await userEvent.click(screen.getByRole("button", { name: "Retry pending capture" }));
  await screen.findByRole("button", { name: /A thought/ });
  expect(captureText).toHaveBeenCalledTimes(2);
  expect(captureText.mock.calls[0]).toEqual(captureText.mock.calls[1]);
  expect(captureText.mock.calls[0]?.[0]).toBe("session-a");
  expect(captureText.mock.calls[0]?.[2]).toBe(textMemory.note);
  expect(screen.queryByText(/Photo processed with Claude/)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /A thought/ }));
  expect(screen.queryByRole("button", { name: "Read this photo with Claude" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "View original" }));
  expect(await screen.findByLabelText("Original text")).toBeTruthy();
  expect(screen.getByLabelText("Original text").textContent).toBe(textMemory.note);
  expect(screen.queryByRole("img", { name: "Original photo" })).toBeNull();
});

it("titles text memories from a bounded first nonempty human line and retains the original filename", async () => {
  const longTitle = "A very long human-written heading that should be bounded without changing the stored note. ".repeat(2);
  const textMemory: VaultMemory = { ...memory, id: "heading-text", note: `\n   ${longTitle}\nA second line`, source_name: "original-note.txt" };
  mount(vault({ list: vi.fn(async () => [textMemory]) }));
  await userEvent.click(await screen.findByRole("button", { name: /A very long human-written heading/ }));
  const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
  expect(heading.startsWith("A very long human-written heading")).toBe(true);
  expect(Array.from(heading)).toHaveLength(100);
  expect(heading.endsWith("…")).toBe(true);
  await userEvent.click(screen.getByText("Note details", { exact: true }));
  expect(screen.getByText("Original file · original-note.txt")).toBeTruthy();
  expect(textMemory.note).toContain("A second line");
});

it("uses a plain fallback heading when a text note has no nonempty line", async () => {
  const textMemory: VaultMemory = { ...memory, id: "blank-heading-text", note: " \n\t\n", source_name: "blank.txt" };
  mount(vault({ list: vi.fn(async () => [textMemory]) }));
  await userEvent.click(await screen.findByRole("button", { name: /Saved in vault/ }));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Text note");
});

it("imports one native-picked Markdown file with a stable retry ID and renders its original inertly", async () => {
  const original = "---\npermissions: all\n<script>window.bad = true</script>\n# Synthetic source\n";
  const imported: VaultMemory = { ...memory, id: "imported-markdown", note: original, source_name: "notes.md", imported_text: { original_name: "notes.md", original_extension: "md", source_media_type: "text/plain; charset=utf-8", semantic_sha256: "semantic-hash", semantic_bytes: new TextEncoder().encode(original).length, semantic_characters: original.length } };
  const importTextFile = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Temporary vault interruption")).mockResolvedValue(imported);
  const source = vi.fn(async () => ({ bytes: Array.from(new TextEncoder().encode(original)), mime_type: "text/plain; charset=utf-8", sha256: memory.source_sha256 }));
  const v = vault({ importTextFile, source, list: vi.fn(async () => [imported]) });
  const first = mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Import text file" }));
  expect(importTextFile).toHaveBeenCalledWith("session-a", expect.any(String));
  const operationId = importTextFile.mock.calls[0]?.[1];
  expect((await screen.findByRole("status")).textContent).toContain("File selection cancelled");
  expect(localStorage.getItem(`recall.local.capture:${JSON.stringify([selected.root, selected.vault_identity])}`)).toContain(operationId);
  first.unmount(); mount(v);
  expect(await screen.findByRole("button", { name: "Retry text file import" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retry text file import" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Temporary vault interruption");
  expect(importTextFile.mock.calls[1]).toEqual(importTextFile.mock.calls[0]);
  await userEvent.click(screen.getByRole("button", { name: "Retry text file import" }));
  await screen.findByRole("button", { name: /Synthetic source/ });
  expect(importTextFile.mock.calls[2]).toEqual(importTextFile.mock.calls[0]);
  await userEvent.click(screen.getByRole("button", { name: /Synthetic source/ }));
  expect(screen.getByText(/shown as inert plain text/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Read this photo with Claude" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "View original" }));
  expect((await screen.findByLabelText("Original text")).textContent).toBe(original);
  expect(document.querySelector("script")).toBeNull();
  const download = screen.getByRole("link", { name: "Download original · notes.md" }) as HTMLAnchorElement;
  expect(download.download).toBe("notes.md");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("notes.md");
});

it("reports an imported file over the organizer threshold as saved locally with processing skipped", async () => {
  const imported: VaultMemory = { ...memory, id: "oversize-text", source_name: "large.txt", note: "Large synthetic source", imported_text: { original_name: "large.txt", original_extension: "txt", source_media_type: "text/plain; charset=utf-8", semantic_sha256: "semantic-hash", semantic_bytes: 120001, semantic_characters: 30001 } };
  const organizationOperations = vi.fn(async () => [{ operation_id: "org-large", memory_id: imported.id, state: "failed" as const, error_code: "INPUT_LIMIT_EXCEEDED" }]);
  mount(vault({ importTextFile: vi.fn(async () => imported), organizationOperations }));
  await userEvent.click(await screen.findByRole("button", { name: "Import text file" }));
  expect((await screen.findByRole("status")).textContent).toMatch(/Saved large\.txt.*skipped because the file exceeds the 30,000-character or 120,000-byte limit/);
  expect((await screen.findByRole("status")).textContent).not.toContain("Automatic organization failed");
});

it("does not publish a late imported-file result after switching vaults", async () => {
  let finish!: (result: VaultMemory | null) => void;
  const next: VaultStatus = { root: "/synthetic/vault-b", vault_id: "session-b", vault_identity: "manifest-b" };
  const importTextFile = vi.fn(() => new Promise<VaultMemory | null>(resolve => { finish = resolve; }));
  const v = vault({ importTextFile, select: vi.fn(async () => next) }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Import text file" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await screen.findByText("/synthetic/vault-b");
  await act(async () => finish({ ...memory, id: "late-import", source_name: "late.md", imported_text: { original_name: "late.md", original_extension: "md", source_media_type: "text/plain; charset=utf-8", semantic_sha256: "x", semantic_bytes: 1, semantic_characters: 1 } }));
  expect(screen.queryByText(/late\.md/)).toBeNull();
  expect(screen.getByText("/synthetic/vault-b")).toBeTruthy();
});

beforeEach(() => { localStorage.clear(); URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn(); });
afterEach(cleanup);

it("remembers separate organization consent with a provider disclosure and explicit revoke", async () => {
  const v = vault(); mount(v);
  await userEvent.click(await screen.findByText("Automatically organize new notes and photos", { exact: true }));
  await waitFor(() => expect(document.querySelector("details.local-organization-settings p")?.textContent).toMatch(/notes and photos you save from then on, plus up to three short excerpts.*sent to Anthropic Claude/i));
  expect(screen.getByText(/Older captures are not processed/i)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
  expect(await screen.findByText(/Automatic organization is on/)).toBeTruthy();
  expect(v.setOrganizationConsent).toHaveBeenCalledWith("session-a", true, 0);
  await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
  expect(v.setOrganizationConsent).toHaveBeenLastCalledWith("session-a", false, 1);
});

it("keeps an active organization permission revocable when its provider is temporarily unavailable", async () => {
  const active: OrganizationCapability = { schema_version: "1.0", scope: "vault_intelligence", purpose: "organize", vault_id: "manifest-a", policy_version: "organize-v1|synthetic", provider: null, consent: "active", enabled: false, consent_epoch: 3, decided_at: "2026-10-09T12:00:00Z", local_readiness: "ready", automatic_enabled: false };
  const revoked: OrganizationCapability = { ...active, consent: "missing", consent_epoch: 4, decided_at: null, local_readiness: "off", automatic_enabled: false };
  const v = vault({ organizationCapability: vi.fn(async () => active), setOrganizationConsent: vi.fn(async () => revoked) }); mount(v);
  await userEvent.click(await screen.findByText("Automatically organize new notes and photos", { exact: true }));
  expect(await screen.findByText(/permission is saved, but organization is unavailable right now/i)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Turn off" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
  expect(v.setOrganizationConsent).toHaveBeenCalledWith("session-a", false, 3);
});

it("does not let a late organization setting response cross a vault switch", async () => {
  let resolveFirst!: (value: OrganizationCapability) => void;
  const next: VaultStatus = { root: "/synthetic/vault-b", vault_id: "session-b", vault_identity: "manifest-b" };
  const capability = (vaultId: string, provider: OrganizationCapability["provider"]): OrganizationCapability => ({ schema_version: "1.0", scope: "vault_intelligence", purpose: "organize", vault_id: vaultId, policy_version: "organize-v1|synthetic", provider, consent: "missing", enabled: false, consent_epoch: 0, decided_at: null, local_readiness: "off", automatic_enabled: false });
  const organizationCapability = vi.fn().mockImplementationOnce(() => new Promise<OrganizationCapability>(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce(capability("manifest-b", null));
  const v = vault({ organizationCapability, select: vi.fn(async () => next) }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Switch vault" }));
  await screen.findByText("/synthetic/vault-b");
  await userEvent.click(await screen.findByText("Automatically organize new notes and photos", { exact: true }));
  expect(await screen.findByText("No organization provider is configured. New captures stay local.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement).disabled).toBe(true);
  resolveFirst(capability("manifest-a", "anthropic"));
  await waitFor(() => expect((screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByText("No organization provider is configured. New captures stay local.")).toBeTruthy();
});

it("enables future organization in the same consent decision", async () => {
  const ready: OrganizationCapability = { schema_version: "1.0", scope: "vault_intelligence", purpose: "organize", vault_id: "manifest-a", policy_version: "organize-v1|synthetic", provider: "anthropic", consent: "active", enabled: true, consent_epoch: 5, decided_at: "2026-10-09T12:00:00Z", local_readiness: "ready", automatic_enabled: true };
  let current: OrganizationCapability = { ...ready, consent: "missing", enabled: false, consent_epoch: 4, decided_at: null, local_readiness: "off", automatic_enabled: false };
  const v = vault({ organizationCapability: vi.fn(async () => current), setOrganizationConsent: vi.fn(async () => { current = ready; return current; }) }); mount(v);
  await userEvent.click(await screen.findByText("Automatically organize new notes and photos", { exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
  expect(await screen.findByText(/Automatic organization is on/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Finish setup" })).toBeNull();
  expect(v.reconcileOrganizationConsent).not.toHaveBeenCalled();
  expect(v.setOrganizationConsent).toHaveBeenCalledWith("session-a", true, 4);
});

it("keeps unresolved local setup honest, offers reconciliation and still allows revocation", async () => {
  const unknown: OrganizationCapability = { schema_version: "1.0", scope: "vault_intelligence", purpose: "organize", vault_id: "manifest-a", policy_version: "organize-v1|synthetic", provider: "anthropic", consent: "active", enabled: true, consent_epoch: 6, decided_at: "2026-10-09T12:00:00Z", local_readiness: "unknown", automatic_enabled: false };
  const ready = { ...unknown, local_readiness: "ready" as const, automatic_enabled: true };
  let current: OrganizationCapability = unknown;
  const v = vault({ organizationCapability: vi.fn(async () => current), reconcileOrganizationConsent: vi.fn(async () => { current = ready; return current; }) }); mount(v);
  await userEvent.click(await screen.findByText("Automatically organize new notes and photos", { exact: true }));
  expect(await screen.findByText(/device’s setup status is unknown/i)).toBeTruthy();
  expect(screen.queryByText(/Automatic organization is on/)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByText(/Automatic organization is on/)).toBeTruthy();
  expect(v.reconcileOrganizationConsent).toHaveBeenCalledWith("session-a");
  expect((screen.getByRole("button", { name: "Turn off" }) as HTMLButtonElement).disabled).toBe(false);
});

it("rejects a server capability or consent response carrying the invocation token instead of stable vault identity", async () => {
  const wrong: OrganizationCapability = { schema_version: "1.0", scope: "vault_intelligence", purpose: "organize", vault_id: "session-a", policy_version: "organize-v1|synthetic", provider: "anthropic", consent: "missing", enabled: false, consent_epoch: 0, decided_at: null, local_readiness: "off", automatic_enabled: false };
  const wrongResponse: OrganizationCapability = { ...wrong, consent: "active", enabled: true, local_readiness: "ready", automatic_enabled: true };
  const v = vault({ organizationCapability: vi.fn(async () => wrong), setOrganizationConsent: vi.fn(async () => wrongResponse) }); mount(v);
  await userEvent.click(await screen.findByText("Automatically organize new notes and photos", { exact: true }));
  expect((await screen.findByRole("alert")).textContent).toContain("does not match this vault");
  expect((screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  const correct = { ...wrong, vault_id: "manifest-a" };
  const wrongSet: OrganizationCapability = { ...correct, vault_id: "session-a", consent: "active", enabled: true, local_readiness: "ready", automatic_enabled: true };
  const second = vault({ organizationCapability: vi.fn(async () => correct), setOrganizationConsent: vi.fn(async () => wrongSet) }); mount(second);
  await userEvent.click(await screen.findByText("Automatically organize new notes and photos", { exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
  expect((await screen.findByRole("alert")).textContent).toContain("does not match this vault");
  expect(screen.queryByText(/Automatic organization is on/)).toBeNull();
  expect(second.setOrganizationConsent).toHaveBeenCalledWith("session-a", true, 0);
});

it("confirms a capture before organization finishes and keeps another capture available", async () => {
  const textMemory: VaultMemory = { ...memory, id: "future-text", source_name: "note.txt", note: "A thought" };
  const operations = vi.fn(async () => [{ operation_id: "org-op", memory_id: textMemory.id, state: "queued" as const, error_code: null }]);
  const v = vault({ captureText: vi.fn(async () => textMemory), list: vi.fn(async () => [textMemory]), organizationOperations: operations });
  mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Write a note" }));
  await userEvent.type(screen.getByLabelText("Your note"), textMemory.note);
  await userEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(await screen.findByText(/waiting for organization/i)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Capture" }) as HTMLButtonElement).disabled).toBe(false);
  expect(v.processPendingOrganization).toHaveBeenCalled();
  expect(v.captureText).toHaveBeenCalledWith("session-a", expect.any(String), textMemory.note);
});

it("shows effective organization with uncertainty, attribution, time and source quotes, while honoring suppression", async () => {
  const proposal: OrganizationProposal = { binding: { schema_version: "2.0", operation_id: "org-1", vault_id: "manifest-a", memory_id: memory.id, source_kind: "photo", source_sha256: memory.source_sha256, expected_revision: 1, input_sha256: memory.source_sha256, consent_epoch: 1, captured_at: memory.captured_at, context_coverage: { eligible_count: 2, selected_count: 1, limited: true, truncated_count: 1 } }, media_type: "image/png", payload_sha256: "synthetic", result: { provider: "anthropic", model_id: "synthetic-model", input_manifest_sha256: "synthetic", extraction: { summary: "Synthetic summary", summary_evidence: [{ page_id: memory.id, quote: "garden note?" }], statements: [{ epistemic_state: "question", text: "Was the shed built in 2021?", attribution_text: "Nick wondered", temporal_text: "last spring", evidence: [{ page_id: memory.id, quote: "shed maybe 2021?" }] }], uncertainties: [{ kind: "unknown", description: "The year is uncertain", evidence: [{ page_id: memory.id, quote: "2021?" }] }] }, validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed: false };
  const v = vault({ list: vi.fn(async () => [{ ...memory, organization: proposal }]) }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  expect(await screen.findByRole("heading", { name: "AI suggestion · not confirmed" })).toBeTruthy();
  expect(screen.getByText(/Question · Was the shed built in 2021\?/)).toBeTruthy();
  expect(screen.getByText(/Nick wondered/)).toBeTruthy();
  expect(screen.getByText(/last spring/)).toBeTruthy();
  expect(screen.getByText(/Source: shed maybe 2021\?/)).toBeTruthy();
  expect(screen.getByText(/The year is uncertain/)).toBeTruthy();
  expect(screen.getByText(/Unclear · The year is uncertain/)).toBeTruthy();
  expect(screen.getByLabelText("Related memory coverage").textContent).toMatch(/considered 1 of 2 current memories/);
  expect(screen.getByLabelText("Related memory coverage").textContent).toMatch(/more memories were available/i);
  expect(screen.getByLabelText("Related memory coverage").textContent).toMatch(/1 excerpt was shortened/i);
  expect(screen.queryByText(/Kind: unknown/)).toBeNull();
  expect(screen.getAllByRole("button", { name: "View original" })).toHaveLength(1);
  expect(document.querySelector("script")).toBeNull();
  cleanup();
  mount(vault({ list: vi.fn(async () => [{ ...memory, organization: { ...proposal, suppressed: true } }]) }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  expect(await screen.findByRole("heading", { name: "synthetic.png" })).toBeTruthy();
  expect(screen.queryByText("Synthetic summary")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" }));
  await userEvent.type(screen.getByLabelText("Search notes and filenames"), "Synthetic summary");
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText(/No matching notes or filenames/)).toBeTruthy();
});

it("opens a related memory only after rechecking the selected session, link and original", async () => {
  const target: VaultMemory = { ...memory, id: "target-2", note: "Synthetic backup power note", source_name: "backup.txt", source_sha256: "target-hash" };
  const link = { target_memory_id: target.id, label: "Possibly related (unreviewed)" as const, source_quote: "backup power", target_quote: "backup power", note_basename: "Backup power.md" };
  const proposal: OrganizationProposal = { binding: { schema_version: "2.0", operation_id: "org-2", vault_id: "manifest-a", memory_id: memory.id, source_kind: "photo", source_sha256: memory.source_sha256, expected_revision: 1, input_sha256: memory.source_sha256, consent_epoch: 2, captured_at: memory.captured_at, context_coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } }, media_type: "image/png", payload_sha256: "synthetic", result: { provider: "anthropic", model_id: "synthetic-model", input_manifest_sha256: "synthetic", related_context: [{ target_memory_id: target.id, source_quote: link.source_quote, target_quote: link.target_quote }], extraction: {}, validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed: false };
  const sourceMemory = { ...memory, organization: proposal, related_context: [link] };
  const list = vi.fn(async (_session: string, _query: string, _includeDeleted?: boolean) => [sourceMemory, target]);
  const relatedMemory = vi.fn(async () => ({ memory_id: target.id, revision: target.revision, source_sha256: target.source_sha256, source_name: target.source_name, note_basename: link.note_basename, original: { bytes: Array.from(new TextEncoder().encode("SYNTHETIC related original")), mime_type: "text/plain", sha256: target.source_sha256 } }));
  const source = vi.fn();
  const v = vault({ list, source, relatedMemory }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  expect(screen.getByText("Possibly related (unreviewed)")).toBeTruthy();
  expect(screen.getAllByText("backup power", { selector: "blockquote" })).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: /Open related memory/ }));
  expect(await screen.findByRole("heading", { name: "backup.txt" })).toBeTruthy();
  expect(list).toHaveBeenCalledWith("session-a", "", true);
  expect(relatedMemory).toHaveBeenCalledWith("session-a", memory.id, target.id);
  expect(source).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("Original text")).toBeTruthy();
});

it("keeps the source open when a related target changes during the click-time check", async () => {
  const target: VaultMemory = { ...memory, id: "target-stale", note: "Old target note", source_name: "old-target.txt", source_sha256: "target-hash" };
  const changed = { ...target, revision: 2, source_sha256: "changed-hash" };
  const link = { target_memory_id: target.id, label: "Possibly related (unreviewed)" as const, source_quote: "garden", target_quote: "garden", note_basename: "Garden.md" };
  const proposal: OrganizationProposal = { binding: { schema_version: "2.0", operation_id: "org-stale", vault_id: "manifest-a", memory_id: memory.id, source_kind: "photo", source_sha256: memory.source_sha256, expected_revision: 1, input_sha256: memory.source_sha256, consent_epoch: 2, captured_at: memory.captured_at }, media_type: "image/png", payload_sha256: "synthetic", result: { provider: "anthropic", model_id: "synthetic-model", input_manifest_sha256: "synthetic", extraction: {}, validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed: false };
  const sourceMemory = { ...memory, organization: proposal, related_context: [link] };
  let relatedListCall = 0;
  const list = vi.fn(async (_session: string, _query: string, includeDeleted?: boolean) => {
    if (!includeDeleted) return [sourceMemory, target];
    relatedListCall++;
    return relatedListCall <= 1 ? [sourceMemory, target] : [sourceMemory, changed];
  });
  const relatedMemory = vi.fn(async () => ({ memory_id: target.id, revision: target.revision, source_sha256: target.source_sha256, source_name: target.source_name, note_basename: link.note_basename, original: { bytes: [1], mime_type: "text/plain", sha256: target.source_sha256 } }));
  const source = vi.fn();
  mount(vault({ list, source, relatedMemory }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: /Open related memory/ }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/changed while it was opening/i);
  expect(screen.getByRole("heading", { name: "AI suggestion · not confirmed" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "old-target.txt" })).toBeNull();
  expect(relatedMemory).toHaveBeenCalledWith("session-a", memory.id, target.id);
  expect(source).not.toHaveBeenCalled();
});

it("does not open a related link when the target is missing from the current vault", async () => {
  const link = { target_memory_id: "missing-target", label: "Possibly related (unreviewed)" as const, source_quote: "garden", target_quote: "garden", note_basename: "Garden.md" };
  const proposal: OrganizationProposal = { binding: { schema_version: "2.0", operation_id: "org-missing", vault_id: "manifest-a", memory_id: memory.id, source_kind: "photo", source_sha256: memory.source_sha256, expected_revision: 1, input_sha256: memory.source_sha256, consent_epoch: 2, captured_at: memory.captured_at }, media_type: "image/png", payload_sha256: "synthetic", result: { provider: "anthropic", model_id: "synthetic-model", input_manifest_sha256: "synthetic", extraction: {}, validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed: false };
  const sourceMemory = { ...memory, organization: proposal, related_context: [link] };
  const source = vi.fn(); const relatedMemory = vi.fn(async () => { throw new Error("This related memory has changed or is no longer available."); }); const v = vault({ list: vi.fn(async () => [sourceMemory]), source, relatedMemory }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: /Open related memory/ }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/changed or is no longer available/i);
  expect(source).not.toHaveBeenCalled();
  expect(relatedMemory).toHaveBeenCalledWith("session-a", memory.id, link.target_memory_id);
  expect(screen.getByRole("heading", { name: "AI suggestion · not confirmed" })).toBeTruthy();
});

it("discards a related target response after the selected vault session changes", async () => {
  const target: VaultMemory = { ...memory, id: "target-switch", note: "Synthetic private target", source_name: "target.txt", source_sha256: "target-hash" };
  const link = { target_memory_id: target.id, label: "Possibly related (unreviewed)" as const, source_quote: "garden", target_quote: "target", note_basename: "Target.md" };
  const proposal: OrganizationProposal = { binding: { schema_version: "2.0", operation_id: "org-switch", vault_id: "manifest-a", memory_id: memory.id, source_kind: "photo", source_sha256: memory.source_sha256, expected_revision: 1, input_sha256: memory.source_sha256, consent_epoch: 2, captured_at: memory.captured_at }, media_type: "image/png", payload_sha256: "synthetic", result: { provider: "anthropic", model_id: "synthetic-model", input_manifest_sha256: "synthetic", extraction: {}, validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed: false };
  const sourceMemory = { ...memory, organization: proposal, related_context: [link] };
  type Verification = { memory_id: string; revision: number; source_sha256: string; source_name: string; note_basename: string; original: { bytes: number[]; mime_type: string; sha256: string } };
  let release!: (value: Verification) => void;
  const relatedMemory = vi.fn(() => new Promise<Verification>(resolve => { release = () => resolve({ memory_id: target.id, revision: target.revision, source_sha256: target.source_sha256, source_name: target.source_name, note_basename: link.note_basename, original: { bytes: [1], mime_type: "text/plain", sha256: target.source_sha256 } }); }));
  const list = vi.fn(async (session: string) => session === "session-a" ? [sourceMemory, target] : []);
  const next: VaultStatus = { root: "/synthetic/other", vault_id: "session-other", vault_identity: "manifest-other" };
  mount(vault({ list, relatedMemory, select: vi.fn(async () => next), status: vi.fn(async () => selected) }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: /Open related memory/ }));
  await waitFor(() => expect(relatedMemory).toHaveBeenCalledWith("session-a", memory.id, target.id));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await screen.findByText("/synthetic/other");
  await act(async () => release({ memory_id: target.id, revision: target.revision, source_sha256: target.source_sha256, source_name: target.source_name, note_basename: link.note_basename, original: { bytes: [1], mime_type: "text/plain", sha256: target.source_sha256 } }));
  expect(screen.queryByText("Synthetic private target")).toBeNull();
  expect(screen.queryByRole("heading", { name: "target.txt" })).toBeNull();
});

it("recovers the same unknown organization operation and hides duplicate manual photo processing", async () => {
  const operation: OrganizationOperation = { operation_id: "same-org-op", memory_id: memory.id, state: "unknown", error_code: "OUTCOME_UNKNOWN" };
  const recoverOrganization = vi.fn(async () => ({ ...operation, state: "organized" as const }));
  const v = vault({ organizationOperations: vi.fn(async () => [operation]), recoverOrganization }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  expect(await screen.findByText(/Processing status uncertain/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Read this photo with Claude" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Check processing status" }));
  expect(recoverOrganization).toHaveBeenCalledWith("session-a", "same-org-op");
});
it("maps organization failures to plain guidance without exposing operation codes", () => {
  const failed = (error_code: string) => operationLabel({ operation_id: "operation", memory_id: memory.id, state: "failed", error_code }, memory);
  expect(failed("INPUT_LIMIT_EXCEEDED")).toBe("Saved locally · this note is too long to organize");
  expect(failed("CONNECTION_CHANGED")).toBe("Saved locally · the connection is unavailable; review its status");
  expect(failed("PROVIDER_FAILED")).toBe("Saved locally · processing could not finish");
  expect(failed("NEW_UNKNOWN_CODE")).not.toContain("NEW_UNKNOWN_CODE");
});
it("asks from the selected vault and opens a freshly verified citation at its original", async () => {
  const completed = (operationId: string): AskOutcome => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, answer: { status: "answered", sentences: [{ text: "The saved note mentions a garden workshop.", citation_ids: ["c1"] }], citations: [{ citation_id: "c1", memory_id: memory.id, memory_revision: memory.revision, source_sha256: memory.source_sha256, evidence_kind: "human_note", quote: "Synthetic garden workshop note" }], limitations: ["Current eligible records only."], coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } } });
  const ask = vi.fn(async (_vault: string, operationId: string, _question: string) => completed(operationId));
  const v = vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ask is ready for this vault." })), ask });
  mount(v); await userEvent.type(await screen.findByLabelText("Your question"), "What was the garden note?"); await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByText("The saved note mentions a garden workshop.")).toBeTruthy();
  expect(screen.getByText("Current eligible records only.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /Source 1 · your note/i }));
  expect(await screen.findByRole("heading", { name: "synthetic.png" })).toBeTruthy();
  expect(await screen.findByLabelText("Cited source")).toBeTruthy();
  expect(await screen.findByRole("img", { name: "Original photo" })).toBeTruthy();
  expect(v.list).toHaveBeenCalledWith("session-a", "", false);
  expect(v.source).toHaveBeenCalledWith("session-a", memory.id);
});

it("explains stale evidence from a failed operation, keeps the question, and offers an explicit fresh Ask", async () => {
  const ask = vi.fn(async (_vault: string, operationId: string): Promise<AskOutcome> => ({ operation: { operation_id: operationId, state: "failed", error_code: "STALE_EVIDENCE" }, answer: null }));
  mount(vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ask ready." })), ask }));
  const question = "What changed in the garden note?";
  const input = await screen.findByLabelText("Your question") as HTMLTextAreaElement;
  await userEvent.type(input, question);
  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect((await screen.findByRole("status")).textContent).toContain("A source changed while Recall was answering.");
  expect(screen.queryByRole("region", { name: "Ask answer" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Source/ })).toBeNull();
  expect(input.value).toBe(question);
  expect(input.readOnly).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Ask a new question" }));
  expect(input.value).toBe(question);
  expect(input.readOnly).toBe(false);
  expect(screen.queryByText("STALE_EVIDENCE")).toBeNull();
});

it("uses bounded abstention wording for insufficient-evidence outcomes", async () => {
  const ask = vi.fn(async (_vault: string, operationId: string): Promise<AskOutcome> => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, answer: { status: "insufficient_evidence", sentences: [], citations: [], limitations: [], coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } } }));
  mount(vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ask ready." })), ask }));
  await userEvent.type(await screen.findByLabelText("Your question"), "What happened next?");
  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByText("Recall could not answer confidently from the sources considered.")).toBeTruthy();
});

it("retains the question and exact operation identity while recovering an unknown Ask after restart", async () => {
  const completed = (operationId: string): AskOutcome => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, answer: { status: "answered", sentences: [{ text: "Recovered synthetic answer.", citation_ids: ["c1"] }], citations: [{ citation_id: "c1", memory_id: memory.id, memory_revision: memory.revision, source_sha256: memory.source_sha256, evidence_kind: "human_note", quote: memory.note }], limitations: [], coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } } });
  const ask = vi.fn(async (_vault: string, operationId: string, _question: string): Promise<AskOutcome> => ({ operation: { operation_id: operationId, state: "unknown", error_code: "PROVIDER_OUTCOME_UNKNOWN" }, answer: null }));
  const recoverAsk = vi.fn(async (_vault: string, operationId: string) => completed(operationId));
  const v = vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ask ready." })), ask, recoverAsk });
  const first = mount(v); await userEvent.type(await screen.findByLabelText("Your question"), "Who did I meet?"); await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  await screen.findByText(/has not confirmed whether this request finished/i); expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).readOnly).toBe(true); const operationId = ask.mock.calls[0]![1]; first.unmount();
  mount(v); await waitFor(() => expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).value).toBe("Who did I meet?"));
  await userEvent.click(screen.getByRole("button", { name: "Check Ask status" }));
  expect(await screen.findByText("Recovered synthetic answer.")).toBeTruthy();
  expect(recoverAsk).toHaveBeenCalledWith("session-a", operationId);
});

it("clears an answer when its citation no longer matches the current memory", async () => {
  const ask = vi.fn(async (_vault: string, operationId: string): Promise<AskOutcome> => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, answer: { status: "answered", sentences: [{ text: "This answer must be cleared when its source changes.", citation_ids: ["c1"] }], citations: [{ citation_id: "c1", memory_id: memory.id, memory_revision: memory.revision, source_sha256: memory.source_sha256, evidence_kind: "human_note", quote: memory.note }], limitations: [], coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } } }));
  const v = vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ask ready." })), ask, list: vi.fn(async () => [{ ...memory, revision: memory.revision + 1 }]) });
  mount(v); await userEvent.type(await screen.findByLabelText("Your question"), "What is in this note?"); await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  await screen.findByText("This answer must be cleared when its source changes.");
  await userEvent.click(screen.getByRole("button", { name: /Source 1 · your note/i }));
  expect((await screen.findByRole("alert")).textContent).toContain("could not be verified");
  expect(screen.queryByText("This answer must be cleared when its source changes.")).toBeNull();
  expect(v.source).not.toHaveBeenCalled();
});

it("clears a displayed answer before checking Ask availability again", async () => {
  const ask = vi.fn(async (_vault: string, operationId: string): Promise<AskOutcome> => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, answer: { status: "answered", sentences: [{ text: "Clear this answer when authorization is rechecked.", citation_ids: ["c1"] }], citations: [{ citation_id: "c1", memory_id: memory.id, memory_revision: memory.revision, source_sha256: memory.source_sha256, evidence_kind: "human_note", quote: memory.note }], limitations: [], coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } } }));
  const askCapability = vi.fn().mockResolvedValueOnce({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ask ready." }).mockResolvedValueOnce({ enabled: false, scope: "vault_intelligence" as const, consent: "unknown" as const, explanation: "Status unknown." });
  mount(vault({ askCapability, ask })); await userEvent.type(await screen.findByLabelText("Your question"), "What did I write?"); await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  await screen.findByText("Clear this answer when authorization is rechecked.");
  await userEvent.click(screen.getByText("Ask connection settings", { exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Refresh Ask availability" }));
  await waitFor(() => expect(screen.queryByText("Clear this answer when authorization is rechecked.")).toBeNull());
  expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
});

it("does not show a late Ask result after switching the selected vault", async () => {
  let finish!: (outcome: AskOutcome) => void;
  const ask = vi.fn((_vault: string, _operationId: string) => new Promise<AskOutcome>(resolve => { finish = resolve; }));
  const next: VaultStatus = { root: "/synthetic/vault-b", vault_id: "session-b", vault_identity: "manifest-b" };
  const v = vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ask ready." })), ask, select: vi.fn(async () => next), status: vi.fn(async () => selected), list: vi.fn(async () => []) });
  mount(v); await userEvent.type(await screen.findByLabelText("Your question"), "Keep this question"); await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await screen.findByText("/synthetic/vault-b");
  finish({ operation: { operation_id: ask.mock.calls[0]![1], state: "complete", error_code: null }, answer: { status: "answered", sentences: [{ text: "Late answer must not appear.", citation_ids: [] }], citations: [], limitations: [], coverage: { eligible_count: 0, selected_count: 0, limited: false, truncated_count: 0 } } });
  await waitFor(() => expect(screen.queryByText("Late answer must not appear.")).toBeNull());
});

it("clarifies historical dates before creating an operation and keeps the original question for the follow-up", async () => {
  const ask = vi.fn();
  const askHistory = vi.fn(async (_vault: string, operationId: string, _question: string, temporal: import("../platform/local-vault").AskTemporal): Promise<import("../platform/local-vault").HistoryAskOutcome> => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, temporal, answer: null, history_evidence: [] }));
  const v = vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ready", history_consent: "active" as const, history_enabled: true, consent_version: 4, history_policy_version: "ask-history-v1" })), ask, askHistory });
  mount(v);
  const input = await screen.findByLabelText("Your question");
  await userEvent.type(input, "What did I know on 10/01?");
  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByText(/Please give one valid full date/)).toBeTruthy();
  expect(ask).not.toHaveBeenCalled(); expect(askHistory).not.toHaveBeenCalled();
  await userEvent.type(input, "October 1, 2026");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(askHistory).toHaveBeenCalledTimes(1));
  expect(askHistory.mock.calls[0]?.[2]).toBe("What did I know on 10/01?");
  expect(askHistory.mock.calls[0]?.[3]).toMatchObject({ display_date: "2026-10-01", mode: "as_of" });
  expect(ask).not.toHaveBeenCalled();
});

it("keeps current Ask available when only the history capability is unknown", async () => {
  const ask = vi.fn(async (_vault: string, operationId: string): Promise<AskOutcome> => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, answer: null }));
  const v = vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ready", history_consent: "unknown" as const, history_enabled: false, consent_version: 0, history_policy_version: null })), ask });
  mount(v); await userEvent.type(await screen.findByLabelText("Your question"), "What is the latest note?");
  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(false);
});

it("requires explicit workspace history opt-in before historical dispatch and opens the exact retained revision", async () => {
  const temporal = { mode: "as_of" as const, start_utc: "2026-10-01T05:00:00Z", end_exclusive_utc: "2026-10-02T05:00:00Z", display_date: "2026-10-01", display_timezone: "America/Chicago" };
  const askHistory = vi.fn(async (_vault: string, operationId: string): Promise<import("../platform/local-vault").HistoryAskOutcome> => ({ operation: { operation_id: operationId, state: "complete", error_code: null }, temporal, answer: { status: "answered", sentences: [{ text: "The earlier note says garden shade.", citation_ids: ["c1"] }], citations: [{ citation_id: "c1", memory_id: memory.id, memory_revision: 1, source_sha256: memory.source_sha256, evidence_kind: "human_note", quote: "garden shade" }], limitations: [], coverage: { eligible_count: 1, selected_count: 1, limited: false, truncated_count: 0 } }, history_evidence: [{ citation_id: "c1", memory_id: memory.id, memory_revision: 1, event_sha256: "e".repeat(64), source_sha256: memory.source_sha256, captured_at: memory.captured_at, recorded_at: "2026-10-01T12:00:00Z", current_revision: 2, history_status: "as_of_later_corrected", evidence_kind: "human_note", epistemic_state: "reported", excerpt: "garden shade" }] }));
  const setHistoryConsent = vi.fn(async () => ({ scope: "vault_intelligence" as const, history_consent: "active" as const, history_enabled: true, consent_version: 2, history_policy_version: "ask-history-v1" }));
  const historicalProposal: OrganizationProposal = { binding: { schema_version: "1.0", operation_id: "synthetic-history", vault_id: "manifest-a", memory_id: memory.id, source_kind: "photo", source_sha256: memory.source_sha256, expected_revision: 1, input_sha256: memory.source_sha256, consent_epoch: 1, captured_at: memory.captured_at }, media_type: "image/png", payload_sha256: "synthetic", result: { provider: "anthropic", model_id: "synthetic", input_manifest_sha256: "synthetic", extraction: { summary: "Earlier machine reading", pages: [{ page_id: memory.id, ordinal: 1, transcription: "Full historical transcription beyond the quoted excerpt.", legibility: "mixed" }] }, validation_notes: [], review_state: "unreviewed" }, review_state: "unreviewed", suppressed: true };
  const askHistoryCitation = vi.fn(async () => ({ memory_id: memory.id, revision: 1, event_sha256: "e".repeat(64), source_sha256: memory.source_sha256, current_revision: 2, current: false, quote: "garden shade", retained_revision: { revision: 1, recorded_at: "2026-10-01T12:00:00Z", kind: "capture", origin: "human:recall", note: "Original retained garden note.", organization: historicalProposal }, original: { bytes: Array.from(new TextEncoder().encode("synthetic original")), mime_type: "text/plain; charset=utf-8", sha256: memory.source_sha256 } }));
  const v = vault({ askCapability: vi.fn(async () => ({ enabled: true, scope: "vault_intelligence" as const, consent: "active" as const, explanation: "Ready", history_consent: "missing" as const, history_enabled: true, consent_version: 1, history_policy_version: "ask-history-v1" })), setHistoryConsent, askHistory, askHistoryCitation });
  mount(v); const input = await screen.findByLabelText("Your question"); await userEvent.type(input, "What did I know on October 1, 2026?");
  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(askHistory).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText("How Ask works and sends data"));
  await userEvent.click(screen.getByRole("button", { name: "Allow questions about the past" }));
  await waitFor(() => expect(setHistoryConsent).toHaveBeenCalledWith("session-a", true, 1));
  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByText("The earlier note says garden shade.")).toBeTruthy();
  expect((await screen.findAllByText(/Later corrected/)).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole("button", { name: "Open saved note and original" }));
  expect(await screen.findByText("Original retained garden note.")).toBeTruthy();
  expect(await screen.findByText("Retained photo proposal · superseded")).toBeTruthy();
  expect(screen.getByText("Full historical transcription beyond the quoted excerpt.")).toBeTruthy();
  expect(screen.getByText("synthetic original")).toBeTruthy();
  expect(askHistoryCitation).toHaveBeenCalledWith("session-a", expect.any(String), "c1");
});
it("enters real first-use local setup without cloud configuration or auth", async () => {
  const v = vault({ status: vi.fn(async () => ({ root: null, vault_id: null, vault_identity: null })), list: vi.fn(async () => []) });
  mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Choose vault" }));
  expect(await screen.findByText("Nothing captured yet")).toBeTruthy();
  expect(screen.queryByText(/sign in|isn't configured/i)).toBeNull();
});
it("keeps the home focused and exposes maintenance through a native disclosure", async () => {
  const v = vault({ list: vi.fn(async () => []) }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Choose vault" }));
  await screen.findByText("Nothing captured yet");
  expect(screen.getByRole("button", { name: "Capture" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Refresh memories" })).toBeTruthy();
  const summary = screen.getByText("Memory tools");
  expect((summary.closest("details") as HTMLDetailsElement).open).toBe(false);
  await userEvent.click(summary);
  expect((summary.closest("details") as HTMLDetailsElement).open).toBe(true);
  expect(screen.getByRole("button", { name: "Removed items" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Rebuild local search" })).toBeTruthy();
});
it("honestly explains browser limits without loading saved intent", async () => {
  const v = vault({ available: false }); mount(v);
  expect(await screen.findByText(/Open the Recall desktop app/)).toBeTruthy();
  expect(v.status).not.toHaveBeenCalled(); expect(v.list).not.toHaveBeenCalled();
});
it("keeps text when the native photo picker is cancelled", async () => {
  const v = vault({ capture: vi.fn(async () => null) }); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Retain my draft");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  await waitFor(() => expect((screen.getByLabelText("Context or note (optional)") as HTMLTextAreaElement).value).toBe("Retain my draft"));
  expect(screen.queryByText("Pending import")).toBeNull();
});
it("searches human notes, opens original and history, saves a human correction", async () => {
  const v = vault(); mount(v);
  await userEvent.type(await screen.findByLabelText("Search notes and filenames"), "garden");
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "View original" }));
  fireEvent.load(await screen.findByRole("img", { name: "Original photo" }));
  expect(screen.getByText(/Original bytes unchanged/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  await userEvent.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByText(/human:recall/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Synthetic amended note");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByText("Synthetic amended note")).toBeTruthy();
  expect(v.correct).toHaveBeenCalledWith("session-a", "m1", 1, expect.any(String), "Synthetic amended note");
});
it("retains a stale correction, reloads current disk note and requires explicit acknowledgment", async () => {
  const correct = vi.fn().mockRejectedValueOnce(new Error("Revision conflict: changed in Obsidian")).mockResolvedValue({ ...memory, note: "My draft", revision: 3 });
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([{ ...memory, revision: 2, note: "Current Obsidian note" }]);
  mount(vault({ correct, list }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "My draft");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Reload latest note" }));
  expect(await screen.findByText("Current Obsidian note")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("My draft");
  await userEvent.click(screen.getByLabelText("I reviewed the latest note"));
  await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByText("My draft")).toBeTruthy();
  expect(correct.mock.calls[1]![2]).toBe(2); expect(correct.mock.calls[1]![3]).not.toBe(correct.mock.calls[0]![3]);
});
it("restores frozen pending capture on restart, using the same operation", async () => {
  const capture = vi.fn().mockRejectedValueOnce(new Error("Lost acknowledgment")).mockResolvedValue(memory);
  const v = vault({ capture }); const first = mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Frozen note");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  await screen.findByRole("alert"); first.unmount(); mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Retry pending import" }));
  await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
  expect(capture.mock.calls[1]).toEqual(capture.mock.calls[0]);
});
it("does not restore private capture intent for a replaced manifest at the same root", async () => {
  const v = vault({ capture: vi.fn(async () => { throw new Error("lost"); }) }); const first = mount(v);
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Private old draft");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await screen.findByRole("alert"); first.unmount();
  mount(vault({ status: vi.fn(async () => ({ ...selected, vault_identity: "new-manifest" })) }));
  await screen.findByRole("button", { name: "Capture" }); expect(screen.queryByText("Pending import")).toBeNull();
});
it("excludes stale list responses after switching vaults", async () => {
  let resolve!: (m: VaultMemory[]) => void;
  const list = vi.fn().mockImplementationOnce(() => new Promise<VaultMemory[]>(r => { resolve = r; })).mockResolvedValue([]);
  mount(vault({ list, select: vi.fn(async () => ({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" })) }));
  await userEvent.click(await screen.findByRole("button", { name: "Switch vault" }));
  await screen.findByText("Nothing captured yet"); await act(async () => resolve([memory]));
  await waitFor(() => expect(screen.queryByText("Synthetic garden note")).toBeNull());
});
it.each(["missing", "decode"])("never claims usable original after %s failure", async (failure) => {
  mount(vault(failure === "missing" ? { source: vi.fn(async () => { throw new Error("Original missing or changed"); }) } : {}));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "View original" }));
  if (failure === "decode") fireEvent.error(await screen.findByRole("img", { name: "Original photo" }));
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(screen.queryByText(/Original bytes unchanged/)).toBeNull();
});
it("ignores startup status that arrives after an explicit vault selection", async () => {
  let resolve!: (s: VaultStatus) => void;
  mount(vault({ status: () => new Promise(r => { resolve = r; }), select: async () => ({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" }), list: async () => [] }));
  await userEvent.click(screen.getByRole("button", { name: "Choose vault" }));
  await screen.findByText("/synthetic/b"); await act(async () => resolve(selected));
  await waitFor(() => expect(screen.queryByText("/synthetic/vault")).toBeNull());
});
it("removes saved/evidence claims after source validation fails", async () => {
  mount(vault({ source: async () => { throw new Error("Source changed"); } }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "View original" })); await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull();
  expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps an import draft and valid vault after cancelling vault selection", async () => {
  mount(vault({ select: async () => null }));
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Still mine");
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  expect((await screen.findByLabelText("Context or note (optional)") as HTMLTextAreaElement).value).toBe("Still mine");
  expect(screen.getByText("/synthetic/vault")).toBeTruthy();
});
it("ignores late capture errors after switching vaults", async () => {
  let reject!: (e: Error) => void;
  mount(vault({ capture: () => new Promise((_r, j) => { reject = j; }), select: async () => ({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" }), list: async () => [] }));
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await screen.findByText("/synthetic/b"); await act(async () => reject(new Error("private old vault error")));
  await waitFor(() => expect(screen.queryByText(/private old vault error/)).toBeNull());
});
it("diagnostic records cannot masquerade as saved memory or eligible evidence", async () => {
  mount(vault({ list: async () => [{ ...memory, revision: 0, note: "", source_name: "", conflict: "Missing original" }] }));
  await userEvent.click(await screen.findByRole("button", { name: /Memory needs attention/ }));
  expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull();
  expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true);
});
it("freezes failed capture text until explicitly abandoned, then uses a new operation", async () => {
  const capture = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(null);
  mount(vault({ capture }));
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.type(screen.getByLabelText("Context or note (optional)"), "First note");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await screen.findByRole("alert");
  expect((screen.getByLabelText("Context or note (optional)") as HTMLTextAreaElement).readOnly).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Abandon pending intent & edit note" }));
  await userEvent.clear(screen.getByLabelText("Context or note (optional)")); await userEvent.type(screen.getByLabelText("Context or note (optional)"), "Changed note");
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  expect(capture.mock.calls[1]![1]).not.toBe(capture.mock.calls[0]![1]); expect(capture.mock.calls[1]![2]).toBe("Changed note");
});
it("does not open the photo picker when durable intent storage fails", async () => {
  const v = vault(); mount(v); await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  const store = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Intent storage full"); });
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Intent storage full"); expect(v.capture).not.toHaveBeenCalled(); store.mockRestore();
});
it("requires another explicit reload after a second correction conflict", async () => {
  const correct = vi.fn(async () => { throw new Error("Revision conflict"); });
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([{ ...memory, revision: 2, note: "Newer disk note" }]);
  mount(vault({ list, correct })); await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "Correct note" })); await userEvent.type(screen.getByLabelText("Your correction"), " amended");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Reload latest note" }));
  await userEvent.click(await screen.findByLabelText("I reviewed the latest note")); await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByRole("alert"); expect(screen.queryByLabelText("I reviewed the latest note")).toBeNull();
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Synthetic garden note amended");
});
it("does not create an evidence URL from a late source response after leaving focus", async () => {
  let resolve!: (s: {bytes: number[]; mime_type: string; sha256: string}) => void;
  mount(vault({ source: () => new Promise(r => { resolve = r; }) }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "View original" }));
  await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  await act(async () => resolve({ bytes: [1], mime_type: "image/png", sha256: "hash" })); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("reports unreadable pending intent and blocks capture without hiding healthy memories", async () => {
  localStorage.setItem(`recall.local.capture:${JSON.stringify([selected.root, selected.vault_identity])}`, "corrupt-json");
  mount(vault()); await screen.findByRole("button", { name: /Synthetic garden note/ });
  expect(await screen.findByRole("alert")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Capture" }));
  expect((screen.getByRole("button", { name: "Choose photo & save" }) as HTMLButtonElement).disabled).toBe(true);
});
it.each([['cancel', false], ['fail', false], ['cancel', true], ['fail', true]] as const)("retains correction draft when vault selection %s (conflict review: %s)", async (outcome, conflict) => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([{ ...memory, revision: 2, note: "Latest disk note" }]);
  mount(vault({ list, select: async () => { if (outcome === "fail") throw new Error("Folder unavailable"); return null; }, correct: async () => { throw new Error("Revision conflict"); } }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Unique unsaved correction");
  if (conflict) {
    await userEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByText("Revision conflict");
    await userEvent.click(screen.getByRole("button", { name: "Reload latest note" })); await screen.findByText("Latest disk note");
  }
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  expect((await screen.findByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Unique unsaved correction");
  if (conflict) { expect(screen.getByText("Latest disk note")).toBeTruthy(); expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true); }
  if (outcome === "fail") expect(screen.getByText("Folder unavailable")).toBeTruthy();
});
it.each(["success", "failure"])("ignores late correction %s after cancelled vault selection and requires reconciliation", async outcome => {
  let finish!: () => void;
  mount(vault({ select: async () => null, correct: () => new Promise((resolve, reject) => { finish = () => outcome === "success" ? resolve({ ...memory, revision: 2, note: "Late committed result" }) : reject(new Error("Late private error")); }) }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Retained pending correction");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await act(async () => finish());
  expect((await screen.findByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Retained pending correction");
  expect(screen.queryByText("Late committed result")).toBeNull(); expect(screen.queryByText("Late private error")).toBeNull();
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Reload latest note" })).toBeTruthy();
});
it("successful switch clears correction draft and source URLs, even when another vault has the same memory ID", async () => {
  const select = vi.fn().mockResolvedValueOnce({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" }).mockResolvedValueOnce({ ...selected, vault_id: "session-c" });
  mount(vault({ select })); await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "View original" })); await screen.findByRole("img", { name: "Original photo" });
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await screen.findByText("/synthetic/b");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic"); expect(screen.queryByRole("img")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Private B draft");
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await screen.findByText("/synthetic/vault");
  await userEvent.click(screen.getByRole("button", { name: /Synthetic garden note/ })); await userEvent.click(screen.getByRole("button", { name: "Correct note" }));
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe(memory.note);
});
it.each(["original", "history"])("ignores late %s after cancelling vault selection", async kind => {
  let finish!: () => void;
  mount(vault({ select: async () => null,
    source: () => new Promise(resolve => { finish = () => resolve({ bytes: [1], mime_type: "image/png", sha256: "hash" }); }),
    history: () => new Promise(resolve => { finish = () => resolve([{ revision: 1, note: "Late historical note", recorded_at: memory.captured_at, origin: "human:recall" as const, kind: "capture" as const }]); }),
  }));
  await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: kind === "original" ? "View original" : "History" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" }));
  await act(async () => finish());
  expect(await screen.findByRole("button", { name: "Correct note" })).toBeTruthy();
  expect(screen.queryByText("Late historical note")).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

const missing: VaultMemory = { ...memory, state: "missing", note_path: null, conflict: "Managed Markdown is missing" };
const deleted: VaultMemory = { ...memory, state: "deleted", revision: 2 };
async function openMemory() { await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note/ })); }
it("displays the resolved renamed Markdown basename", async () => {
  mount(vault()); await openMemory(); expect(screen.getByText("renamed-garden.md")).toBeTruthy();
});
it("missing diagnostic allows explicit restore and removal but blocks evidence and correction", async () => {
  const v = vault({ list: async () => [missing] }); mount(v); await openMemory();
  expect(screen.getByText("Markdown note missing · decision needed")).toBeTruthy();
  expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Correct note" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Restore missing note" }));
  expect(await screen.findByText("Note restored in vault · Stored on this device")).toBeTruthy();
  expect(v.restoreNote).toHaveBeenCalledWith("session-a", "m1", 1, expect.any(String));
});
it.each(["active", "missing"] as const)("removal of %s requires explicit confirmation and cancellation writes nothing", async state => {
  const v = vault({ list: async () => [state === "missing" ? missing : memory] }); mount(v); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" }));
  expect(screen.getByText(/original photo, Markdown files and history remain/)).toBeTruthy();
  expect(screen.getByText(/no in-app undo/)).toBeTruthy(); expect(v.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel removal" })); expect(v.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  expect(await screen.findByText("Removed from Recall · files retained")).toBeTruthy();
  expect(v.remove).toHaveBeenCalledWith("session-a", "m1", 1, expect.any(String), state);
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" }));
  expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull();
});
it("removed history is inspectable with a retained pending diagnostic and never active search evidence", async () => {
  const v = vault({ list: vi.fn(async (_id, _q, include) => include ? [{ ...deleted, conflict: "Pending draft retained" }] : []), history: async () => [{ revision: 2, note: memory.note, recorded_at: memory.updated_at, origin: "human:recall", kind: "remove" }] });
  mount(v); await userEvent.click(await screen.findByRole("button", { name: "Removed items" })); await openMemory();
  expect((screen.getByRole("button", { name: "History" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Restore missing note" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "History" })); expect(await screen.findByText(/remove · human:recall/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to note" })); await userEvent.click(screen.getByRole("button", { name: "Back to memories" }));
  expect(screen.getByRole("heading", { name: "Removed items" })).toBeTruthy(); expect(v.list).toHaveBeenCalledWith("session-a", "", true);
});
it.each([{ ...memory, state: "conflict" as const, conflict: "Duplicate ID" }, { ...missing, revision: 0 }])("ambiguous or invalid committed records disable lifecycle mutations", async m => {
  mount(vault({ list: async () => [m] })); await userEvent.click(await screen.findByRole("button", { name: /Synthetic garden note|Memory needs attention/ }));
  expect((screen.getByRole("button", { name: "Remove from Recall" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Restore missing note" })).toBeNull();
});
it("failed rebuild keeps previous rows visibly stale then successful rebuild replaces them", async () => {
  const rebuild = vi.fn().mockRejectedValueOnce(new Error("Malformed journal")).mockResolvedValue([{ ...memory, note: "Rebuilt note" }]);
  mount(vault({ rebuild })); await screen.findByRole("button", { name: /Synthetic garden note/ });
  await clickTool("Rebuild local search");
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Malformed journal");
  expect(screen.getByRole("button", { name: /Synthetic garden note/ })).toBeTruthy(); expect(screen.getByText(/Previously loaded results · not currently verified/)).toBeTruthy();
  await clickTool("Rebuild local search");
  expect(await screen.findByRole("button", { name: /Rebuilt note/ })).toBeTruthy(); expect(screen.queryByText(/Previously loaded results/)).toBeNull();
  expect(rebuild).toHaveBeenCalledWith("session-a", true);
});
it("back preserves keyword query and rebuild uses canonical results without reintroducing removed rows", async () => {
  const v = vault({ rebuild: async () => [memory, deleted, { ...memory, id: "other", note: "Other", note_path: "other.md", source_name: "other.png" }] });
  mount(v); await userEvent.type(await screen.findByLabelText("Search notes and filenames"), "garden"); await userEvent.click(screen.getByRole("button", { name: "Search" })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("garden");
  await clickTool("Rebuild local search"); await screen.findByRole("button", { name: /Synthetic garden note/ }); expect(screen.queryByRole("button", { name: /^Other/ })).toBeNull();
});
it("failed removal retries frozen decision; fresh review creates a new revision/state intent", async () => {
  const remove = vi.fn().mockRejectedValueOnce(new Error("Lost receipt")).mockRejectedValueOnce(new Error("Still unavailable")).mockResolvedValue(deleted);
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([missing]);
  mount(vault({ list, remove })); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await screen.findByText("Lost receipt"); await userEvent.click(screen.getByRole("button", { name: "Retry same removal" })); await screen.findByText("Still unavailable"); expect(remove.mock.calls[1]).toEqual(remove.mock.calls[0]);
  await userEvent.click(screen.getByRole("button", { name: "Reload current state" })); await screen.findByText("Current state · missing · revision 1");
  await userEvent.click(screen.getByRole("button", { name: "Review a new removal decision" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await screen.findByText("Removed from Recall · files retained"); expect(remove.mock.calls[2]![3]).not.toBe(remove.mock.calls[0]![3]); expect(remove.mock.calls[2]![4]).toBe("missing");
});
it.each(["capture", "correct", "restore"])("%s receipt reports current deleted state without active-save claim", async kind => {
  const v = vault({ capture: async () => deleted, correct: async () => deleted, restoreNote: async () => deleted, list: async () => [kind === "restore" ? missing : memory] }); mount(v);
  if (kind === "capture") { await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); }
  else { await openMemory(); await userEvent.click(screen.getByRole("button", { name: kind === "correct" ? "Correct note" : "Restore missing note" })); if (kind === "correct") await userEvent.click(screen.getByRole("button", { name: "Save correction" })); }
  expect(await screen.findByText(/already removed · files retained/)).toBeTruthy(); expect(screen.queryByText("Note restored in vault · Stored on this device")).toBeNull();
});
it.each(["cancel", "fail"])("tentative selection %s preserves removal confirmation without submitting", async outcome => {
  const v = vault({ select: async () => { if (outcome === "fail") throw new Error("Selection failed"); return null; } }); mount(v); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); expect(await screen.findByRole("button", { name: "Confirm removal" })).toBeTruthy(); expect(v.remove).not.toHaveBeenCalled();
});
it.each(["remove", "restore", "rebuild"])("ignores late %s response after vault switch", async kind => {
  let finish!: () => void; const delayed = () => new Promise<VaultMemory>(resolve => { finish = () => resolve(deleted); });
  const v = vault({ list: vi.fn(async s => s === "session-a" ? [kind === "restore" ? missing : memory] : []), remove: delayed, restoreNote: delayed, rebuild: () => new Promise(resolve => { finish = () => resolve([memory]); }), select: async () => ({ root: "/synthetic/b", vault_id: "session-b", vault_identity: "manifest-b" }) }); mount(v);
  if (kind === "rebuild") await userEvent.click(await screen.findByRole("button", { name: "Rebuild local search" }));
  else { await openMemory(); await userEvent.click(screen.getByRole("button", { name: kind === "remove" ? "Remove from Recall" : "Restore missing note" })); if (kind === "remove") await userEvent.click(screen.getByRole("button", { name: "Confirm removal" })); }
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await screen.findByText("/synthetic/b"); await act(async () => finish()); expect(screen.queryByText(/already removed|Removed from Recall/)).toBeNull(); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull();
});
it("failed switch to removed preserves active query and rows; failed return preserves removed mode", async () => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValueOnce([memory]).mockRejectedValueOnce(new Error("Removed list unavailable")).mockResolvedValueOnce([deleted]).mockRejectedValueOnce(new Error("Active list unavailable"));
  mount(vault({ list })); await userEvent.type(await screen.findByLabelText("Search notes and filenames"), "garden"); await userEvent.click(screen.getByRole("button", { name: "Search" }));
  await clickTool("Removed items"); await screen.findByText("Removed list unavailable"); expect(screen.getByRole("heading", { name: "Matching memories" })).toBeTruthy(); expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("garden"); expect(screen.getByRole("button", { name: /Synthetic garden note/ })).toBeTruthy();
  await clickTool("Removed items"); await screen.findByRole("heading", { name: "Removed items" });
  await userEvent.click(screen.getByRole("button", { name: "Refresh memories" })); await screen.findByText("Active list unavailable"); expect(screen.getByRole("heading", { name: "Removed items" })).toBeTruthy(); expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("garden");
});
it("pending removal survives back to memories and retains operation identity", async () => {
  const remove = vi.fn().mockRejectedValueOnce(new Error("Lost acknowledgment")).mockResolvedValue(deleted); mount(vault({ remove })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" })); await screen.findByText("Lost acknowledgment");
  await userEvent.click(screen.getByRole("button", { name: "Cancel removal" })); await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Retry same removal" })); await screen.findByText("Removed from Recall · files retained"); expect(remove.mock.calls[1]).toEqual(remove.mock.calls[0]);
});
it.each(["remove", "restore"])("interrupted %s after cancelled selection retains exact decision for retry", async kind => {
  let finish!: () => void;
  const mutation = vi.fn().mockImplementationOnce(() => new Promise<VaultMemory>(resolve => { finish = () => resolve(deleted); })).mockResolvedValue(deleted);
  mount(vault({ list: async () => [kind === "restore" ? missing : memory], remove: mutation, restoreNote: mutation, select: async () => null })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: kind === "restore" ? "Restore missing note" : "Remove from Recall" })); if (kind === "remove") await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await act(async () => finish()); expect(screen.queryByText("Removed from Recall · files retained")).toBeNull();
  await userEvent.click(await screen.findByRole("button", { name: kind === "remove" ? "Retry same removal" : "Retry same restore" })); await screen.findByText(kind === "remove" ? "Removed from Recall · files retained" : "This memory is already removed · files retained"); expect(mutation.mock.calls[1]).toEqual(mutation.mock.calls[0]);
});
it.each(["capture", "correct", "restore"])("%s receipts with current missing/conflict state do not report an active save", async kind => {
  const result = kind === "correct" ? { ...memory, state: "conflict" as const, conflict: "Retained pending conflict" } : missing;
  mount(vault({ list: async () => [kind === "restore" ? missing : memory], capture: async () => result, correct: async () => result, restoreNote: async () => result }));
  if (kind === "capture") { await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); }
  else { await openMemory(); await userEvent.click(screen.getByRole("button", { name: kind === "restore" ? "Restore missing note" : "Correct note" })); if (kind === "correct") await userEvent.click(screen.getByRole("button", { name: "Save correction" })); }
  await screen.findByText(/Current memory (has a missing Markdown note|needs attention)/); expect(screen.queryByText(/Correction saved|Note restored/)).toBeNull();
});
it("opening stale rows keeps their unverified state visible until a validated mutation", async () => {
  mount(vault({ rebuild: async () => { throw new Error("Rebuild failed"); } })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await clickTool("Rebuild local search"); await screen.findByText("Rebuild failed"); await openMemory();
  expect(screen.getByText("Previously loaded memory · current state not verified")).toBeTruthy();
});
it("a failed decision can retain current terminal state after reload and inspect its history", async () => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([deleted]);
  mount(vault({ list, remove: async () => { throw new Error("Old operation unavailable"); } })); await openMemory();
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" })); await screen.findByText("Old operation unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Reload current state" })); await screen.findByText("Current state · deleted · revision 2");
  await userEvent.click(screen.getByRole("button", { name: "Keep current state & close decision" })); await userEvent.click(screen.getByRole("button", { name: "History" })); expect(await screen.findByText(/capture · human:recall/)).toBeTruthy();
});
it("out-of-order list responses cannot replace the latest chosen mode", async () => {
  let finish!: (rows: VaultMemory[]) => void;
  const list = vi.fn().mockResolvedValueOnce([memory]).mockImplementationOnce(() => new Promise<VaultMemory[]>(resolve => { finish = resolve; })).mockResolvedValueOnce([memory]);
  mount(vault({ list })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await clickTool("Removed items"); await userEvent.click(screen.getByRole("button", { name: "Refresh memories" })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await act(async () => finish([deleted])); expect(screen.getByRole("heading", { name: "Recent memory" })).toBeTruthy(); expect(screen.queryByRole("heading", { name: "Removed items" })).toBeNull();
});
it("initial read failure does not claim previously loaded results or an empty vault", async () => {
  mount(vault({ list: async () => { throw new Error("Vault unreadable"); } })); await screen.findByText("Vault unreadable"); expect(screen.queryByText(/Previously loaded results/)).toBeNull(); expect(screen.queryByText("Nothing captured yet")).toBeNull();
});
it("a failed later rebuild clears the earlier rebuild success receipt", async () => {
  const rebuild = vi.fn().mockResolvedValueOnce([memory]).mockRejectedValueOnce(new Error("New rebuild failed")); mount(vault({ rebuild })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await clickTool("Rebuild local search"); await screen.findByText("Local keyword search rebuilt from validated vault records.");
  await clickTool("Rebuild local search"); await screen.findByText("New rebuild failed"); expect(screen.queryByText("Local keyword search rebuilt from validated vault records.")).toBeNull();
});
it("list predating successful removal cannot reintroduce its tombstone", async () => {
  let finishList!: (rows: VaultMemory[]) => void;
  const list = vi.fn().mockResolvedValueOnce([memory]).mockImplementationOnce(() => new Promise<VaultMemory[]>(resolve => { finishList = resolve; }));
  mount(vault({ list, select: async () => null })); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Switch vault" })); await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" })); await userEvent.click(screen.getByRole("button", { name: "Confirm removal" })); await screen.findByText("Removed from Recall · files retained"); await act(async () => finishList([memory]));
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull(); expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull(); expect(screen.queryByText("Reading your vault…")).toBeNull();
});
it.each([deleted, missing, { ...memory, state: "conflict" as const, conflict: "Duplicate identity" }, { ...memory, state: "conflict" as const, revision: 0, note: "", source_name: "", conflict: "History unavailable" }])("correction reload publishes authoritative $state revision $revision while retaining the draft", async current => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([current]); const correct = vi.fn(async () => { throw new Error("Lost correction receipt"); });
  mount(vault({ list, correct })); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Correct note" })); await userEvent.clear(screen.getByLabelText("Your correction")); await userEvent.type(screen.getByLabelText("Your correction"), "Retained review draft");
  await userEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByText("Lost correction receipt"); await userEvent.click(screen.getByRole("button", { name: "Reload latest note" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true)); expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Retained review draft"); expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).readOnly).toBe(true); expect(screen.queryByLabelText("I reviewed the latest note")).toBeNull();
  expect(await screen.findByText(current.state === "deleted" ? "Removed from Recall · files retained" : current.state === "missing" ? "Markdown note missing · decision needed" : "Needs attention · evidence unavailable")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to note" })); expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull(); expect((screen.getByRole("button", { name: "View original" }) as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole("button", { name: "Correct note" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); if (current.state === "deleted") expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull(); else expect(screen.getByRole("button", { name: current.revision === 0 ? /Memory needs attention/ : /Synthetic garden note/ })).toBeTruthy(); expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull(); expect(correct).toHaveBeenCalledTimes(1);
});
it("eligible correction reload publishes the current note to home without changing the pending draft", async () => {
  const list = vi.fn().mockResolvedValueOnce([memory]).mockResolvedValue([{ ...memory, revision: 2, note: "Current authoritative note" }]);
  mount(vault({ list, correct: async () => { throw new Error("Revision conflict"); } })); await openMemory(); await userEvent.click(screen.getByRole("button", { name: "Correct note" })); await userEvent.type(screen.getByLabelText("Your correction"), " unsaved"); await userEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByText("Revision conflict"); await userEvent.click(screen.getByRole("button", { name: "Reload latest note" })); await screen.findByText("Current authoritative note");
  expect((screen.getByLabelText("Your correction") as HTMLTextAreaElement).value).toBe("Synthetic garden note unsaved"); await userEvent.click(screen.getByRole("button", { name: "Back to note" })); await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); expect(screen.getByRole("button", { name: /Current authoritative note/ })).toBeTruthy(); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull();
});
it.each([false, true])("delayed capture preserves the latest removed view (request still pending: %s)", async pendingView => {
  let finishCapture!: (m: VaultMemory) => void; let finishView!: (rows: VaultMemory[]) => void;
  const list = vi.fn().mockResolvedValueOnce([memory]);
  if (pendingView) list.mockImplementationOnce(() => new Promise<VaultMemory[]>(resolve => { finishView = resolve; })); else list.mockResolvedValueOnce([deleted]);
  list.mockImplementation(async (_session, _query, includeDeleted) => includeDeleted ? [deleted] : [memory]);
  mount(vault({ list, capture: () => new Promise(resolve => { finishCapture = resolve; }) })); await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await clickTool("Removed items");
  if (!pendingView) await screen.findByRole("heading", { name: "Removed items" }); await act(async () => finishCapture({ ...memory, id: "new-capture" })); await waitFor(() => expect(screen.queryByText("Reading your vault…")).toBeNull());
  expect(screen.getByRole("heading", { name: "Removed items" })).toBeTruthy(); expect(list.mock.calls.at(-1)).toEqual(["session-a", "", true]); expect(screen.getByText("Saved in vault · Stored on this device")).toBeTruthy();
  if (pendingView) { await act(async () => finishView([deleted])); expect(screen.getByRole("heading", { name: "Removed items" })).toBeTruthy(); }
});
it.each([false, true])("delayed capture preserves the latest submitted keyword query (request still pending: %s)", async pendingQuery => {
  let finishCapture!: (m: VaultMemory) => void; let finishQuery!: (rows: VaultMemory[]) => void;
  const matching = { ...memory, id: "workshop", note: "Workshop plan", note_path: "workshop.md" }; const list = vi.fn().mockResolvedValueOnce([memory]);
  if (pendingQuery) list.mockImplementationOnce(() => new Promise<VaultMemory[]>(resolve => { finishQuery = resolve; })); else list.mockResolvedValueOnce([matching]);
  list.mockImplementation(async (_session, q) => q === "workshop" ? [matching] : [memory]);
  mount(vault({ list, capture: () => new Promise(resolve => { finishCapture = resolve; }) })); await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await userEvent.type(screen.getByLabelText("Search notes and filenames"), "workshop"); await userEvent.click(screen.getByRole("button", { name: "Search" }));
  if (!pendingQuery) await screen.findByRole("button", { name: /Workshop plan/ }); await act(async () => finishCapture({ ...memory, id: "new-capture" })); await waitFor(() => expect(screen.queryByText("Reading your vault…")).toBeNull());
  expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("workshop"); expect(screen.getByRole("heading", { name: "Matching memories" })).toBeTruthy(); expect(screen.getByRole("button", { name: /Workshop plan/ })).toBeTruthy(); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull(); expect(list.mock.calls.at(-1)).toEqual(["session-a", "workshop", false]);
  if (pendingQuery) { await act(async () => finishQuery([matching])); expect(screen.getByRole("heading", { name: "Matching memories" })).toBeTruthy(); }
});
it("delayed capture preserves a newer return from removed items to active memories", async () => {
  let finishCapture!: (m: VaultMemory) => void; const list = vi.fn(async (_session: string, _query: string, includeDeleted?: boolean) => includeDeleted ? [deleted] : [memory]);
  mount(vault({ list, capture: () => new Promise(resolve => { finishCapture = resolve; }) })); await screen.findByRole("button", { name: /Synthetic garden note/ }); await clickTool("Removed items"); await screen.findByRole("heading", { name: "Removed items" });
  await userEvent.click(screen.getByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await userEvent.click(screen.getByRole("button", { name: "Refresh memories" })); await screen.findByRole("heading", { name: "Recent memory" }); await act(async () => finishCapture({ ...memory, id: "new-capture" }));
  await waitFor(() => expect(screen.queryByText("Reading your vault…")).toBeNull()); expect(screen.getByRole("heading", { name: "Recent memory" })).toBeTruthy(); expect(screen.queryByRole("heading", { name: "Removed items" })).toBeNull(); expect(list.mock.calls.at(-1)).toEqual(["session-a", "", false]);
});
it("capture follow-up failure retains the prior view after a newer requested view failed", async () => {
  let finishCapture!: (m: VaultMemory) => void; const list = vi.fn(async (_session: string, _query: string, includeDeleted?: boolean) => { if (includeDeleted) throw new Error("Removed view unavailable"); return [memory]; });
  mount(vault({ list, capture: () => new Promise(resolve => { finishCapture = resolve; }) })); await userEvent.click(await screen.findByRole("button", { name: "Capture" })); await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" })); await clickTool("Removed items"); await screen.findByText("Removed view unavailable");
  await act(async () => finishCapture({ ...memory, id: "new-capture" })); await waitFor(() => expect(screen.queryByText("Reading your vault…")).toBeNull()); expect(screen.getByText("Removed view unavailable")).toBeTruthy(); expect(screen.getByRole("heading", { name: "Recent memory" })).toBeTruthy(); expect(screen.getByRole("button", { name: /Synthetic garden note/ })).toBeTruthy(); expect(screen.getByText(/Previously loaded results · not currently verified/)).toBeTruthy(); expect(list.mock.calls.at(-1)).toEqual(["session-a", "", true]);
});

it("authoritative removal clears the earlier capture success notice from home", async () => {
  let current = memory;
  mount(vault({ list: async () => [current], remove: async () => { current = { ...memory, state: "deleted", revision: 2 }; return current; } }));
  await userEvent.click(await screen.findByRole("button", { name: "Capture" }));
  await userEvent.click(screen.getByRole("button", { name: "Choose photo & save" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved in vault · Stored on this device"));
  await userEvent.click(screen.getByRole("button", { name: /Synthetic garden note/ }));
  await userEvent.click(screen.getByRole("button", { name: "Remove from Recall" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await screen.findByText("Removed from Recall · files retained");
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" }));
  expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull();
  await clickTool("Removed items");
  await screen.findByRole("button", { name: /Synthetic garden note/ });
  expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull();
});
it.each([['remove', false], ['remove', true], ['restore', false]] as const)("lifecycle %s reload publishes revision-zero diagnostics (filtered home: %s) and retains the fixed retry", async (kind, filtered) => {
  const initial = kind === "restore" ? missing : memory;
  const diagnostic: VaultMemory = { ...memory, revision: 0, state: "conflict", note: "", source_name: "", note_path: null, conflict: "Retained journal conflict: manual recovery required" };
  const list = vi.fn().mockResolvedValueOnce([initial]); if (filtered) list.mockResolvedValueOnce([initial]); list.mockResolvedValue([diagnostic]);
  const mutation = vi.fn(async () => { throw new Error("Interrupted lifecycle publication"); });
  mount(vault({ list, remove: mutation, restoreNote: mutation }));
  if (filtered) { await userEvent.type(await screen.findByLabelText("Search notes and filenames"), "garden"); await userEvent.click(screen.getByRole("button", { name: "Search" })); }
  await openMemory(); await userEvent.click(screen.getByRole("button", { name: kind === "restore" ? "Restore missing note" : "Remove from Recall" })); if (kind === "remove") await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await screen.findByText("Interrupted lifecycle publication"); const submitted = mutation.mock.calls[0]; await userEvent.click(screen.getByRole("button", { name: "Reload current state" })); await screen.findByText("Current state could not be validated. The previous decision is retained.");
  expect(screen.getByText(diagnostic.conflict!)).toBeTruthy(); expect(screen.queryByRole("button", { name: /Review a new .* decision/ })).toBeNull();
  if (kind === "remove") await userEvent.click(screen.getByRole("button", { name: "Back to note" }));
  expect(screen.getByRole("heading", { name: "Memory needs attention" })).toBeTruthy(); expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull(); expect(screen.queryByText("Markdown note missing · decision needed")).toBeNull();
  for (const name of ["View original", "History", "Correct note", "Remove from Recall"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Restore missing note" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Retry same " + (kind === "remove" ? "removal" : "restore") })); await screen.findByText("Interrupted lifecycle publication"); expect(mutation.mock.calls[1]).toEqual(submitted);
  await userEvent.click(screen.getByRole("button", { name: "Back to memories" })); expect(screen.queryByRole("button", { name: /Synthetic garden note/ })).toBeNull(); expect(screen.queryByText("Saved in vault · Stored on this device")).toBeNull();
  if (filtered) { expect(screen.queryByRole("button", { name: /Memory needs attention/ })).toBeNull(); expect((screen.getByLabelText("Search notes and filenames") as HTMLInputElement).value).toBe("garden"); }
  else { expect(screen.getByRole("button", { name: /Memory needs attention.*Needs attention/ })).toBeTruthy(); await userEvent.click(screen.getByRole("button", { name: /Memory needs attention/ })); expect(screen.getByRole("button", { name: "Retry same " + (kind === "remove" ? "removal" : "restore") })).toBeTruthy(); }
});
