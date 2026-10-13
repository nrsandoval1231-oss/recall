import { BellIcon, CameraIcon, CaretRightIcon, FileTextIcon, FolderSimpleIcon, MicrophoneIcon, PaperclipIcon } from "@phosphor-icons/react";
import type { VaultMemory } from "../platform/local-vault";
import { CaptureCalendar, RecentNotes } from "./dashboard-parts";
import { vaultContext } from "./vault-context";

export function ApprovedBoard({ memories, focusId, view, onSelect, onOpen, onView, onCapture, onDropText, onDropError, onReload }: {
  memories: VaultMemory[]; focusId: string | null; view: string;
  onSelect: (id: string | null) => void; onOpen: (memory: VaultMemory) => void;
  onView: (view: "projects" | "recent" | "followups") => void;
  onCapture: (photo?: boolean) => void; onDropText: (text: string) => void; onDropError: (text: string) => void; onReload: (memory: VaultMemory) => void;
}) {
  const all = vaultContext(memories);
  const rows = all.projects.filter((row, index, list) => list.findIndex(other => other.memory.id === row.memory.id && other.label === row.label) === index);
  const focused = focusId ? memories.filter(memory => memory.id === focusId) : memories;
  const context = vaultContext(focused);
  const recent = view === "corrections" ? focused.filter(memory => memory.revision > 1) : focused;
  return <div className="approved-board">
    <div className="approved-main">
      {memories.some(memory => memory.conflict || memory.state === "conflict") && <section className="glass approved-followups" aria-label="Notes needing attention"><h2>Notes needing attention</h2><p className="ms-fine">Review these notes in Obsidian, then reload. Recall will not silently replace local edits.</p>{memories.filter(memory => memory.conflict || memory.state === "conflict").map(memory => <p key={memory.id}>{memory.source_name}: {memory.conflict || "Conflicting note state"} <button type="button" onClick={() => onReload(memory)}>Reload: {memory.source_name}</button></p>)}</section>}

      <section className="approved-projects" aria-label="Project sources">
        <header><h1><FolderSimpleIcon /> Projects</h1><button type="button" onClick={() => { onSelect(null); onView("projects"); }}>View all →</button></header>
        {focusId && <button type="button" onClick={() => onSelect(null)}>All project sources</button>}
        <div className="approved-grid">
          {rows.slice(0, view === "projects" ? undefined : 6).map((row, index) => <button type="button" key={`${row.memory.id}:${row.label}`} aria-pressed={focusId === row.memory.id} className={`approved-project tone-${index % 3}`} onClick={() => { onSelect(row.memory.id); onView("projects"); }}>
            <strong>{row.label}</strong><span>1 source · {vaultContext([row.memory]).agenda.length} follow-ups <CaretRightIcon /></span><small>Unresolved project mention</small>
          </button>)}
          {!rows.length && <div className="approved-empty"><FolderSimpleIcon /><p>No project sources yet.</p><small>Project mentions from your organized notes will appear here.</small></div>}
        </div>
      </section>
      {view === "followups" ? <FollowUps rows={context.agenda} onOpen={onOpen} /> : <RecentNotes showAllAction={view !== "recent" && view !== "corrections"} limit={view === "recent" || view === "corrections" ? recent.length : 5} title={view === "corrections" ? "Revised Memories" : "Recent Memories"} memories={recent} onOpen={onOpen} onAll={() => onView("recent")} />}
      {view === "corrections" && <p className="ms-fine">Revised memories. Inspect a memory and choose History to distinguish human corrections from organization and other revisions.</p>}
      <div className="approved-capture" onPaste={event => { const text = event.clipboardData.getData("text/plain"); if (text) { event.preventDefault(); onDropText(text); } }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const text = event.dataTransfer.getData("text/plain"); if (text) onDropText(text); else onDropError("Drop plain text here. For photos, use Add Photo; dropped files are not supported in this build."); }}>
        <CameraIcon /><button type="button" onClick={() => onCapture()}><strong>Capture something new</strong><small>Paste or drop text, or add a note or photo.</small></button>
        <button type="button" disabled title="Recording is not supported"><MicrophoneIcon /> Record</button>
        <button type="button" onClick={() => onCapture(true)}><CameraIcon /> Add Photo</button>
        <button type="button" disabled title="Document capture is not supported"><PaperclipIcon /> Add File</button>
      </div>
    </div>
    <div className="approved-right">
      <CaptureCalendar memories={focused} agenda={[]} onOpen={onOpen} onCapture={() => onCapture()} />
      <FollowUps rows={context.agenda} onOpen={onOpen} onAll={() => onView("followups")} />
      <blockquote className="approved-quote">The details you capture today<br />become the clarity you have tomorrow.<span>—</span></blockquote>
    </div>
  </div>;
}
function FollowUps({ rows, onOpen, onAll }: { rows: ReturnType<typeof vaultContext>["agenda"]; onOpen: (memory: VaultMemory) => void; onAll?: () => void }) {
  return <section className="glass approved-followups"><header><h2><BellIcon /> Follow-ups</h2>{onAll && <button type="button" onClick={onAll}>View all →</button>}</header>
    {!rows.length ? <p className="ms-fine">No source follow-ups yet.</p> : <ul>{rows.map((row, index) => <li key={`${row.memory.id}:${index}`}><button type="button" onClick={() => onOpen(row.memory)}><FileTextIcon /><span><strong>{row.label}</strong><small>Unscheduled · inspect source</small></span><CaretRightIcon /></button></li>)}</ul>}
  </section>;
}
