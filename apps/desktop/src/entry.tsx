import { MemorySurface } from "./surface/MemorySurface";
import { desktopLibrarian } from "./surface/native-librarian";
import { NativeLocalVault, type LocalVault } from "./platform/local-vault";

const nativeVault = new NativeLocalVault();

/** The local Memory Surface is the only active desktop entry. */
export function DesktopEntry({
  vault = nativeVault,
  search: _search = window.location.search,
}: {
  vault?: LocalVault;
  search?: string;
}) {
  return <MemorySurface vault={vault} librarian={desktopLibrarian()} />;
}
