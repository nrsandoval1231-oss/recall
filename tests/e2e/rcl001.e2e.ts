/**
 * RCL-001 integrity e2e against a REAL server. Drives the same sync engine + API client the apps use.
 * Env: E2E_API_BASE, E2E_TOKEN_A (user A), E2E_TOKEN_B (user B). Prints one JSON result line.
 * Synthetic images only.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { RecallApiClient, sha256Hex, ApiError, NetworkError } from "../../packages/api-client/src";
import { CaptureSyncer } from "../../packages/sync/src";
import { NodeFiles } from "../../packages/sync/src/testing/node-files";
import { makeTempPhotos, tempRoot } from "../../packages/sync/src/testing/fixtures";

const base = process.env.E2E_API_BASE as string;
const tokenA = process.env.E2E_TOKEN_A as string;
const tokenB = process.env.E2E_TOKEN_B as string;
const clock = { now: () => new Date() };

function client(token: string) {
  return new RecallApiClient({ baseUrl: base, getAccessToken: async () => token });
}

function uploaderFor(files: NodeFiles, failSecondPutOnce: { armed: boolean }) {
  let puts = 0;
  return {
    get puts() { return puts; },
    async putFile(req: { url: string; headers: Record<string, string> }, rel: string) {
      puts++;
      if (failSecondPutOnce.armed && puts === 2) {
        failSecondPutOnce.armed = false;
        throw new NetworkError("simulated connection drop mid-upload");
      }
      const res = await fetch(req.url, { method: "PUT", headers: req.headers, body: readFileSync(files.absoluteUri(rel)) });
      return { status: res.status, bodyText: await res.text() };
    },
  };
}

async function main() {
  const root = tempRoot();
  const files = new NodeFiles(root);
  const api = client(tokenA);
  const deviceId = randomUUID();
  const ensureDevice = async () => { await api.registerDevice({ device_id: deviceId, platform: "ios", name: "e2e-phone" }); };
  const drop = { armed: true };
  const uploader = uploaderFor(files, drop);
  const make = () => new CaptureSyncer({ files, api, uploader, clock, uuid: randomUUID, ensureDevice, currentUserId: async () => "e2e-user" });

  // ---- "iPhone": photograph 3 pages, durable local Save
  const photos = makeTempPhotos(3, 500);
  let phone = make();
  const saved = await phone.store.save({ pages: photos.uris.map((uri) => ({ uri, originalFilename: null })), contextHint: "e2e synthetic", ownerUserId: "e2e-user", deviceId, timezone: "UTC" });
  const localHashes = saved.pages.map((p) => p.sha256);

  // ---- first attempt is interrupted mid-upload (app killed / connection dropped)
  const first = await phone.sync(saved.operationId);
  const interruptedState = first.sync.lastError?.code;
  // ---- relaunch: new engine instance on the same disk, recover, resume
  phone = make();
  await phone.store.recover();
  const done = await phone.sync(saved.operationId);

  // ---- "Windows desktop": a separate client/device lists and views the originals
  const desktop = client(tokenA);
  const list = await desktop.listCaptures({ limit: 10 });
  const cap = list.items.find((c) => c.client_capture_id === saved.operationId)!;
  const desktopHashes: string[] = [];
  const serverHashes: string[] = [];
  for (const page of cap.pages) {
    const got = await desktop.fetchSource(page.source_id);
    desktopHashes.push(await sha256Hex(got.bytes));
    serverHashes.push(got.serverSha256 as string);
  }

  // ---- isolation: user B cannot see or fetch A's capture
  const b = client(tokenB);
  const bList = await b.listCaptures();
  let bFetch = "";
  try { await b.fetchSource(cap.pages[0]!.source_id); bFetch = "LEAK"; } catch (e) { bFetch = e instanceof ApiError ? e.code : "other"; }

  process.stdout.write("E2E_RESULT " + JSON.stringify({
    interruptedState,
    finalPhase: done.sync.phase,
    serverStatus: cap.status,
    capturesForOperation: list.items.filter((c) => c.client_capture_id === saved.operationId).length,
    ordinals: cap.pages.map((p) => p.ordinal),
    localHashes, serverHashes, desktopHashes,
    storageKeysHash: cap.pages.map((p) => p.source_id),
    bSeesCapture: bList.items.some((c) => c.capture_id === cap.capture_id),
    bFetch,
    puts: uploader.puts,
    expectedFirst: createHash("sha256").update(photos.bytes[0]!).digest("hex"),
  }) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
