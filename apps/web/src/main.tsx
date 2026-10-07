import React from "react";
import { createRoot } from "react-dom/client";
import { RecallApiClient } from "@recall/api-client";
import { App } from "./App";
import { readConfig } from "./config";
import { createBrowserAuth } from "./auth/session";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement); const loaded = readConfig(import.meta.env as Record<string, string | undefined>);
if ("missing" in loaded) root.render(<main className="signin card"><div className="brand">Recall</div><h1>Almost ready.</h1><p className="muted">Missing configuration: {loaded.missing.join(", ")}</p></main>);
else { const auth = createBrowserAuth(); const api = new RecallApiClient({ baseUrl: loaded.config.apiBaseUrl, useSessionCookie: true }); root.render(<React.StrictMode><App services={{ auth, api }} /></React.StrictMode>); }
