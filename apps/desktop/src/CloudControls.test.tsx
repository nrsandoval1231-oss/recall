// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CloudControls } from "./CloudControls";
import type { CloudVault, ConflictReview } from "./platform/cloud-vault";
import type { VaultMemory } from "./platform/local-vault";

afterEach(cleanup);
const memory = (note: string, revision: number): VaultMemory => ({id: "m1", revision, note, state: "active", note_path: "m1.md", source_name: "note.txt", source_sha256: "", captured_at: "", updated_at: "", conflict: null});
function setup(remote: VaultMemory | null) {
  const review: ConflictReview = {memory: "m1", pending: ["op1"], error: "conflict", local: memory("SYNTHETIC mine", 2), remote};
  const vault = {syncMessage: "1 memory conflict(s).", conflictReviews: vi.fn().mockResolvedValueOnce([review]).mockResolvedValue([]), resolveConflict: vi.fn().mockResolvedValue(memory("x", 3))};
  const request = vi.fn().mockRejectedValue(new Error("offline"));
  render(<CloudControls vault={vault as unknown as CloudVault} request={request as never} />);
  return {...vault, review};
}

it("shows both versions and resolves by explicit choice", async () => {
  const vault = setup(memory("SYNTHETIC cloud", 2));
  await userEvent.click(screen.getByRole("button", {name: "Cloud settings"}));
  const card = await screen.findByRole("region", {name: /Conflict/});
  expect(card.textContent).toContain("SYNTHETIC mine");
  expect(card.textContent).toContain("SYNTHETIC cloud");
  await userEvent.click(screen.getByRole("button", {name: "Keep my edit"}));
  await waitFor(() => expect(vault.resolveConflict).toHaveBeenCalledWith(vault.review, {kind: "mine"}));
  await waitFor(() => expect(screen.queryByRole("region", {name: /Conflict/})).toBeNull());
});

it("sends edited combined text and offers no resolution while the cloud version is unreachable", async () => {
  const vault = setup(memory("SYNTHETIC cloud", 2));
  await userEvent.click(screen.getByRole("button", {name: "Cloud settings"}));
  const box = await screen.findByLabelText("Combined text");
  await userEvent.clear(box); await userEvent.type(box, "SYNTHETIC combined");
  await userEvent.click(screen.getByRole("button", {name: "Save combined text"}));
  await waitFor(() => expect(vault.resolveConflict).toHaveBeenCalledWith(vault.review, {kind: "merged", note: "SYNTHETIC combined"}));
  cleanup();
  setup(null);
  await userEvent.click(screen.getByRole("button", {name: "Cloud settings"}));
  expect(await screen.findByText(/unavailable while offline/)).toBeTruthy();
  expect(screen.queryByRole("button", {name: "Keep my edit"})).toBeNull();
});

it("shows a refusal from the native store, which rejects with a plain string", async () => {
  const vault = setup(memory("SYNTHETIC cloud", 2));
  vault.resolveConflict.mockRejectedValueOnce("This memory changed on this device since the review opened. Nothing was changed; review it again.");
  await userEvent.click(screen.getByRole("button", {name: "Cloud settings"}));
  await userEvent.click(await screen.findByRole("button", {name: "Keep my edit"}));
  expect(await screen.findByText(/review it again/)).toBeTruthy();
});
