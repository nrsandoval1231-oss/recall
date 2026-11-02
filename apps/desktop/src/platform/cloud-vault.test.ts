import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { BrowserCloudStore } from "./cloud-store";
import { CloudError, CloudVault, type cloudRequest } from "./cloud-vault";
import type { VaultMemory, VaultSource } from "./local-vault";

beforeEach(() => { Object.defineProperty(globalThis, "crypto", {value: webcrypto, configurable: true}); localStorage.clear(); });
function server() {
  const scope = crypto.randomUUID();
  const rows = new Map<string,VaultMemory>(); const receipts = new Map<string,VaultMemory>();
  let online = true;
  const request = (async (path: string, init: RequestInit = {}) => {
    if (!online) throw new TypeError("Offline");
    if (path === "/library/status") return {root: "Synthetic cloud", vault_id: scope, vault_identity: scope};
    if (path.startsWith("/library/memories?")) return [...rows.values()];
    if (path === "/library/mutations") {
      const body = JSON.parse(init.body as string);
      if (receipts.has(body.operation_id)) return receipts.get(body.operation_id);
      const current = rows.get(body.memory_id);
      if ((current?.revision ?? 0) !== body.expected_revision) throw new CloudError("Concurrent edit. Local change retained.", 409, "REVISION_CONFLICT");
      const row = {id: body.memory_id, revision: body.expected_revision + 1, state: body.action === "remove" ? "deleted" : "active", note: body.note ?? current?.note ?? "", note_path: `${body.memory_id}.md`, source_name: "note.txt", source_sha256: current?.source_sha256 ?? "", captured_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z", conflict: null} as VaultMemory;
      rows.set(row.id, row); receipts.set(body.operation_id,row); return row;
    }
    throw new Error(path);
  }) as typeof cloudRequest;
  return {scope, rows, request, setOnline: (value: boolean) => {online = value;}};
}

it("keeps offline capture and edits across reopen, then syncs each revision without duplicates", async () => {
  const api = server(); const store = new BrowserCloudStore(); const vault = new CloudVault(store, api.request);
  await vault.status(); api.setOnline(false);
  const id = crypto.randomUUID();
  const captured = await vault.captureNote(api.scope, id, "SYNTHETIC first note");
  expect(captured.revision).toBe(1);
  expect((await store.pending(api.scope))[0]?.body.captured_at).toBe(captured.captured_at);
  await vault.synchronize();
  await vault.correct(api.scope, id, 1, crypto.randomUUID(), "SYNTHETIC corrected offline");
  await vault.synchronize();
  const reopened = new CloudVault(new BrowserCloudStore(), api.request);
  expect((await reopened.status()).vault_id).toBe(api.scope);
  expect((await reopened.list(api.scope, ""))[0]?.note).toBe("SYNTHETIC corrected offline");
  expect(new TextDecoder().decode(new Uint8Array((await reopened.source(api.scope,id)).bytes))).toBe("SYNTHETIC first note");
  api.setOnline(true); await reopened.synchronize(); await reopened.synchronize();
  expect(api.rows.size).toBe(1); expect(api.rows.get(id)?.revision).toBe(2);
  expect(await store.pending(api.scope)).toHaveLength(0);
});

it("retains a conflicting local edit and protects it from incoming cloud refresh", async () => {
  const api = server(); const store = new BrowserCloudStore(); const vault = new CloudVault(store, api.request);
  await vault.status(); const id = crypto.randomUUID();
  await vault.captureNote(api.scope,id,"SYNTHETIC base"); await vault.synchronize();
  api.setOnline(false);
  await vault.correct(api.scope,id,1,crypto.randomUUID(),"SYNTHETIC local change"); await vault.synchronize();
  api.rows.set(id, {...api.rows.get(id)!, revision:2, note:"SYNTHETIC remote change"});
  api.setOnline(true); await vault.synchronize();
  expect((await store.list(api.scope))[0]?.note).toBe("SYNTHETIC local change");
  expect((await vault.conflicts()).length).toBe(1);
  expect(api.rows.get(id)?.note).toBe("SYNTHETIC remote change");
  expect(vault.syncMessage).toContain("conflict");
});

async function conflicted(note = "SYNTHETIC local change") {
  const api = server(); const store = new BrowserCloudStore(); const vault = new CloudVault(store, api.request);
  await vault.status(); const id = crypto.randomUUID();
  await vault.captureNote(api.scope,id,"SYNTHETIC base"); await vault.synchronize();
  api.setOnline(false);
  await vault.correct(api.scope,id,1,crypto.randomUUID(),note); await vault.synchronize();
  api.rows.set(id, {...api.rows.get(id)!, revision:2, note:"SYNTHETIC remote change"});
  api.setOnline(true); await vault.synchronize();
  return {api, store, vault, id};
}

it("lists a conflict with both versions and keeps my edit as a new revision on top of the cloud revision", async () => {
  const {api, store, vault, id} = await conflicted();
  const review = (await vault.conflictReviews())[0]!;
  expect(review.local.note).toBe("SYNTHETIC local change");
  expect(review.remote?.note).toBe("SYNTHETIC remote change");
  await vault.resolveConflict(review, {kind: "mine"}); await vault.synchronize();
  expect(await vault.conflicts()).toHaveLength(0);
  expect(api.rows.get(id)).toMatchObject({revision: 3, note: "SYNTHETIC local change"});
  expect(await store.pending(api.scope)).toHaveLength(0);
  expect(vault.syncMessage).not.toContain("conflict");
});

it("adopts the cloud version only on explicit choice and then accepts later cloud refreshes", async () => {
  const {api, store, vault, id} = await conflicted();
  await vault.resolveConflict((await vault.conflictReviews())[0]!, {kind: "cloud"}); await vault.synchronize();
  expect(await store.pending(api.scope)).toHaveLength(0);
  expect((await store.list(api.scope))[0]).toMatchObject({revision: 2, note: "SYNTHETIC remote change"});
  api.rows.set(id, {...api.rows.get(id)!, revision: 3, note: "SYNTHETIC later cloud"});
  await vault.synchronize();
  expect((await store.list(api.scope))[0]?.note).toBe("SYNTHETIC later cloud");
});

it("saves edited combined text as the next revision, and restores before editing a memory deleted in the cloud", async () => {
  const {api, vault, id} = await conflicted();
  await vault.resolveConflict((await vault.conflictReviews())[0]!, {kind: "merged", note: "SYNTHETIC combined"}); await vault.synchronize();
  expect(api.rows.get(id)).toMatchObject({revision: 3, note: "SYNTHETIC combined"});
  const second = await conflicted();
  second.api.rows.set(second.id, {...second.api.rows.get(second.id)!, revision: 3, state: "deleted"});
  const seen: string[] = [];
  const inner = second.api.request;
  const vault2 = new CloudVault(second.store, (async (path: string, init?: RequestInit) => { if (init?.body) seen.push(JSON.parse(init.body as string).action); return inner(path, init); }) as typeof cloudRequest);
  await vault2.status();
  await vault2.resolveConflict((await vault2.conflictReviews())[0]!, {kind: "mine"}); await vault2.synchronize();
  expect(seen).toEqual(["restore", "correct"]);
  expect(second.api.rows.get(second.id)).toMatchObject({revision: 5, note: "SYNTHETIC local change"});
});

it("refuses to resolve a memory that has no conflict", async () => {
  const api = server(); const vault = new CloudVault(new BrowserCloudStore(), api.request);
  await vault.status(); const id = crypto.randomUUID();
  await vault.captureNote(api.scope,id,"SYNTHETIC base"); await vault.synchronize();
  const record = (await vault.list(api.scope, ""))[0]!;
  await expect(vault.resolveConflict({memory: id, pending: [], error: "", local: record, remote: record}, {kind: "cloud"})).rejects.toThrow("no conflict");
});

it("refuses a resolution when a newer local edit was saved after the review opened, and keeps every edit", async () => {
  const {api, store, vault, id} = await conflicted();
  const review = (await vault.conflictReviews())[0]!;
  api.setOnline(false);
  await vault.correct(api.scope, id, 2, crypto.randomUUID(), "SYNTHETIC newer local edit");
  api.setOnline(true);
  for (const choice of [{kind: "cloud"}, {kind: "merged", note: "SYNTHETIC stale combined"}] as const) {
    await expect(vault.resolveConflict(review, choice)).rejects.toThrow("review it again");
  }
  expect(await store.pending(api.scope)).toHaveLength(2);
  expect((await store.list(api.scope))[0]?.note).toBe("SYNTHETIC newer local edit");
  const fresh = (await vault.conflictReviews())[0]!;
  expect(fresh.pending).toHaveLength(2);
  await vault.resolveConflict(fresh, {kind: "mine"}); await vault.synchronize();
  expect(api.rows.get(id)).toMatchObject({revision: 3, note: "SYNTHETIC newer local edit"});
});

it("refuses a resolution when the cloud version changed after the review opened", async () => {
  const {api, store, vault, id} = await conflicted();
  const review = (await vault.conflictReviews())[0]!;
  api.rows.set(id, {...api.rows.get(id)!, revision: 3, note: "SYNTHETIC newest remote"});
  await expect(vault.resolveConflict(review, {kind: "merged", note: "SYNTHETIC combined"})).rejects.toThrow("cloud version changed");
  expect(await vault.conflicts()).toHaveLength(1);
  expect((await store.list(api.scope))[0]?.note).toBe("SYNTHETIC local change");
});

it("refuses combined text over the cloud note limit before changing anything", async () => {
  const {api, store, vault} = await conflicted();
  const review = (await vault.conflictReviews())[0]!;
  await expect(vault.resolveConflict(review, {kind: "merged", note: "é".repeat(131073)})).rejects.toThrow("256 KiB");
  expect(await vault.conflicts()).toHaveLength(1);
  expect((await store.pending(api.scope))[0]?.error).toBeTruthy();
});

it("atomically rejects stale-window writes and does not create orphaned outbox items", async () => {
  const store = new BrowserCloudStore(); const scope=crypto.randomUUID(); const id=crypto.randomUUID();
  const record={id,revision:1,note:"first",state:"active",source_name:"note.txt",source_sha256:"",captured_at:"",updated_at:"",note_path:`${id}.md`,conflict:null} as VaultMemory;
  await store.commit(scope,record,null,{operation_id:id,memory_id:id,action:"capture",expected_revision:0,note:"first"});
  await expect(store.commit(scope,{...record,note:"stale"},null,{operation_id:crypto.randomUUID(),memory_id:id,action:"capture",expected_revision:0,note:"stale"})).rejects.toThrow("changed");
  expect(await store.pending(scope)).toHaveLength(1);
  expect((await store.list(scope))[0]?.note).toBe("first");
});

it("refuses corrupted cached originals", async () => {
  const api=server(); const store=new BrowserCloudStore(); const vault=new CloudVault(store,api.request); await vault.status();
  const id=crypto.randomUUID();
  await store.remote(api.scope,{id,revision:1,state:"active"} as VaultMemory,{bytes:[1],sha256:"0".repeat(64),mime_type:"text/plain"} as VaultSource);
  await expect(vault.source(api.scope,id)).rejects.toThrow("integrity");
});

it("retains per-source automatic permission through offline restart without authorizing older captures", async () => {
  const api = server(); const store = new BrowserCloudStore(); const vault = new CloudVault(store, api.request);
  await vault.status(); api.setOnline(false);
  const old = crypto.randomUUID(), authorized = crypto.randomUUID();
  await vault.captureNote(api.scope, old, "SYNTHETIC older source");
  await vault.captureNote(api.scope, authorized, "SYNTHETIC authorized source", true);
  await vault.synchronize();
  const reopened = new CloudVault(new BrowserCloudStore(), api.request);
  await reopened.status();
  const queued = await store.pending(api.scope);
  expect(queued.find(item => item.memory === old)?.body.processing_consent).toBe(false);
  expect(queued.find(item => item.memory === authorized)?.body.processing_consent).toBe(true);
  expect((await reopened.list(api.scope, "")).find(row => row.id === authorized)?.processing?.message).toContain("after cloud sync");
  api.setOnline(true); await reopened.synchronize(); await reopened.synchronize();
  expect(api.rows.size).toBe(2); expect(await store.pending(api.scope)).toEqual([]);
});
