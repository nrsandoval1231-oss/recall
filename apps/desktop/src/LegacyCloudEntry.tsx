import { createAuth, RecallApiClient } from "@recall/api-client";
import { App } from "./App";
import { readConfig } from "./config";
import { NativeCache } from "./platform/native-cache";
import { authStorage } from "./platform/secrets";
import "./styles.css";

/** Preserved cloud desktop. It is not the product path. Open it with ?mode=legacy-cloud. */
export default function LegacyCloudEntry() {
  const loaded = readConfig(import.meta.env as Record<string, string | undefined>);
  if ("missing" in loaded) {
    return <main className="signin"><h1>Recall isn't configured</h1><p>Missing: {loaded.missing.join(", ")}. The legacy cloud view needs its public API settings. The vault does not.</p></main>;
  }
  const auth = createAuth({ supabaseUrl: loaded.config.supabaseUrl, supabasePublishableKey: loaded.config.supabasePublishableKey, storage: authStorage });
  const api = new RecallApiClient({ baseUrl: loaded.config.apiBaseUrl, getAccessToken: () => auth.getAccessToken() });
  return <App services={{ auth, api, cache: new NativeCache(api) }} />;
}
