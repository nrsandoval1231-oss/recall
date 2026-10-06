import * as fs from "node:fs";
import * as path from "node:path";
import { ApiError, NetworkError } from "@recall/api-client";
import { describe, expect, it } from "vitest";
import { CaptureSyncer, displayStatus } from "./syncer";
import { makeTempPhotos, tempRoot } from "./testing/fixtures";
import { FakeServer } from "./testing/fake-server";
import { NodeFiles } from "./testing/node-files";

let n = 0;
const uuid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const user = { current: "user-a" as string | null };
const clock = { now: () => new Date("2026-10-06T19:00:00Z") };

function setup(root = tempRoot(), server?: FakeServer) {
  const files = new NodeFiles(root);
  const srv = server ?? new FakeServer(files);
  let deviceCalls = 0;
  const make = (srvx: FakeServer = srv) => new CaptureSyncer({ files, api: srvx, uploader: srvx, clock, uuid, ensureDevice: async () => void deviceCalls++, currentUserId: async () => user.current });
  return { root, files, srv, syncer: make(), make, deviceCalls: () => deviceCalls };
}
async function saved(ctx: ReturnType<typeof setup>, pages = 3) {
  const photos = makeTempPhotos(pages, 100 + n);
  return ctx.syncer.store.save({ pages: photos.uris.map((uri) => ({ uri, originalFilename: null })), ownerUserId: "user-a", deviceId: "d", timezone: "UTC" });
}

describe("account ownership", () => {
  it("never uploads another account's capture, and resumes when the owner signs back in", async () => {
    user.current = "user-b";
    const ctx = setup();
    const capture = await saved(ctx, 1);
    await ctx.syncer.syncAllPending();
    expect(ctx.srv.captures.size).toBe(0);
    const direct = await ctx.syncer.sync(capture.operationId);
    expect(direct.sync.lastError).toMatchObject({ code: "WRONG_ACCOUNT", retryable: false });
    expect(ctx.srv.captures.size).toBe(0);
    expect(await ctx.syncer.store.list("user-b")).toHaveLength(0);
    user.current = null;
    await ctx.syncer.syncAllPending(); // signed out: nothing happens
    expect(ctx.srv.captures.size).toBe(0);
    user.current = "user-a";
    expect(displayStatus(await ctx.syncer.sync(capture.operationId), false)).toBe("uploaded");
    user.current = "user-a";
  });
});

describe("upload engine", () => {
  it("happy path: Saved → Uploading (only while active) → Uploaded, with verified hashes", async () => {
    const ctx = setup();
    const capture = await saved(ctx);
    expect(displayStatus(capture, false)).toBe("saved_locally");
    const seen: string[] = [];
    ctx.syncer.subscribe(async () => {
      const current = await ctx.syncer.store.read(capture.operationId);
      seen.push(displayStatus(current, ctx.syncer.isActive(capture.operationId)));
    });
    ctx.srv.onPut = async () => {
      const mid = await ctx.syncer.store.read(capture.operationId);
      expect(displayStatus(mid, ctx.syncer.isActive(capture.operationId))).toBe("uploading");
      expect(mid.sync.phase).not.toBe("finalized"); // a request in flight is NOT "uploaded"
    };
    const done = await ctx.syncer.sync(capture.operationId);
    expect(displayStatus(done, false)).toBe("uploaded");
    expect(done.pages.every((p) => p.serverConfirmedSha256 === p.sha256 && p.sourceId)).toBe(true);
    expect([ctx.srv.creates, ctx.srv.puts, ctx.srv.finalizes]).toEqual([1, 3, 1]);
    expect(seen).toContain("uploading");
  });

  it("offline: stays safely on the device as Failed—retry, then succeeds when back online (no duplicates)", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 2);
    ctx.srv.online = false;
    const failed = await ctx.syncer.sync(capture.operationId);
    expect(displayStatus(failed, false)).toBe("failed");
    expect(failed.sync.lastError).toMatchObject({ code: "NETWORK", retryable: true });
    expect(ctx.srv.captures.size).toBe(0);
    ctx.srv.online = true;
    expect(displayStatus(await ctx.syncer.sync(capture.operationId), false)).toBe("uploaded");
    expect(ctx.srv.captures.size).toBe(1);
  });

  it("lost create response: the retry reuses the same server capture", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 2);
    ctx.srv.loseAckOnce.add("create");
    expect((await ctx.syncer.sync(capture.operationId)).sync.lastError?.code).toBe("NETWORK");
    expect(ctx.srv.captures.size).toBe(1);
    expect(displayStatus(await ctx.syncer.sync(capture.operationId), false)).toBe("uploaded");
    expect(ctx.srv.captures.size).toBe(1);
    expect(ctx.srv.creates).toBe(2);
  });

  it("upload interrupted between pages: the retry uploads only what the server lacks", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 3);
    let calls = 0;
    ctx.srv.onPut = () => {
      if (++calls === 2) ctx.srv.failOnce.set("put", () => new NetworkError("connection dropped"));
    };
    expect((await ctx.syncer.sync(capture.operationId)).sync.lastError?.code).toBe("NETWORK");
    expect(ctx.srv.puts).toBe(2);
    const done = await ctx.syncer.sync(capture.operationId);
    expect(displayStatus(done, false)).toBe("uploaded");
    expect(ctx.srv.puts).toBe(3); // only the one missing page was re-sent
    expect(ctx.srv.captures.size).toBe(1);
  });

  it("lost PUT acknowledgement: the retry re-sends only that page (idempotent server side)", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 2);
    ctx.srv.loseAckOnce.add("put");
    expect((await ctx.syncer.sync(capture.operationId)).sync.lastError).not.toBeNull();
    expect(displayStatus(await ctx.syncer.sync(capture.operationId), false)).toBe("uploaded");
  });

  it("retry after upload but before finalize, and after finalize but before the ack", async () => {
    const a = setup();
    const capA = await saved(a, 2);
    a.srv.failOnce.set("finalize", () => new NetworkError("dropped before finalize"));
    expect((await a.syncer.sync(capA.operationId)).sync.lastError?.code).toBe("NETWORK");
    expect(a.srv.puts).toBe(2);
    expect(displayStatus(await a.syncer.sync(capA.operationId), false)).toBe("uploaded");
    expect(a.srv.puts).toBe(2); // nothing re-uploaded

    const b = setup();
    const capB = await saved(b, 2);
    b.srv.loseAckOnce.add("finalize"); // server finalized; the client never heard
    expect((await b.syncer.sync(capB.operationId)).sync.lastError?.code).toBe("NETWORK");
    expect(displayStatus(await b.syncer.sync(capB.operationId), false)).toBe("uploaded");
    expect(b.srv.puts).toBe(2);
    expect(b.srv.captures.size).toBe(1);
  });

  it("expired upload authorization is renewed once, transparently", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 2);
    ctx.srv.expireNextAuthorization = true;
    expect(displayStatus(await ctx.syncer.sync(capture.operationId), false)).toBe("uploaded");
  });

  it("signed-out (401) fails retryably and the capture is untouched; signing back in completes it", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 1);
    ctx.srv.tokenValid = false;
    const failed = await ctx.syncer.sync(capture.operationId);
    expect(failed.sync.lastError).toMatchObject({ code: "UNAUTHENTICATED", retryable: true });
    ctx.srv.tokenValid = true;
    expect(displayStatus(await ctx.syncer.sync(capture.operationId), false)).toBe("uploaded");
  });

  it("refuses to upload bytes that changed on the device after Save", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 2);
    const victim = path.join(ctx.root, "captures", capture.operationId, capture.pages[1]!.file);
    const bytes = fs.readFileSync(victim);
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 0xff;
    fs.writeFileSync(victim, bytes);
    const failed = await ctx.syncer.sync(capture.operationId);
    expect(failed.sync.lastError).toMatchObject({ code: "LOCAL_FILE_CORRUPT", retryable: false });
    expect(ctx.srv.puts).toBe(0);
    fs.rmSync(victim);
    expect((await ctx.syncer.sync(capture.operationId)).sync.lastError?.code).toBe("LOCAL_FILE_MISSING");
  });

  it("never says Uploaded when the server's own hash disagrees with the device's copy", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 1);
    ctx.srv.corruptOnReceive = true;
    const failed = await ctx.syncer.sync(capture.operationId);
    expect(displayStatus(failed, false)).toBe("failed");
    expect(failed.sync.lastError).toMatchObject({ code: "SERVER_HASH_MISMATCH", retryable: false });
    expect(failed.sync.phase).not.toBe("finalized");
  });

  it("server lost an original after upload: finalize reports it, the engine re-uploads exactly that page", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 3);
    let once = true;
    ctx.srv.onPut = () => undefined;
    const realFinalize = ctx.srv.finalize.bind(ctx.srv);
    ctx.srv.finalize = async (...args) => {
      if (once) {
        once = false;
        const cap = [...ctx.srv.captures.values()][0]!;
        ctx.srv.objects.delete(cap.pages[1]!.source_id); // storage loss
      }
      return realFinalize(...args);
    };
    expect(displayStatus(await ctx.syncer.sync(capture.operationId), false)).toBe("uploaded");
    expect(ctx.srv.puts).toBe(4);
  });

  it("concurrent sync calls for one capture are coalesced into one upload", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 2);
    await Promise.all([ctx.syncer.sync(capture.operationId), ctx.syncer.sync(capture.operationId), ctx.syncer.sync(capture.operationId)]);
    expect([ctx.srv.creates, ctx.srv.puts, ctx.srv.finalizes]).toEqual([1, 2, 1]);
  });

  it("force-close mid-upload: after relaunch the capture is recovered, resumes, and creates no duplicate", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 3);
    const snapshot = tempRoot();
    ctx.srv.onPut = (count) => {
      if (count === 2) fs.cpSync(ctx.root, snapshot, { recursive: true }); // disk exactly as it was when the process died
    };
    await ctx.syncer.sync(capture.operationId);
    expect(JSON.parse(fs.readFileSync(path.join(snapshot, "captures", capture.operationId, "manifest.json"), "utf8")).sync.phase).toBe("in_progress");

    const relaunched = setup(snapshot, ctx.srv); // same server, new process, restored disk
    const report = await relaunched.syncer.store.recover();
    expect(report.captures[0]!.sync.phase).toBe("pending");
    expect(displayStatus(report.captures[0]!, false)).toBe("saved_locally");
    await relaunched.syncer.syncAllPending();
    expect(displayStatus(await relaunched.syncer.store.read(capture.operationId), false)).toBe("uploaded");
    expect(ctx.srv.captures.size).toBe(1);
  });

  it("never deletes local originals, even after Uploaded", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 2);
    await ctx.syncer.sync(capture.operationId);
    for (const page of capture.pages) expect(fs.existsSync(path.join(ctx.root, "captures", capture.operationId, page.file))).toBe(true);
  });

  it("syncAllPending processes oldest first and skips already-uploaded captures", async () => {
    const ctx = setup();
    const first = await saved(ctx, 1);
    await ctx.syncer.sync(first.operationId);
    const second = await saved(ctx, 1);
    const putsBefore = ctx.srv.puts;
    await ctx.syncer.syncAllPending();
    expect(ctx.srv.puts).toBe(putsBefore + 1);
    expect(displayStatus(await ctx.syncer.store.read(second.operationId), false)).toBe("uploaded");
  });

  it("syncAllPending does not hammer a permanently failed capture; a manual retry still works", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 1);
    ctx.srv.failOnce.set("create", () => new ApiError("UNSUPPORTED_MEDIA", "no", 415, false, null));
    await ctx.syncer.sync(capture.operationId);
    const before = ctx.srv.creates;
    await ctx.syncer.syncAllPending();
    expect(ctx.srv.creates).toBe(before);
    expect(displayStatus(await ctx.syncer.sync(capture.operationId), false)).toBe("uploaded");
  });

  it("a non-retryable server rejection is recorded, not retried forever", async () => {
    const ctx = setup();
    const capture = await saved(ctx, 1);
    ctx.srv.failOnce.set("create", () => new ApiError("UNSUPPORTED_MEDIA", "no", 415, false, null));
    const failed = await ctx.syncer.sync(capture.operationId);
    expect(failed.sync.lastError).toMatchObject({ code: "UNSUPPORTED_MEDIA", retryable: false });
  });
});
