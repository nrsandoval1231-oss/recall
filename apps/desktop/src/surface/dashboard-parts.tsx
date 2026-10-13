import { canonicalNotes } from "./canonical-fixture";
import { useState } from "react";
import {
  ArrowRightIcon,
  CalendarBlankIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  FileTextIcon,
  FolderSimpleIcon,
  LightningIcon,
  PlusIcon,
  PhoneIcon,
} from "@phosphor-icons/react";
import type { VaultMemory } from "../platform/local-vault";
import type { SourceRow } from "./vault-context";
import { noteBody } from "./vault-context";
import { noteSummary } from "./NoteMarkdown";

export function memoryTitle(memory: VaultMemory): string {
  const title = /^title: (".*")$/m.exec(memory.note)?.[1];
  if (memory.note.startsWith("---\nrecall_id:") && title) {
    try {
      const parsed: unknown = JSON.parse(title);
      if (typeof parsed === "string") return parsed;
    } catch {
      /* Editable user YAML. */
    }
  }
  return memory.source_name.replace(/\.[a-z0-9]+$/i, "") || "Meeting capture";
}

export function RecentNotes({
  referencePreview = false,
  onReference,
  memories,
  onOpen,
  onAll,
  limit = 5,
  title = "Recent Memories",
  showAllAction = true,
}: {
  referencePreview?: boolean;
  onReference?: (title: string, text: string) => void;
  memories: VaultMemory[];
  onOpen: (memory: VaultMemory) => void;
  onAll: () => void;
  limit?: number; title?: string; showAllAction?: boolean;
}) {
  const rows = [...memories]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
  return (
    <section className="glass ms-recent-notes" aria-label="Recent Notes">
      <header>
        <h2>{title}</h2>
        {showAllAction && <button type="button" onClick={onAll}>
          View all <ArrowRightIcon />
        </button>}
      </header>
      {referencePreview ? (
        <ul>
          {canonicalNotes.map((note) => (
            <li key={note.title}>
              <button
                className="ms-recent-open"
                type="button"
                onClick={() => onReference?.(note.title, note.text)}
              >
                <span className="ms-note-icon">
                  <>
                    {note.title.startsWith("Call") ? (
                      <PhoneIcon weight="light" />
                    ) : (
                      <FileTextIcon weight="light" />
                    )}
                  </>
                </span>
                <span className="ms-recent-copy">
                  <strong>{note.title}</strong>
                  <small>{note.text}</small>
                </span>
                <span className="ms-recent-meta">
                  <time>
                    {new Date(note.date + "T12:00:00Z").toLocaleDateString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      },
                    )}
                  </time>
                  <span>
                    {note.tags.map((tag) => (
                      <span key={tag} className="ms-pill">
                        {tag}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : rows.length ? (
        <ul>
          {rows.map((memory) => (
            <li key={memory.id}>
              <button
                className="ms-recent-open"
                type="button"
                aria-label={`Open original: ${memoryTitle(memory)}`}
                disabled={Boolean(memory.conflict) || memory.state === "conflict" || memory.revision < 1}
                onClick={() => onOpen(memory)}
              >
                <span className="ms-note-icon">
                  <FileTextIcon weight="light" />
                </span>
                <span className="ms-recent-copy">
                  <h3>{memoryTitle(memory)}</h3>
                  <small>
                    {noteSummary(noteBody(memory)) ||
                      "Original saved in your vault."}
                  </small>
                </span>
                <span className="ms-recent-meta">
                  <time>
                    {new Date(memory.updated_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </time>
                  <span className="ms-pill">
                    {memory.conflict || memory.state === "conflict" ? "Needs attention" : memory.state === "missing" ? "Note missing" : memory.note.startsWith("---\nrecall_id:") ? "Needs review" : "Captured"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ms-empty">
          <FileTextIcon weight="light" />
          <p>Your next note starts here.</p>
          <small>Capture a thought or a page. The original stays yours.</small>
        </div>
      )}
    </section>
  );
}

export function CaptureCalendar({
  referencePreview = false,
  onReference,
  memories,
  agenda,
  onOpen,
  onCapture,
  initialMonth,
}: {
  referencePreview?: boolean;
  onReference?: (title: string, text: string) => void;
  memories: VaultMemory[];
  agenda: SourceRow[];
  onOpen: (memory: VaultMemory) => void;
  onCapture: () => void;
  initialMonth?: string;
}) {
  const seed = initialMonth
    ? new Date(`${initialMonth}-01T12:00:00Z`)
    : new Date();
  const [month, setMonth] = useState(
    new Date(Date.UTC(seed.getUTCFullYear(), seed.getUTCMonth(), 1)),
  );
  const [day, setDay] = useState<number | null>(null);
  const monthKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = month.getUTCDay(),
    length = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
    ).getUTCDate();
  const count = Math.ceil((start + length) / 7) * 7;
  const captures = memories.filter((memory) =>
    memory.captured_at.startsWith(monthKey),
  );
  const today = new Date();
  const selectedRows =
    day === null
      ? []
      : captures.filter(
          (memory) => Number(memory.captured_at.slice(8, 10)) === day,
        );
  function move(offset: number) {
    setMonth(
      new Date(
        Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 1),
      ),
    );
    setDay(null);
  }
  return (
    <aside className="glass ms-calendar" data-selected-day={day !== null || undefined} aria-label="Capture calendar">
      <header>
        <h2><CalendarBlankIcon aria-hidden="true" /> Capture Calendar</h2>
        <div>
          <button type="button" aria-label="Previous month" onClick={() => move(-1)}><CaretLeftIcon /></button>
          <button type="button" aria-label="Next month" onClick={() => move(1)}><CaretRightIcon /></button>
        </div>
      </header>
      <h3 className="approved-calendar-month">{month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</h3>
      <div className="ms-weekdays">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="ms-calendar-days">
        {Array.from({ length: count }, (_, index) => {
          const value = index - start + 1,
            date = new Date(
              Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), value),
            ),
            inside = value > 0 && value <= length;
          const hits = inside
            ? referencePreview && monthKey === "2025-04"
              ? [14, 20, 21, 22, 23, 24, 28].includes(value)
                ? 1
                : 0
              : captures.filter(
                  (memory) => Number(memory.captured_at.slice(8, 10)) === value,
                ).length
            : 0;
          const isToday =
            inside &&
            (referencePreview && monthKey === "2025-04"
              ? value === 24
              : date.toISOString().slice(0, 10) ===
                today.toISOString().slice(0, 10));
          return (
            <button
              key={index}
              type="button"
              disabled={!inside}
              aria-label={`${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}${hits ? `, ${hits} captured notes` : ""}`}
              aria-pressed={inside && day === value}
              data-today={isToday || undefined}
              onClick={() => setDay(value)}
            >
              {date.getUTCDate()}
              <span className="ms-capture-dots">{hits > 0 ? "•" : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="ms-agenda">
        <header>
          <h2>
            {day === null
              ? referencePreview
                ? "Today"
                : "Open follow-ups"
              : `${month.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${day}`}
          </h2>
          <small>
            {day === null
              ? referencePreview
                ? "Thu, Apr 24 · sample"
                : "Unscheduled"
              : "Captured notes"}
          </small>
        </header>
        {referencePreview && day === null ? (
          <ul className="ms-agenda-list">
            {[
              { time: "9:00 AM", title: "Team sync", text: "Project updates" },
              {
                time: "11:00 AM",
                title: "Review permit package",
                text: "Permian expansion",
              },
              {
                time: "2:00 PM",
                title: "Call with contractor",
                text: "Temporary power options",
              },
              {
                time: "4:00 PM",
                title: "Update project plan",
                text: "Next steps",
              },
            ].map((event) => (
              <li key={event.title}>
                <time>{event.time}</time>
                <span className="ms-agenda-dot" />
                <button
                  type="button"
                  onClick={() =>
                    onReference?.(
                      event.title,
                      event.text +
                        ". Synthetic design event, not scheduled in your vault.",
                    )
                  }
                >
                  <strong>{event.title}</strong>
                  <small>{event.text}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : day !== null ? (
          selectedRows.length ? (
            <ul>
              {selectedRows.map((memory) => (
                <li key={memory.id}>
                  <button type="button" disabled={Boolean(memory.conflict) || memory.state === "conflict" || memory.revision < 1} onClick={() => onOpen(memory)}>
                    {memoryTitle(memory)}
                  </button>
                  {(memory.conflict || memory.state === "conflict" || memory.revision < 1) && <small>Inspection unavailable. Review this note and reload.</small>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ms-fine">No notes captured on this day.</p>
          )
        ) : agenda.length ? (
          <ul className="ms-agenda-list">
            {agenda.slice(0, 5).map((row, index) => (
              <li key={`${row.memory.id}-${index}`}>
                <span className="ms-agenda-dot" />
                <button type="button" onClick={() => onOpen(row.memory)}>
                  <strong>{row.label}</strong>
                  <small>Source follow-up · needs review</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ms-empty">
            <CheckCircleIcon weight="light" />
            <p>A little room to think.</p>
            <small>Follow-ups appear here when your notes contain them.</small>
          </div>
        )}
        <button className="ms-add-note" type="button" onClick={onCapture}>
          <PlusIcon /> Capture a note
        </button>
      </div>
    </aside>
  );
}

export function QuickCards({
  referencePreview = false,
  projects,
  memories,
  openItems,
  onProjects,
  onWeek,
  onItems,
  onCapture,
}: {
  referencePreview?: boolean;
  projects: number;
  memories: number;
  openItems: number;
  onProjects: () => void;
  onWeek: () => void;
  onItems: () => void;
  onCapture: () => void;
}) {
  const cards = [
    {
      label: referencePreview ? "Active Projects" : "Project sources",
      count: referencePreview ? 6 : projects,
      note: referencePreview
        ? "2G opportunities in focus"
        : "Context from your notes",
      icon: FolderSimpleIcon,
      action: onProjects,
    },
    {
      label: referencePreview ? "This Week" : "Recent memories",
      count: referencePreview ? 3 : memories,
      note: referencePreview
        ? "Meetings and follow-ups"
        : "Saved in your vault",
      icon: CalendarBlankIcon,
      action: onWeek,
    },
    {
      label: "Open Items",
      count: referencePreview ? 8 : openItems,
      note: referencePreview ? "Action items" : "Unscheduled follow-ups",
      icon: CheckCircleIcon,
      action: onItems,
    },
    {
      label: "Capture",
      count: null,
      note: "Drop, paste, or take a note",
      icon: LightningIcon,
      action: onCapture,
    },
  ];
  return (
    <section className="ms-quick-cards" aria-label="Quick actions">
      {cards.map((card) => (
        <button
          className="glass ms-quick-card"
          type="button"
          key={card.label}
          onClick={card.action}
        >
          <span className="ms-quick-icon">
            <card.icon weight="light" />
          </span>
          <span>
            <span className="ms-quick-label">{card.label}</span>
            {card.count !== null && <strong>{card.count}</strong>}
            <small>{card.note}</small>
          </span>
          <ArrowRightIcon className="ms-quick-arrow" />
        </button>
      ))}
    </section>
  );
}
