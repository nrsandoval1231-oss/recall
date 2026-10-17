import { useState } from "react";
import { CloudEntry } from "./CloudEntry";
import { MemorySurface } from "./surface/MemorySurface";
import { desktopLibrarian } from "./surface/native-librarian";
import { NativeLocalVault, type LocalVault } from "./platform/local-vault";

const nativeVault = new NativeLocalVault();

/** Preserve the local library; opt-in cloud mode uses the same Memory Surface. */
export function DesktopEntry({
  vault = nativeVault,
  search: _search = window.location.search,
}: {
  vault?: LocalVault;
  search?: string;
}) {
  const [cloud, setCloud] = useState(() => localStorage.getItem("megraph.desktop.cloud") === "true");
  const switchMode = (enabled: boolean) => { localStorage.setItem("megraph.desktop.cloud", String(enabled)); setCloud(enabled); };
  if (cloud) return <CloudEntry native onLocal={() => switchMode(false)} />;
  return <><MemorySurface vault={vault} librarian={desktopLibrarian()} /><button className="cloud-signout" onClick={() => switchMode(true)}>Cloud sync</button></>;
}
