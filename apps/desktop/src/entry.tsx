import { lazy, Suspense } from "react";
import { LocalVaultApp } from "./local/LocalVaultApp";
import { NativeLocalVault, type LocalVault } from "./platform/local-vault";
const LegacyCloudEntry = lazy(() => import("./LegacyCloudEntry"));
const nativeVault = new NativeLocalVault();
/** Choose the local boundary before loading any cloud configuration or authentication code. */
export function DesktopEntry({ vault = nativeVault, search = window.location.search }: { vault?: LocalVault; search?: string }) {
  if (new URLSearchParams(search).get("mode") === "legacy-cloud") return <Suspense fallback={<main>Opening legacy cloud compatibility…</main>}><LegacyCloudEntry /></Suspense>;
  return <LocalVaultApp vault={vault} />;
}
