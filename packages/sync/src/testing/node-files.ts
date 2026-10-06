/** node:fs implementation of LocalFiles. For tests and the e2e harness only (never bundled into apps). */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LocalFiles } from "../ports";

export class NodeFiles implements LocalFiles {
  constructor(readonly root: string) {}

  private abs(rel: string): string {
    const full = path.resolve(this.root, rel);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error(`path escapes root: ${rel}`);
    return full;
  }

  async ensureDir(rel: string) {
    await fs.mkdir(this.abs(rel), { recursive: true });
  }
  async listDir(rel: string) {
    return fs.readdir(this.abs(rel)).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
  }
  async exists(rel: string) {
    return fs.access(this.abs(rel)).then(() => true, () => false);
  }
  async copyIn(sourceUri: string, destRel: string) {
    await fs.mkdir(path.dirname(this.abs(destRel)), { recursive: true });
    await fs.copyFile(sourceUri, this.abs(destRel));
    const handle = await fs.open(this.abs(destRel), "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async writeTextAtomic(rel: string, text: string) {
    const target = this.abs(rel);
    const tmp = `${target}.${randomUUID()}.tmp`;
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, target);
  }
  async readText(rel: string) {
    return fs.readFile(this.abs(rel), "utf8");
  }
  async rename(fromRel: string, toRel: string) {
    await fs.rename(this.abs(fromRel), this.abs(toRel));
  }
  async remove(rel: string) {
    await fs.rm(this.abs(rel), { recursive: true, force: true });
  }
  async size(rel: string) {
    return fs.stat(this.abs(rel)).then((s) => s.size, () => null);
  }
  async sha256(rel: string) {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(this.abs(rel))) {
      hash.update(chunk as Buffer);
      size += (chunk as Buffer).length;
    }
    return { sha256: hash.digest("hex"), size };
  }
  async readHead(rel: string, length: number) {
    const handle = await fs.open(this.abs(rel), "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return new Uint8Array(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }
  absoluteUri(rel: string) {
    return this.abs(rel);
  }
}
