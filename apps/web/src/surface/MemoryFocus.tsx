import type { Citation, Claim, MemoryDetail } from "@recall/api-client";
import { GlassBoard, ArrowIcon, displayDate } from "./primitives";
interface Props {
  view: { memory: MemoryDetail; citation?: Citation; notice?: string };
  evidence: { originals: Map<string, string> };
  setEdit: (edit: { claim: Claim | null }) => void;
  focusEntity: (id: string) => void;
  inspect: (
    id: string,
    page: number | null,
    title: string,
    quote: string,
  ) => void;
  supportCount: number;
  setSupportCount: (update: (n: number) => number) => void;
}
export function MemoryFocus({
  view,
  evidence,
  setEdit,
  focusEntity,
  inspect,
  supportCount,
  setSupportCount,
}: Props) {
  return (
    <div className="memory-composition">
      <div className="preserved-source" aria-hidden="true">
        <span>Original preserved</span>
        {view.memory.interpretation.pages
          .map((page) =>
            evidence.originals.get(page.page_id) ? (
              <img
                key={page.page_id}
                src={evidence.originals.get(page.page_id)}
                alt="Verified source beneath understanding"
              />
            ) : null,
          )
          .filter(Boolean)
          .slice(0, 1)}
      </div>
      <GlassBoard
        label="Memory understanding"
        className="primary-board memory-board"
      >
        <p className="eyebrow">
          Recall’s interpretation · current revision {view.memory.revision}
        </p>
        <h1>{view.memory.context_hint ?? "A remembered moment"}</h1>
        <p className="memory-date">{displayDate(view.memory.captured_at)}</p>
        <p className="memory-summary">
          {view.memory.interpretation.summary ??
            "No summary is available. The original remains your evidence."}
        </p>
        {view.notice && (
          <p className="saved-notice" role="status">
            {view.notice}
          </p>
        )}
        {(view.memory.claims ?? [])
          .filter((c) => c.epistemic_state !== "retracted")
          .map((claim) => (
            <div className="claim" key={claim.claim_id}>
              <p>{claim.text}</p>
              <span className="claim-state">
                {claim.epistemic_state === "confirmed_by_user"
                  ? "Confirmed by you"
                  : claim.epistemic_state === "reported"
                    ? "Reported in source"
                    : claim.epistemic_state}
                {claim.temporal_text ? ` · ${claim.temporal_text}` : ""}
              </span>
              <button
                className="statement-correction"
                data-focus-key={`correct-${claim.claim_id}`}
                aria-label="Correct statement"
                onClick={() => setEdit({ claim })}
              >
                Correct
              </button>
            </div>
          ))}
        {view.memory.interpretation.summary && (
          <button
            className="button link"
            data-focus-key="correct-summary"
            onClick={() => setEdit({ claim: null })}
          >
            Correct understanding
          </button>
        )}
        {view.memory.interpretation.uncertainties.map((u, i) => (
          <p className="uncertainty" key={i}>
            Uncertain · {u.description}
          </p>
        ))}
        <div className="evidence-access">
          <span className="eyebrow">The original underneath</span>
          {view.memory.interpretation.pages.map((page) => (
            <button
              className="source-reveal"
              key={page.page_id}
              data-focus-key={`source-${page.page_id}`}
              aria-label={`Inspect original · page ${page.ordinal}`}
              onClick={() =>
                inspect(
                  page.page_id,
                  page.ordinal,
                  view.memory.context_hint ?? "Memory",
                  view.citation?.source_id === page.page_id
                    ? view.citation.quote
                    : page.transcription,
                )
              }
            >
              Reveal original{" "}
              <span>
                Page {page.ordinal} <ArrowIcon />
              </span>
            </button>
          ))}
        </div>
        {(view.memory.history?.length ?? 0) > 0 && (
          <details className="revision-history">
            <summary>How this understanding changed</summary>
            {view.memory.history?.map((revision) => (
              <div key={revision.revision}>
                <p className="eyebrow">
                  {displayDate(revision.changed_at)} ·{" "}
                  {revision.origin === "user"
                    ? "Your correction"
                    : "Earlier interpretation"}{" "}
                  · revision {revision.revision}
                </p>
                <p>{revision.summary ?? "No summary recorded"}</p>
                <small>{revision.reason}</small>
              </div>
            ))}
          </details>
        )}
      </GlassBoard>
      <GlassBoard
        label="Related context"
        className="context-board entity-context"
      >
        <p className="eyebrow">Remembered together</p>
        <h2>People & context.</h2>
        {(view.memory.entities ?? []).slice(0, supportCount).map((entity) => (
          <button
            className="entity-link"
            key={entity.entity_id}
            data-focus-key={`entity-${entity.entity_id}`}
            aria-label={`Focus ${entity.name}`}
            onClick={() => focusEntity(entity.entity_id)}
          >
            <span className="entity-initial" aria-hidden="true">
              {entity.name.charAt(0)}
            </span>
            <span>
              {entity.name}
              <small>{entity.kind}</small>
            </span>
            <span aria-hidden="true">
              <ArrowIcon />
            </span>
          </button>
        ))}
        {!view.memory.entities?.length && (
          <p>
            No resolved context yet. Recall will not guess who a name belongs
            to.
          </p>
        )}
        {(view.memory.entities?.length ?? 0) > supportCount && (
          <button
            className="button link"
            onClick={() => setSupportCount((n) => n + 3)}
          >
            Explore more context
          </button>
        )}
        <p className="context-footnote">
          Connections follow evidence.
          <br />
          Names alone are never certainty.
        </p>
      </GlassBoard>
    </div>
  );
}
