import { useCallback, useEffect, useRef, useState } from "react";
import { sha256Hex, type RecallApiClient } from "@recall/api-client";

export interface OriginalView {
  url: string | null;
  loading: boolean;
  error: string | null;
  load(sourceId: string, expectedSha256?: string | null): Promise<void>;
  close(): void;
}

export function useOriginal(api: RecallApiClient): OriginalView {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const request = useRef(0);
  const currentUrl = useRef<string | null>(null);

  const revokeCurrent = useCallback(() => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
  }, []);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current += 1;
      revokeCurrent();
    };
  }, [revokeCurrent]);

  const close = useCallback(() => {
    request.current += 1;
    revokeCurrent();
    if (!active.current) return;
    setUrl(null);
    setLoading(false);
    setError(null);
  }, [revokeCurrent]);

  const load = useCallback(async (sourceId: string, expectedSha256?: string | null) => {
    const requestId = ++request.current;
    revokeCurrent();
    if (active.current) {
      setUrl(null);
      setLoading(true);
      setError(null);
    }
    try {
      const source = await api.fetchSource(sourceId);
      if (!active.current || requestId !== request.current) return;
      if (!source.serverSha256) throw new Error("Original integrity hash unavailable.");
      const digest = await sha256Hex(source.bytes);
      if (!active.current || requestId !== request.current) return;
      if (digest !== source.serverSha256 || (expectedSha256 && digest !== expectedSha256)) throw new Error("Original failed integrity verification.");
      const next = URL.createObjectURL(new Blob([source.bytes], { type: source.mediaType }));
      if (!active.current || requestId !== request.current) {
        URL.revokeObjectURL(next);
        return;
      }
      currentUrl.current = next;
      setUrl(next);
    } catch (failure) {
      if (active.current && requestId === request.current) setError(failure instanceof Error ? failure.message : "Original unavailable.");
    } finally {
      if (active.current && requestId === request.current) setLoading(false);
    }
  }, [api, revokeCurrent]);

  return { url, loading, error, load, close };
}
