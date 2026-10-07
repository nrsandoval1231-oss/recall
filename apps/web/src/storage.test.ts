import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { deleteDraft, draftPage, listDrafts, MAX_LOCAL_CAPTURE_BYTES, saveDraft, storageTestHooks } from "./storage";
import type { CaptureManifest } from "@recall/api-client";

const manifest: CaptureManifest = { schema_version: "1.0", client_capture_id: "c1", device_id: "d1", captured_at: "2026-10-07T00:00:00Z", timezone: "UTC", source_kind: "handwritten_note", context_hint: null, pages: [{ client_page_id: "p1", ordinal: 1, media_type: "image/png", byte_size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", original_filename: "note.png" }] };
const makeDraft = (scope = "u1:w1") => draftPage(scope, manifest, manifest.pages[0]!, new Blob(["abc"], { type: "image/png" }));

beforeEach(async () => { storageTestHooks.afterPut = undefined; await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase("recall-web"); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("IndexedDB reset was blocked.")); }); });
afterEach(() => { storageTestHooks.afterPut = undefined; });

describe("durable capture drafts", () => {
  it("reopens the database and lists the same scoped original bytes", async () => {
    const draft = makeDraft(); await saveDraft(draft); const reopened = await listDrafts("u1:w1"); expect(reopened).toHaveLength(1); expect(reopened[0]?.scope).toBe("u1:w1"); expect(await reopened[0]!.files["p1"]!.text()).toBe("abc"); await deleteDraft(draft.id); expect(await listDrafts("u1:w1")).toHaveLength(0);
  });
  it("keeps another workspace's durable drafts out of the scoped listing", async () => {
    await saveDraft(makeDraft("u1:w1")); await saveDraft({ ...makeDraft("u2:w2"), id: "c2" }); expect((await listDrafts("u1:w1")).map((draft) => draft.scope)).toEqual(["u1:w1"]); expect((await listDrafts("u2:w2")).map((draft) => draft.scope)).toEqual(["u2:w2"]);
  });
  it("rejects when a put succeeds but its transaction aborts before completion", async () => {
    storageTestHooks.afterPut = (transaction) => transaction.abort(); const draft = makeDraft(); await expect(saveDraft(draft)).rejects.toThrow(/saved/); expect(await listDrafts("u1:w1")).toHaveLength(0);
  });
  it("enforces the 25 MiB local source ceiling", () => expect(MAX_LOCAL_CAPTURE_BYTES).toBe(25 * 1024 * 1024));
});
