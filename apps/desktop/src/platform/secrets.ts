import { invoke } from "@tauri-apps/api/core";
import { chunkedSecretStorage, type SecretBackend } from "@recall/api-client";

/**
 * Auth session in the OS credential store (Windows Credential Manager) via narrow native commands.
 * The WebView gets exactly three operations on a fixed service name; no filesystem or shell access.
 * Windows limits a credential blob to ~2.5 KB, hence small chunks.
 */
const tauriBackend: SecretBackend = {
  get: (key) => invoke<string | null>("secret_get", { key }),
  set: (key, value) => invoke<void>("secret_set", { key, value }),
  remove: (key) => invoke<void>("secret_remove", { key }),
};

const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export const authStorage = chunkedSecretStorage(
  { get: (k) => tauriBackend.get(safe(k)), set: (k, v) => tauriBackend.set(safe(k), v), remove: (k) => tauriBackend.remove(safe(k)) },
  900,
);
