import { useCallback, useEffect, useRef, useState } from "react";

/** Verified artifacts only. Ephemeral, bounded, cleared on surface/session exit.
 * Inspection always authorizes and verifies again; this layer never serves a source request.
 */
export function useEvidenceLayer() {
  const originals = useRef(new Map<string, string>());
  const [version, setVersion] = useState(0);
  const forget = useCallback((sourceId: string) => {
    const existing = originals.current.get(sourceId);
    if (existing) {
      URL.revokeObjectURL(existing);
      originals.current.delete(sourceId);
      setVersion((v) => v + 1);
    }
  }, []);
  const clear = useCallback(() => {
    for (const url of originals.current.values()) URL.revokeObjectURL(url);
    originals.current.clear();
    setVersion((v) => v + 1);
  }, []);
  const retain = useCallback((sourceId: string, url: string) => {
    const old = originals.current.get(sourceId);
    if (old) URL.revokeObjectURL(old);
    originals.current.delete(sourceId);
    originals.current.set(sourceId, url);
    if (originals.current.size > 3) {
      const first = originals.current.keys().next().value!;
      URL.revokeObjectURL(originals.current.get(first)!);
      originals.current.delete(first);
    }
    setVersion((v) => v + 1);
  }, []);
  useEffect(
    () => () => {
      for (const url of originals.current.values()) URL.revokeObjectURL(url);
      originals.current.clear();
    },
    [],
  );
  return { originals: originals.current, retain, forget, clear, version };
}
