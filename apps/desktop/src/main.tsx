import React from "react";
import { createRoot } from "react-dom/client";
import { DesktopEntry } from "./entry";
createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><DesktopEntry /></React.StrictMode>);
