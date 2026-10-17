import React from "react";
import { createRoot } from "react-dom/client";
import { CloudEntry } from "./CloudEntry";
import { DesktopEntry } from "./entry";
import "./surface/memory-surface.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {"__TAURI_INTERNALS__" in window ? <DesktopEntry /> : <CloudEntry />}
  </React.StrictMode>,
);

if (!("__TAURI_INTERNALS__" in window) && "serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js", {updateViaCache: "none"});
}
