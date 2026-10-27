import { useState } from "react";
import { createAuth, MonolithApiClient } from "@monolith/api-client";
import { App } from "./App";
import { readConfig } from "./config";
import { authStorage } from "./platform/secrets";
import { NativeCache } from "./platform/native-cache";
import "./styles.css";
export default function LegacyCloudEntry() {
  const [loaded] = useState(() => readConfig(import.meta.env as Record<string, string | undefined>));
  const [services] = useState(() => {
    if ("missing" in loaded) return null;
    const auth = createAuth({ supabaseUrl: loaded.config.supabaseUrl, supabasePublishableKey: loaded.config.supabasePublishableKey, storage: authStorage });
    const api = new MonolithApiClient({ baseUrl: loaded.config.apiBaseUrl, getAccessToken: () => auth.getAccessToken() });
    return { auth, api, cache: new NativeCache(api) };
  });
  if ("missing" in loaded || !services) return <main className="signin"><h1>Monolith isn't configured</h1><p>Missing: {"missing" in loaded ? loaded.missing.join(", ") : "configuration"}. See docs/DEVELOPMENT.md. Monolith will not run in a pretend mode.</p></main>;
  return <App services={services} />;
}
