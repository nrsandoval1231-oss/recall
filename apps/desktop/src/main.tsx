import React from "react";
import { createRoot } from "react-dom/client";
import { DesktopEntry } from "./entry";
import "./surface/memory-surface.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DesktopEntry />
  </React.StrictMode>,
);
