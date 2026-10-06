import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A tiny, clearly SYNTHETIC PNG test pattern (never a real photo). `seed` makes each one unique. */
export function syntheticPng(seed: number, size = 16): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = (seed * 37 + x * 9) & 255;
      raw[i + 1] = (seed * 91 + y * 7) & 255;
      raw[i + 2] = 160;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Write synthetic "camera temp files" and return their paths (simulating temporary URIs). */
export function makeTempPhotos(count: number, startSeed = 1): { dir: string; uris: string[]; bytes: Buffer[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-camera-tmp-"));
  const bytes = Array.from({ length: count }, (_, i) => syntheticPng(startSeed + i));
  const uris = bytes.map((b, i) => {
    const uri = path.join(dir, `IMG_${i + 1}.png`);
    fs.writeFileSync(uri, b);
    return uri;
  });
  return { dir, uris, bytes };
}

export function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "recall-app-private-"));
}
