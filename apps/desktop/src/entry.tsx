import { lazy, Suspense } from "react";
import { MemorySurface } from "./surface/MemorySurface";
import { desktopLibrarian } from "./surface/native-librarian";
import { NativeLocalVault, type LocalVault } from "./platform/local-vault";

const LegacyCloudEntry = lazy(() => import("./LegacyCloudEntry"));
const nativeVault = new NativeLocalVault();

/** Local vault first. Cloud sign-in stays behind an explicit legacy mode. */
export function DesktopEntry({ vault = nativeVault, search = window.location.search }: { vault?: LocalVault; search?: string }) {
  if (new URLSearchParams(search).get("mode") === "legacy-cloud") {
    return <Suspense fallback={<main>Opening the legacy cloud view…</main>}><LegacyCloudEntry /></Suspense>;
  }
  return <MemorySurface vault={vault} librarian={desktopLibrarian()} />;
}
