/**
 * LocalFiles on expo-file-system (SDK 57 object API). Everything lives under the app's private
 * document directory. NOT verified on a physical device in RCL-001 (see docs/ACCEPTANCE-RCL-001.md, gate G3):
 * the durability *logic* is tested with a node:fs adapter; this adapter is the thin native layer.
 */
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import type { LocalFiles } from "@recall/sync";

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const parentOf = (rel: string) => rel.split("/").slice(0, -1).join("/");
const baseOf = (rel: string) => rel.split("/").pop() as string;

export class ExpoFiles implements LocalFiles {
  private readonly root = new Directory(Paths.document, "recall");

  private dir = (rel: string) => new Directory(this.root, rel);
  private file = (rel: string) => new File(this.root, rel);

  async ensureDir(rel: string) {
    this.dir(rel).create({ intermediates: true, idempotent: true });
  }

  async listDir(rel: string) {
    const directory = this.dir(rel);
    return directory.exists ? directory.list().map((entry) => entry.name) : [];
  }

  async exists(rel: string) {
    return this.file(rel).exists || this.dir(rel).exists;
  }

  async copyIn(sourceUri: string, destRel: string) {
    this.dir(parentOf(destRel)).create({ intermediates: true, idempotent: true });
    await new File(sourceUri).copy(this.file(destRel));
  }

  /** tmp file, then swap. The previous manifest is only removed after the new one is fully written. */
  async writeTextAtomic(rel: string, text: string) {
    const tmp = this.file(`${rel}.tmp`);
    tmp.create({ overwrite: true, intermediates: true });
    tmp.write(text);
    const target = this.file(rel);
    if (target.exists) target.delete();
    tmp.rename(baseOf(rel)); // same parent
  }

  async readText(rel: string) {
    const target = this.file(rel);
    if (target.exists) return target.text();
    const tmp = this.file(`${rel}.tmp`); // crash between delete and rename: the complete tmp is the newest state
    if (tmp.exists) return tmp.text();
    throw new Error(`missing: ${rel}`);
  }

  async rename(fromRel: string, toRel: string) {
    if (parentOf(fromRel) !== parentOf(toRel)) throw new Error("rename must stay within one directory");
    const directory = this.dir(fromRel);
    if (directory.exists) directory.rename(baseOf(toRel));
    else this.file(fromRel).rename(baseOf(toRel));
  }

  async remove(rel: string) {
    const directory = this.dir(rel);
    if (directory.exists) return directory.delete();
    const file = this.file(rel);
    if (file.exists) file.delete();
  }

  async size(rel: string) {
    const file = this.file(rel);
    return file.exists ? file.size : null;
  }

  async sha256(rel: string) {
    const bytes = await this.file(rel).bytes();
    return { sha256: hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)), size: bytes.length };
  }

  async readHead(rel: string, length: number) {
    const handle = this.file(rel).open(FileMode.ReadOnly);
    try {
      return handle.readBytes(length);
    } finally {
      handle.close();
    }
  }

  absoluteUri(rel: string) {
    return this.file(rel).uri;
  }
}
