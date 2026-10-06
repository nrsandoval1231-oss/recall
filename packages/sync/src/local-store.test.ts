import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalCaptureStore } from "./local-store";
import { SaveError } from "./types";
import { crashingFiles, CrashError } from "./testing/crash";
import { makeTempPhotos, sha, syntheticPng, tempRoot } from "./testing/fixtures";
import { NodeFiles } from "./testing/node-files";

const clock = { now: () => new Date("2026-10-06T19:00:00Z") };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const make = (root = tempRoot()) => ({ root, files: new NodeFiles(root), store: new LocalCaptureStore(new NodeFiles(root), clock, uuid) });
const input = (uris: string[], hint?: string) => ({ pages: uris.map((uri) => ({ uri, originalFilename: path.basename(uri) })), contextHint: hint, ownerUserId: "user-a", deviceId: "d", timezone: "America/Chicago" });

describe("durable local Save", () => {
  it("copies bytes into app-private storage, hashes them, and records order — survives temp-file deletion", async () => {
    const { root, store } = make();
    const photos = makeTempPhotos(3);
    const capture = await store.save(input(photos.uris, "  lecture  "));
    fs.rmSync(photos.dir, { recursive: true }); // the OS purges the camera/photo-library temp files
    expect(capture.contextHint).toBe("lecture");
    expect(capture.pages.map((p) => p.ordinal)).toEqual([1, 2, 3]);
    for (const [i, page] of capture.pages.entries()) {
      const stored = fs.readFileSync(path.join(root, "captures", capture.operationId, page.file));
      expect(stored.equals(photos.bytes[i] as Buffer)).toBe(true);
      expect(page.sha256).toBe(sha(photos.bytes[i] as Uint8Array));
      expect(page.byteSize).toBe(stored.length);
      expect(page.mediaType).toBe("image/png");
      expect(path.join(root, "captures", capture.operationId, page.file).startsWith(root)).toBe(true);
    }
    expect(capture.sync).toMatchObject({ phase: "pending", attempts: 0, lastError: null });
  });

  it("needs no title, folder, tags, project, or entity — only pages", async () => {
    const { store } = make();
    const capture = await store.save(input(makeTempPhotos(1).uris));
    expect(capture.contextHint).toBeNull();
    expect(Object.keys(capture).sort()).toEqual(["capturedAt", "contextHint", "createdAt", "deviceId", "operationId", "ownerUserId", "pages", "schemaVersion", "sourceKind", "sync", "timezone"]);
  });

  it("rejects unsupported, empty, oversized, and too many pages — without saving anything", async () => {
    const { root, store } = make();
    const dir = fs.mkdtempSync(path.join(root, "..", "x-"));
    const text = path.join(dir, "note.jpg");
    fs.writeFileSync(text, "this is not an image");
    const empty = path.join(dir, "empty.png");
    fs.writeFileSync(empty, "");
    const huge = path.join(dir, "huge.png");
    fs.writeFileSync(huge, Buffer.concat([syntheticPng(1), Buffer.alloc(26 * 1024 * 1024)]));
    const good = makeTempPhotos(11);
    await expect(store.save(input([text]))).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(store.save(input([empty]))).rejects.toMatchObject({ code: "EMPTY_FILE" });
    await expect(store.save(input([huge]))).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(store.save(input(good.uris))).rejects.toMatchObject({ code: "TOO_MANY_PAGES" });
    await expect(store.save(input([]))).rejects.toBeInstanceOf(SaveError);
    await expect(store.save(input(["/definitely/not/there.jpg"]))).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    expect(await store.list()).toEqual([]);
    expect(fs.readdirSync(path.join(root, "captures"))).toEqual([]); // no staging debris either
  });

  it("reopen: a brand-new store instance on the same directory still has the capture, byte-for-byte", async () => {
    const { root, store } = make();
    const photos = makeTempPhotos(2);
    const saved = await store.save(input(photos.uris));
    const reopened = new LocalCaptureStore(new NodeFiles(root), clock, uuid); // "force close, then relaunch"
    const report = await reopened.recover();
    expect(report.captures.map((c) => c.operationId)).toEqual([saved.operationId]);
    expect(report.damaged).toEqual([]);
    const { sha256 } = await new NodeFiles(root).sha256(`captures/${saved.operationId}/${saved.pages[1]!.file}`);
    expect(sha256).toBe(saved.pages[1]!.sha256);
  });

  it("crash at EVERY file operation during Save: never a visible partial capture, never lost once acknowledged", async () => {
    const photos = makeTempPhotos(3);
    let completedAt = -1;
    for (let crashAt = 1; crashAt < 200 && completedAt < 0; crashAt++) {
      const root = tempRoot();
      const crash = crashingFiles(new NodeFiles(root), crashAt);
      const store = new LocalCaptureStore(crash.files, clock, uuid);
      let acknowledged = false;
      try {
        await store.save(input(photos.uris));
        acknowledged = true;
      } catch (e) {
        // either the raw crash, or the engine reporting a failed copy: in both cases Save was NOT acknowledged
        expect(e instanceof CrashError || (e instanceof SaveError && e.code === "STORAGE_FAILED")).toBe(true);
      }
      // --- process restarts ---
      const report = await new LocalCaptureStore(new NodeFiles(root), clock, uuid).recover();
      expect(report.damaged).toEqual([]);
      expect(report.unreadable).toEqual([]);
      const dir = path.join(root, "captures");
      expect((fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((d) => d.startsWith(".staging"))).toEqual([]);
      if (acknowledged) {
        completedAt = crashAt;
        expect(report.captures).toHaveLength(1); // an acknowledged Save is never lost
      }
      for (const capture of report.captures) {
        expect(capture.pages).toHaveLength(3); // any visible capture is complete
        for (const page of capture.pages) {
          const { sha256 } = await new NodeFiles(root).sha256(`captures/${capture.operationId}/${page.file}`);
          expect(sha256).toBe(page.sha256);
        }
      }
    }
    expect(completedAt).toBeGreaterThan(5); // the sweep really exercised many crash points
  });
});

describe("startup recovery", () => {
  it("discards interrupted staging, resets a killed upload to pending, and flags damaged/unreadable data without deleting it", async () => {
    const { root, store } = make();
    const a = await store.save(input(makeTempPhotos(1, 10).uris));
    const b = await store.save(input(makeTempPhotos(2, 20).uris));
    await store.update(a.operationId, (c) => ({ ...c, sync: { ...c.sync, phase: "in_progress", attempts: 1 } })); // killed mid-upload
    fs.mkdirSync(path.join(root, "captures", ".staging-dead", "pages"), { recursive: true });
    fs.writeFileSync(path.join(root, "captures", ".staging-dead", "pages", "1-x.incoming"), "partial");
    fs.rmSync(path.join(root, "captures", b.operationId, b.pages[0]!.file)); // data damage
    fs.mkdirSync(path.join(root, "captures", "garbage"));
    fs.writeFileSync(path.join(root, "captures", "garbage", "manifest.json"), "{not json");

    const report = await new LocalCaptureStore(new NodeFiles(root), clock, uuid).recover();
    expect(report.discardedStaging).toEqual([".staging-dead"]);
    expect(report.captures.find((c) => c.operationId === a.operationId)?.sync.phase).toBe("pending");
    expect(report.damaged).toEqual([{ operationId: b.operationId, reason: "page 1 is missing" }]);
    expect(report.unreadable).toEqual(["garbage"]);
    expect(fs.existsSync(path.join(root, "captures", "garbage", "manifest.json"))).toBe(true); // never deleted
    expect(fs.existsSync(path.join(root, "captures", b.operationId, b.pages[1]!.file))).toBe(true);
  });

  it("lists most recent first", async () => {
    const { store } = make();
    let t = 0;
    const timed = new LocalCaptureStore(new NodeFiles((store as unknown as { files: NodeFiles }).files.root), { now: () => new Date(1_790_000_000_000 + ++t * 1000) }, uuid);
    const first = await timed.save(input(makeTempPhotos(1, 30).uris));
    const second = await timed.save(input(makeTempPhotos(1, 40).uris));
    expect((await timed.list()).map((c) => c.operationId)).toEqual([second.operationId, first.operationId]);
  });
});
