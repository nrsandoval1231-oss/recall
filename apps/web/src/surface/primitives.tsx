import { useEffect, useState, type ReactNode } from "react";
import { sha256Hex, type RecallApiClient } from "@recall/api-client";

export function GlassBoard({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <section className={`glass-board ${className}`} aria-label={label}>
      {children}
    </section>
  );
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return reduced;
}
export function EvidenceArtifact({
  api,
  sourceId,
  page,
  expectedHash,
  capturedAt,
  onVerified,
  onStart,
  onFailure,
}: {
  api: Pick<RecallApiClient, "fetchSource">;
  sourceId: string;
  page: number | null;
  expectedHash?: string;
  capturedAt?: string;
  onVerified?: (sourceId: string, url: string) => void;
  onStart?: (sourceId: string) => void;
  onFailure?: (failure: unknown) => void;
}) {
  const [original, setOriginal] = useState<{
    url: string;
    mediaType: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let ownedUrl: string | null = null;
    let transferred = false;
    onStart?.(sourceId);
    setOriginal(null);
    setError(null);
    setDecodeFailed(false);
    void (async () => {
      try {
        const source = await api.fetchSource(sourceId);
        if (!live) return;
        if (!source.serverSha256)
          throw new Error("Original integrity hash unavailable.");
        const hash = await sha256Hex(source.bytes);
        if (!live) return;
        if (
          hash !== source.serverSha256 ||
          (expectedHash && hash !== expectedHash)
        )
          throw new Error("Original failed integrity verification.");
        ownedUrl = URL.createObjectURL(
          new Blob([source.bytes], { type: source.mediaType }),
        );
        setOriginal({ url: ownedUrl, mediaType: source.mediaType });
        if (onVerified) {
          onVerified(sourceId, ownedUrl);
          transferred = true;
        }
      } catch (failure) {
        if (live) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Original unavailable.",
          );
          onFailure?.(failure);
        }
      }
    })();
    return () => {
      live = false;
      if (ownedUrl && !transferred) URL.revokeObjectURL(ownedUrl);
    };
  }, [api, sourceId, expectedHash, onVerified, onStart, onFailure]);
  return (
    <figure className="evidence-artifact" aria-label="Original evidence">
      <figcaption>
        <span>Original evidence · page {page ?? "unknown"}</span>
        <span>{original ? "Verified original" : "Checking source"}</span>
      </figcaption>
      {capturedAt && (
        <p className="source-provenance">
          Captured {displayDate(capturedAt)} · immutable original
        </p>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !original ? (
        <p role="status">Retrieving and verifying your original…</p>
      ) : (
        <>
          {!decodeFailed && (
            <img
              src={original.url}
              alt={`Original evidence · page ${page ?? "unknown"}`}
              onError={() => setDecodeFailed(true)}
            />
          )}
          {decodeFailed && (
            <p>
              This browser cannot display this original format. Its verified
              bytes are available below.
            </p>
          )}
          <a
            className="source-download"
            href={original.url}
            download={`recall-original.${original.mediaType.split("/")[1] ?? "bin"}`}
          >
            Download verified original
          </a>
        </>
      )}
    </figure>
  );
}
export const displayDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function ArrowIcon({ back = false }: { back?: boolean }) {
  return (
    <svg
      className="arrow-icon"
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d={back ? "M13 8H3m0 0 4-4M3 8l4 4" : "M4 12 12 4m0 0H5m7-0v7"}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
