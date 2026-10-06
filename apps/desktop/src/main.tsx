import React from "react";
import { createRoot } from "react-dom/client";
import { createAuth, RecallApiClient } from "@recall/api-client";
import { App } from "./App";
import { readConfig } from "./config";
import { authStorage } from "./platform/secrets";
import "./styles.css";

const loaded = readConfig(import.meta.env as Record<string, string | undefined>);
const root = createRoot(document.getElementById("root") as HTMLElement);

if ("missing" in loaded) {
  root.render(<main className="signin"><h1>Recall isn't configured</h1><p>Missing: {loaded.missing.join(", ")}. See docs/DEVELOPMENT.md. Recall will not run in a pretend mode.</p></main>);
} else {
  const auth = createAuth({ supabaseUrl: loaded.config.supabaseUrl, supabasePublishableKey: loaded.config.supabasePublishableKey, storage: authStorage });
  const api = new RecallApiClient({ baseUrl: loaded.config.apiBaseUrl, getAccessToken: () => auth.getAccessToken() });
  root.render(<React.StrictMode><App services={{ auth, api }} /></React.StrictMode>);
}
