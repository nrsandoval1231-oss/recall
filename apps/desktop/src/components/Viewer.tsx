import { useCallback, useEffect, useRef, useState } from "react";
import { copy, statusPresentation } from "@recall/design-tokens";
import { sha256Hex, type RecallApiClient, type ServerCapture } from "@recall/api-client";
import { formatBytes, serverStatusKey, type IntegrityState } from "../viewmodel";

interface Loaded { url: string; integrity: IntegrityState; bytes: ArrayBuffer; mediaType: string }

/**
 * Shows the exact original for each page. Every page is downloaded through the authenticated API and its
 * SHA-256 is computed locally and compared with the server-verified hash. "Verified" is only ever shown after that check.
 */
export function Viewer({ api, capture, onClose }: { api: Pick<RecallApiClient, "fetchSource">; capture: ServerCapture; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const urls = useRef<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const page = capture.pages[index];
  const stored = capture.status === "stored";

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  useEffect(() => root.current?.focus(), []);
  useEffect(() => setPreviewFailed(false), [index]);

  useEffect(() => {
    if (!page || !stored || loaded[page.source_id]) return;
    let cancelled = false;
    (async () => {
      try {
        const got = await api.fetchSource(page.source_id);
        const actual = await sha256Hex(got.bytes);
        const expected = page.server_sha256;
        const integrity: IntegrityState = !expected || got.serverSha256 !== expected
          ? { kind: "unverifiable" }
          : actual === expected ? { kind: "verified", sha256: actual } : { kind: "mismatch", expected, actual };
        const url = URL.createObjectURL(new Blob([got.bytes], { type: got.mediaType }));
        if (cancelled) return URL.revokeObjectURL(url);
        urls.current.push(url);
        if (!cancelled) setLoaded((l) => ({ ...l, [page.source_id]: { url, integrity, bytes: got.bytes, mediaType: got.mediaType } }));
      } catch {
        if (!cancelled) setError("Couldn't load this original right now. Check your connection and try again.");
      }
    })();
    return () => { cancelled = true; };
  }, [api, page, stored, loaded]);

  const go = useCallback((delta: number) => setIndex((i) => Math.min(capture.pages.length - 1, Math.max(0, i + delta))), [capture.pages.length]);
  const current = page ? loaded[page.source_id] : undefined;
  const status = statusPresentation[serverStatusKey(capture.status)];

  return (
    <div ref={root} tabIndex={-1} className="viewer" role="dialog" aria-label="Original pages"
      onKeyDown={(e) => { if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === "Escape") onClose(); }}>
      <div className="viewer-bar">
        <button onClick={onClose}>‹ Back</button>
        <h2>{capture.context_hint ?? copy.untitled}</h2>
        <span className={`pill ${status.tone}`}>{status.glyph} {status.label}</span>
      </div>
      {!stored && <p role="status" className="note">This capture's upload isn't complete, so its originals can't be shown yet. {status.detail}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="viewer-body">
        <div className="stage">
          {stored && !current && !error && <p aria-live="polite">Loading original…</p>}
          {current && !previewFailed && <img src={current.url} alt={`Original page ${page?.ordinal} of ${capture.pages.length}`} onError={() => setPreviewFailed(true)} />}
          {current && previewFailed && (
            <p role="status" className="note">This image format can't be previewed on this computer. The original is stored{current.integrity.kind === "verified" ? " and verified" : ""}; you can save an exact copy.</p>
          )}
        </div>
        {page && (
          <aside className="meta" aria-label="Source details">
            <h3>Page {page.ordinal} of {capture.pages.length}</h3>
            <dl>
              <dt>Integrity</dt>
              <dd data-testid="integrity">
                {!stored ? "Not verified yet" : !current ? "Checking…"
                  : current.integrity.kind === "verified" ? "✓ Verified: matches the server's SHA-256"
                  : current.integrity.kind === "mismatch" ? "✗ Does NOT match the stored hash. Do not rely on this copy."
                  : "Could not be verified"}
              </dd>
              <dt>SHA-256</dt><dd className="mono">{page.server_sha256 ?? page.declared_sha256}</dd>
              <dt>Type</dt><dd>{page.media_type}</dd>
              <dt>Size</dt><dd>{formatBytes(page.byte_size)}</dd>
              <dt>Captured</dt><dd>{new Date(capture.captured_at).toLocaleString()} ({capture.timezone})</dd>
              {page.original_filename && (<><dt>Filename</dt><dd>{page.original_filename}</dd></>)}
              <dt>Source ID</dt><dd className="mono">{page.source_id}</dd>
            </dl>
            {current && (
              <a className="button" href={current.url} download={`recall-${capture.capture_id.slice(0, 8)}-page-${page.ordinal}.${page.media_type.split("/")[1]}`}>Save exact copy</a>
            )}
          </aside>
        )}
      </div>
      <div className="pager">
        <button onClick={() => go(-1)} disabled={index === 0} aria-label="Previous page">◀ Previous</button>
        <span aria-live="polite">Page {index + 1} of {capture.pages.length}</span>
        <button onClick={() => go(1)} disabled={index >= capture.pages.length - 1} aria-label="Next page">Next ▶</button>
      </div>
    </div>
  );
}
