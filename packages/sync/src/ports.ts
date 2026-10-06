/**
 * Platform adapters. The sync engine contains no platform code: mobile implements these with
 * expo-file-system, tests and the e2e harness with node:fs. All paths are relative to a root
 * directory owned exclusively by the app (private, never a temp/camera/photo-library location).
 */
export interface LocalFiles {
  ensureDir(rel: string): Promise<void>;
  /** Names inside a directory; [] when it does not exist. */
  listDir(rel: string): Promise<string[]>;
  exists(rel: string): Promise<boolean>;
  /** Copy bytes from an external (possibly temporary) URI into private storage. */
  copyIn(sourceUri: string, destRel: string): Promise<void>;
  /** Write via a temp file + atomic rename; readers see the old or the new content, never a mix. */
  writeTextAtomic(rel: string, text: string): Promise<void>;
  readText(rel: string): Promise<string>;
  /**
   * Atomic rename of a file or directory WITHIN THE SAME PARENT DIRECTORY (adapters may reject others).
   * A directory rename is the commit point of a durable save.
   */
  rename(fromRel: string, toRel: string): Promise<void>;
  remove(rel: string): Promise<void>;
  size(rel: string): Promise<number | null>;
  sha256(rel: string): Promise<{ sha256: string; size: number }>;
  readHead(rel: string, length: number): Promise<Uint8Array>;
  /** URI usable by a native uploader / image view. */
  absoluteUri(rel: string): string;
}

export interface FileUploadResult {
  status: number;
  bodyText: string;
}

export interface FileUploader {
  /** PUT the file's bytes. Must resolve (not throw) on any HTTP response; throw only for transport failure. */
  putFile(request: { url: string; headers: Record<string, string> }, fileRel: string): Promise<FileUploadResult>;
}

export interface Clock {
  now(): Date;
}
