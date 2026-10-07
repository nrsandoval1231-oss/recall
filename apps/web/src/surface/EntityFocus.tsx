import type { EntityDetail } from "@recall/api-client";
import { GlassBoard, ArrowIcon, displayDate } from "./primitives";
interface Props {
  view: { entity: EntityDetail; invalidated?: boolean };
  ask: (question: string, date?: string) => void;
  focusMemory: (id: string) => void;
  focusEntity: (id: string) => void;
  supportCount: number;
  setSupportCount: (update: (n: number) => number) => void;
}
export function EntityFocus({
  view,
  ask,
  focusMemory,
  focusEntity,
  supportCount,
  setSupportCount,
}: Props) {
  return (
    <div className="entity-composition">
      <GlassBoard label="Focused context" className="primary-board">
        <p className="eyebrow">In focus · {view.entity.kind}</p>
        <h1>{view.entity.name}</h1>
        {view.invalidated ? (
          <>
            <p>Understanding changed. Refocus to load this context again.</p>
            <button
              className="button"
              onClick={() => focusEntity(view.entity.entity_id)}
            >
              Refocus {view.entity.name}
            </button>
          </>
        ) : (
          <>
            <p className="entity-intro">
              Remembered across {view.entity.memories?.length ?? 0} source
              memories.
            </p>
            {(view.entity.memories ?? [])
              .slice(0, supportCount)
              .map((memory) => (
                <button
                  className="memory-link"
                  key={memory.memory_id}
                  data-focus-key={`related-${memory.memory_id}`}
                  onClick={() => focusMemory(memory.memory_id)}
                >
                  <span>
                    {memory.context_hint ?? memory.summary ?? "Source memory"}
                    <small>{displayDate(memory.captured_at)}</small>
                  </span>
                  <span aria-hidden="true">
                    <ArrowIcon />
                  </span>
                </button>
              ))}
            {(view.entity.memories?.length ?? 0) > supportCount && (
              <button
                className="button link"
                onClick={() => setSupportCount((n) => n + 3)}
              >
                Explore more memories
              </button>
            )}
            {!view.entity.memories?.length && (
              <p>No source memories are available in this context.</p>
            )}
            {(view.entity.relationships ?? [])
              .filter((r) => r.status === "accepted")
              .slice(0, supportCount)
              .map((r) => {
                const otherId =
                  r.from_entity_id === view.entity.entity_id
                    ? r.to_entity_id
                    : r.from_entity_id;
                const name =
                  r.from_entity_id === view.entity.entity_id
                    ? r.to_name
                    : r.from_name;
                return (
                  <button
                    className="relationship-link"
                    key={r.relationship_id}
                    onClick={() => focusEntity(otherId)}
                  >
                    {name ?? "Related context"}{" "}
                    <small>{r.type.replaceAll("_", " ")}</small> <ArrowIcon />
                  </button>
                );
              })}
          </>
        )}
      </GlassBoard>
      {!view.invalidated && (
        <GlassBoard
          label="Memory through time"
          className="context-board timeline-board"
        >
          <p className="eyebrow">Memory through time</p>
          <h2>Then & now.</h2>
          <p className="muted">
            Dates show when a statement was recorded. They do not establish when
            an event happened.
          </p>
          <button
            className="timeline-now"
            onClick={() => ask(`What do you know about ${view.entity.name}?`)}
          >
            Today{" "}
            <span>
              Reconstruct current understanding <ArrowIcon />
            </span>
          </button>
          {(view.entity.timeline ?? []).slice(0, supportCount).map((item) => (
            <button
              className="timeline-point"
              key={`${item.claim_id}-${item.recorded_at}`}
              data-focus-key={`time-${item.claim_id}`}
              onClick={() =>
                ask(
                  `What do you know about ${view.entity.name}?`,
                  item.recorded_at.slice(0, 10),
                )
              }
            >
              <span>{displayDate(item.recorded_at)}</span>
              <span>{item.text}</span>
              <small>
                {item.epistemic_state} ·{" "}
                {item.valid_from
                  ? `valid from ${displayDate(item.valid_from)}`
                  : "Event date unconfirmed"}
              </small>
            </button>
          ))}
          {(view.entity.timeline?.length ?? 0) > supportCount && (
            <button
              className="button link"
              onClick={() => setSupportCount((n) => n + 3)}
            >
              Explore earlier memory
            </button>
          )}
          {!view.entity.timeline?.length && (
            <p>No supported chronology is available yet.</p>
          )}
        </GlassBoard>
      )}
    </div>
  );
}
