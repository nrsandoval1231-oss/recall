/**
 * RCL-002 e2e against a REAL server process (model is a labelled synthetic fake).
 *   phase=upload : phone saves + uploads 2 synthetic pages with the given hint; prints the capture id.
 *   phase=ask    : desktop asks a vague question, follows the citation, verifies the cited original's bytes.
 * Env: E2E_API_BASE, E2E_TOKEN, E2E_PHASE, E2E_HINT, E2E_ROOT (phone storage dir, shared across phases).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { RecallApiClient, sha256Hex } from "../../packages/api-client/src";
import { CaptureSyncer } from "../../packages/sync/src";
import { NodeFiles } from "../../packages/sync/src/testing/node-files";
import { makeTempPhotos } from "../../packages/sync/src/testing/fixtures";

const env = (k: string) => process.env[k] as string;
const api = new RecallApiClient({ baseUrl: env("E2E_API_BASE"), getAccessToken: async () => env("E2E_TOKEN") });
mkdirSync(env("E2E_ROOT"), { recursive: true });
const files = new NodeFiles(env("E2E_ROOT"));
const out = (o: unknown) => process.stdout.write(`E2E_RESULT ${JSON.stringify(o)}\n`);

async function upload() {
  const deviceId = randomUUID();
  const syncer = new CaptureSyncer({
    files, api, clock: { now: () => new Date() }, uuid: randomUUID, currentUserId: async () => "e2e-user",
    ensureDevice: async () => { await api.registerDevice({ device_id: deviceId, platform: "ios" }); },
    uploader: { async putFile(req, rel) { const r = await fetch(req.url, { method: "PUT", headers: req.headers, body: readFileSync(files.absoluteUri(rel)) }); return { status: r.status, bodyText: await r.text() }; } },
  });
  const photos = makeTempPhotos(2, 900);
  const saved = await syncer.store.save({ pages: photos.uris.map((uri) => ({ uri, originalFilename: null })), contextHint: env("E2E_HINT"), ownerUserId: "e2e-user", deviceId, timezone: "UTC" });
  const done = await syncer.sync(saved.operationId);
  const server = await api.getCapture(done.sync.serverCaptureId as string);
  out({ phase: done.sync.phase, captureId: server.capture_id, status: server.status, processing: server.processing, localHashes: saved.pages.map((p) => p.sha256) });
}

async function ask() {
  const capture = (await api.listCaptures()).items[0]!;
  const memory = await api.getMemory(capture.memory_id as string);
  const answer = await api.ask("who was that guy Sarah introduced me to who did solar?");
  const cited = answer.citations.find((c) => c.source_id) ?? answer.citations[0]!; // a cited context hint has no page
  const original = await api.fetchSource(cited.source_id as string);
  const unrelated = await api.ask("zebra xylophone quantum");
  out({
    captureStatus: capture.status, memoryPages: memory.interpretation.pages.map((p) => p.transcription),
    label: memory.labels.transcription, answerStatus: answer.status, sentences: answer.sentences,
    citedCapture: cited.capture_id, citedPage: cited.page, citedHash: await sha256Hex(original.bytes),
    serverHash: original.serverSha256, unrelatedStatus: unrelated.status, unrelatedReason: unrelated.reason,
  });
}

(env("E2E_PHASE") === "upload" ? upload() : ask()).catch((e) => { console.error(e); process.exit(1); });
