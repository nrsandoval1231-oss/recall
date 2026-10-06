import { File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { createAuth, RecallApiClient } from "@recall/api-client";
import { CaptureSyncer } from "@recall/sync";
import type { AppConfig } from "./config";
import { ExpoFiles } from "./platform/expo-files";
import { ExpoFileUploader } from "./platform/expo-uploader";
import { authStorage } from "./platform/secure-storage";

const APP_VERSION = "0.1.0";

export interface Services {
  auth: ReturnType<typeof createAuth>;
  api: RecallApiClient;
  files: ExpoFiles;
  syncer: CaptureSyncer;
  deviceId: () => string;
}

/** Stable per-install device id. Not a secret, so it lives beside the captures, not in the Keychain. */
function loadDeviceId(): string {
  const file = new File(Paths.document, "recall-device-id.txt");
  if (file.exists) {
    const existing = file.textSync().trim();
    if (existing) return existing;
  }
  const id = Crypto.randomUUID();
  file.create({ overwrite: true });
  file.write(id);
  return id;
}

export function createServices(config: AppConfig): Services {
  const auth = createAuth({ supabaseUrl: config.supabaseUrl, supabasePublishableKey: config.supabasePublishableKey, storage: authStorage });
  const api = new RecallApiClient({ baseUrl: config.apiBaseUrl, getAccessToken: () => auth.getAccessToken() });
  const files = new ExpoFiles();
  const deviceId = loadDeviceId();
  const syncer = new CaptureSyncer({
    files,
    api,
    uploader: new ExpoFileUploader(files),
    clock: { now: () => new Date() },
    uuid: () => Crypto.randomUUID(),
    currentUserId: () => auth.getUserId(),
    ensureDevice: async () => {
      await api.registerDevice({ device_id: deviceId, platform: "ios", app_version: APP_VERSION });
    },
  });
  return { auth, api, files, syncer, deviceId: () => deviceId };
}
