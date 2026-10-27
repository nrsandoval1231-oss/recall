import React from "react";
import { createRoot } from "react-dom/client";
import { MonolithApiClient } from "@monolith/api-client";
import { App } from "./App";
import { readConfig } from "./config";
import { createBrowserAuth } from "./auth/session";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
const loaded = readConfig(
  import.meta.env as Record<string, string | undefined>,
);
if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("fixture") ===
    "memory-surface"
) {
  void import("./dev/FixtureApp").then(({ FixtureApp }) =>
    root.render(
      <React.StrictMode>
        <FixtureApp />
      </React.StrictMode>,
    ),
  );
} else if ("missing" in loaded)
  root.render(
    <main className="signin card">
      <div className="brand">Monolith</div>
      <h1>Almost ready.</h1>
      <p className="muted">
        Missing configuration: {loaded.missing.join(", ")}
      </p>
    </main>,
  );
else {
  const auth = createBrowserAuth();
  const api = new MonolithApiClient({
    baseUrl: loaded.config.apiBaseUrl,
    useSessionCookie: true,
  });
  root.render(
    <React.StrictMode>
      <App services={{ auth, api }} />
    </React.StrictMode>,
  );
}
