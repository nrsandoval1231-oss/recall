import { canonicalFixture } from "./canonical-fixture";
import { ArrowRightIcon, CalendarBlankIcon, CameraIcon, CaretRightIcon, ChartBarIcon, DotsThreeIcon, CrosshairIcon, CubeIcon, FileTextIcon, FolderSimpleIcon, GearSixIcon, HouseIcon, MapPinIcon, MagnifyingGlassIcon, WaveformIcon, SunIcon, TagIcon, UsersIcon, BuildingsIcon } from "@phosphor-icons/react";
import workspaceBackground from "./assets/recall-workspace.webp";
import canonicalReference from "../../../../docs/assets/recall-desktop-canonical-2026-10-11.png";
import { NoteMarkdown, noteSummary } from "./NoteMarkdown";
import { CaptureCalendar, QuickCards, RecentNotes, memoryTitle } from "./dashboard-parts";
import { vaultContext, noteBody, noteWithBody, type SourceRow } from "./vault-context";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LocalVault, VaultMemory, VaultRevision, VaultStatus, SourceAnswer } from "../platform/local-vault";
import { brooks, FIXTURE_BANNER, fixtureDocuments, fixtureMemory, type FixtureMemory } from "./brooks-fixture";
import { KEYWORD_LABEL, keywordSearch, type KeywordAnswer } from "./keyword";
import { hasPendingMeeting, processMeeting } from "./meeting-workflow";
import { unavailableLibrarian, type Librarian, type Reading } from "./librarian";

type Section = "organizations" | "topics" | "settings" | "vault" | "home" | "ask" | "recent" | "people" | "places" | "projects" | "equipment" | "timeline" | "capture" | "evidence";
type Panel = "topics" | "overview" | "timeline" | "people" | "places" | "equipment" | "related";
interface Selected { root: string; vault_id: string; vault_identity: string }
interface PendingCapture { operationId: string; note: string; kind?: "photo" | "text" }
interface Preview { text?: string; mime?: string; url: string; sha256: string; matches: boolean; name: string }

const RAIL: { id: Section; label: string }[] = [
  { id: "home", label: "Home" }, { id: "capture", label: "Capture" },
  { id: "projects", label: "Projects" }, { id: "people", label: "People" },
  { id: "organizations", label: "Organizations" }, { id: "topics", label: "Topics" },
  { id: "places", label: "Locations" }, { id: "timeline", label: "Calendar" }, { id: "ask", label: "Search" },
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function selectedFrom(status: VaultStatus | null): Selected | null {
  if (!status?.root || !status.vault_id || !status.vault_identity) return null;
  return { root: status.root, vault_id: status.vault_id, vault_identity: status.vault_identity };
}
function keptMemory(memory: VaultMemory): boolean {
  return memory.state !== "deleted";
}
function openable(memory: VaultMemory): boolean {
  return memory.revision > 0 && (memory.state === "active" || memory.state === "missing") && !memory.conflict;
}
function captureKey(identity: string): string {
  return `recall.desktop.capture.v1:${identity}`;
}
function operationId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("This device cannot create a save id. Nothing was written.");
  return id;
}
function readPending(identity: string): PendingCapture | null {
  const raw = sessionStorage.getItem(captureKey(identity));
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("A pending import on this device could not be read. The vault was not changed."); }
  if (!data || typeof data !== "object" || !("operationId" in data) || !("note" in data)) {
    throw new Error("A pending import on this device could not be read. The vault was not changed.");
  }
  const operationIdValue = data.operationId;
  const note = data.note;
  if (typeof operationIdValue !== "string" || !/^[0-9a-f-]{36}$/i.test(operationIdValue) || typeof note !== "string") {
    throw new Error("A pending import on this device could not be read. The vault was not changed.");
  }
  const kind = "kind" in data ? data.kind : undefined;
  if (kind !== undefined && kind !== "photo" && kind !== "text") throw new Error("Pending capture kind is invalid.");
  return { operationId: operationIdValue, note, kind };
}
function displayDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return iso;
  return `${month[0]}${month.slice(1).toLowerCase()} ${Number(match[3])}, ${match[1]}`;
}
function panelFor(section: Section): Panel {
  if (section === "people") return "people";
  if (section === "places") return "places";
  if (section === "equipment") return "equipment";
  if (section === "timeline" || section === "recent") return "timeline";
  return "overview";
}

interface TimelineTick { id: string; label: string }

function memoryTickId(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${month}`;
}

function vaultTicks(memories: VaultMemory[]): TimelineTick[] {
  const points: { year: number; month: number }[] = [];
  const seen = new Set<string>();
  for (const memory of memories) {
    const id = memoryTickId(memory.captured_at);
    const match = /^(\d{4})-(\d{2})/.exec(memory.captured_at);
    if (!id || !match || seen.has(id)) continue;
    seen.add(id);
    points.push({ year: Number(match[1]), month: Number(match[2]) });
  }
  if (points.length === 0) return [];
  points.sort((a, b) => a.year - b.year || a.month - b.month);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];
  const span = (last.year - first.year) * 12 + (last.month - first.month);
  const multi = first.year !== last.year;
  const ticks: TimelineTick[] = [];
  const push = (year: number, month: number) => {
    const name = MONTHS[month - 1] ?? "";
    ticks.push({ id: `${year}-${month}`, label: multi ? `${name} ${String(year).slice(2)}` : name });
  };
  if (span <= 8) {
    for (let index = 0; index <= span; index += 1) {
      const monthIndex = first.month - 1 + index;
      push(first.year + Math.floor(monthIndex / 12), (monthIndex % 12) + 1);
    }
  } else {
    for (const point of points) push(point.year, point.month);
  }
  return ticks;
}

function monthPhrase(label: string): string {
  const [name, year] = label.split(" ");
  if (!name) return label;
  const pretty = `${name[0] ?? ""}${name.slice(1).toLowerCase()}`;
  return year ? `${pretty} ${year}` : pretty;
}

export function MemorySurface({ vault, librarian = unavailableLibrarian }: { vault: LocalVault; librarian?: Librarian }) {
  const [vaultSettings, setVaultSettings] = useState(false);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<VaultMemory[]>([]);
  const [checking, setChecking] = useState(vault.available);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("home");
  const [panel, setPanel] = useState<Panel>("overview");
  const [answer, setAnswer] = useState<KeywordAnswer | null>(null);
  const [sourceAnswer, setSourceAnswer] = useState<SourceAnswer | null>(null);
  const [processingConsent, setProcessingConsent] = useState(false);
  const [processingState, setProcessingState] = useState("");
  const [reviewRetryAcknowledged, setReviewRetryAcknowledged] = useState(false);
  const [vaultHits, setVaultHits] = useState<VaultMemory[] | null>(null);
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [correction, setCorrection] = useState("");
  const [history, setHistory] = useState<VaultRevision[] | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [consent, setConsent] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [reader, setReader] = useState(librarian);
  const [readOp, setReadOp] = useState<string | null>(null);
  const [projectFocusId, setProjectFocusId] = useState<string | null>(null);
  const [focusMonth, setFocusMonth] = useState<string | null>(null);
  const askRef = useRef<HTMLInputElement>(null);
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const alive = useRef(true);
  const previewRef = useRef<Preview | null>(null);
  previewRef.current = preview;

  const selected = selectedFrom(status);
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = selected?.vault_id ?? null;
  const sourceRequest = useRef(0);
  const askRequest = useRef(0);
  const evidenceRef = useRef<string | null>(null);
  const correctionVersion = useRef(0);
  const organizationRequests = useRef(new Map<string, number>());
  function organizationActive() { return Boolean(selected?.vault_id && organizationRequests.current.get(selected.vault_id)); }
  function clearPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null; setPreview(null);
  }
  function inScope(vaultId: string) { return alive.current && scopeRef.current === vaultId; }
  const kept = items.filter(keptMemory);
  const active = kept.filter((memory) => memory.state === "active" && memory.revision > 0 && !memory.conflict);
  const demo = !vault.available;
  const referencePreview = demo && new URLSearchParams(globalThis.location?.search ?? "").get("design") === "canonical";
  const board = referencePreview ? canonicalFixture : brooks;
  const allContext = vaultContext(kept);
  const projectFocus = (section === "projects" || section === "organizations") && allContext.projects.some(row => row.memory.id === projectFocusId) ? active.find(memory => memory.id === projectFocusId) ?? null : null;
  const featured = projectFocus ?? active[0] ?? kept[0] ?? null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    };
  }, []);

  useEffect(() => {
    if (!vault.available) return;
    let cancel = false;
    void (async () => {
      try {
        const next = await vault.status();
        if (cancel) return;
        setStatus(next);
        const chosen = selectedFrom(next);
        if (chosen) {
          setItems(await vault.list(chosen.vault_id, ""));
          if (cancel) return;
          try {
            const restored = readPending(chosen.vault_identity);
            if (restored) {
              setPending(restored);
              setDraft(restored.note);
              setSection("capture");
            }
          } catch (pendingError) {
            setError(message(pendingError));
          }
        }
      } catch (loadError) {
        if (!cancel) setError(message(loadError));
      } finally {
        if (!cancel) setChecking(false);
      }
    })();
    return () => { cancel = true; };
  }, [vault]);

  useEffect(() => {
    setReader(librarian);
    if (!librarian.inspect) return;
    let cancel = false;
    void librarian.inspect().then((next) => {
      if (!cancel) setReader(next);
    }).catch((inspectError) => {
      if (!cancel) setError(message(inspectError));
    });
    return () => { cancel = true; };
  }, [librarian]);

  function openSettings() { settingsTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setVaultSettings(true); }
  function closeSettings() { setVaultSettings(false); settingsTrigger.current?.focus(); }
  useEffect(() => {
    if (!vaultSettings) return;
    const dialog = document.querySelector<HTMLElement>("[data-vault-dialog]");
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    function dialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") { setVaultSettings(false); settingsTrigger.current?.focus(); }
      if (event.key === "Tab") {
        const controls = dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = controls?.[0], last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", dialogKeys);
    return () => document.removeEventListener("keydown", dialogKeys);
  }, [vaultSettings]);

  function go(next: Section) {
    if (next === "vault" || next === "settings") { openSettings(); return; }
    if (next === "ask") {
      askRef.current?.focus();
      return;
    }
    if (section === "ask") setBusy(false);
    setSection(next);
    evidenceRef.current = null; sourceRequest.current += 1; askRequest.current += 1;
    setEvidenceId(null);
    setError("");
    setNotice("");
    if (!organizationActive()) setProcessingState("");
    setAnswer(null);
    setSourceAnswer(null);
    setVaultHits(null);
    if (next === "home" || next === "projects" || next === "organizations") { setPanel("overview"); setDetail(null); }
    if (next === "topics") { setPanel("topics"); setDetail(null); }
    if (next === "people" || next === "places" || next === "equipment" || next === "timeline" || next === "recent") setPanel(panelFor(next));
  }

  function selectMonth(id: string) {
    setFocusMonth(id);
    setPanel("timeline");
    setDetail(null);
    if (section === "ask") setSection("home");
  }

  async function choose(kind: "select" | "default") {
    setBusy(true); setError("");
    try {
      const next = kind === "select" ? await vault.select() : await vault.openDefault();
      if (!alive.current) return;
      if (!next) { setNotice("Folder choice cancelled. Nothing was written."); return; }
      clearPreview(); evidenceRef.current = null; askRequest.current += 1;
      setSourceAnswer(null); setProcessingState(""); setProcessingConsent(false); setReviewRetryAcknowledged(false);
      sourceRequest.current += 1;
      setStatus(next);
      const chosen = selectedFrom(next);
      setItems(chosen ? await vault.list(chosen.vault_id, "") : []);
      setNotice(kind === "default" ? "Opened the default vault folder." : "Opened the folder you chose.");
      setSection("home"); closeSettings();
      setFocusMonth(null); setProjectFocusId(null);
    } catch (chooseError) {
      if (alive.current) setError(message(chooseError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function ask(event: { preventDefault(): void }) {
    event.preventDefault();
    const request = ++askRequest.current;
    evidenceRef.current = null; sourceRequest.current += 1;
    setError("");
    setDetail(null);
    setEvidenceId(null);
    setSection("ask");
    setSourceAnswer(null);
    if (!selected) {
      setVaultHits(null);
      setAnswer(keywordSearch(query, fixtureDocuments()));
      return;
    }
    setBusy(true);
    try {
      if (vault.ask) {
        const response = await vault.ask(selected.vault_id, query);
        if (!inScope(selected.vault_id) || request !== askRequest.current) return;
        setSourceAnswer(response); setVaultHits(null); setAnswer(null); return;
      }
      const hits = await vault.list(selected.vault_id, query);
      if (!inScope(selected.vault_id) || request !== askRequest.current) return;
      setVaultHits(hits);
      setAnswer(null);
    } catch (askError) {
      if (inScope(selected.vault_id) && request === askRequest.current) setError(message(askError));
    } finally {
      if (inScope(selected.vault_id) && request === askRequest.current) setBusy(false);
    }
  }

  async function organizeMemory(memory: VaultMemory, reviewRetry = false) {
    if (!selected) return;
    const scope = selected;
    organizationRequests.current.set(scope.vault_id, (organizationRequests.current.get(scope.vault_id) ?? 0) + 1);
    const draftVersion = correctionVersion.current;
    const acknowledged = reviewRetryAcknowledged;
    setReviewRetryAcknowledged(false);
    setBusy(true); setError("");
    try {
      const published = await processMeeting(vault, scope, memory, processingConsent, (state) => { if (inScope(scope.vault_id)) setProcessingState(state); }, reviewRetry ? { reviewRetry: true, acknowledgeUncertainty: acknowledged } : undefined);
      if (!inScope(scope.vault_id) || !published) return;
      setItems((rows) => rows.map((row) => row.id === published.id ? published : row));
      if (evidenceRef.current === published.id) {
        if (correctionVersion.current === draftVersion) setCorrection(noteBody(published));
        else setNotice("Organization saved. Your newer unsaved correction draft is preserved; review the saved note before applying it.");
        setHistory(null); setProcessingConsent(false); setReviewRetryAcknowledged(false);
      }
    } catch (processingError) {
      if (inScope(scope.vault_id)) {
        if (organizationRequests.current.get(scope.vault_id) === 1) setProcessingState("");
        setError(message(processingError));
      }
    } finally {
      const remaining = (organizationRequests.current.get(scope.vault_id) ?? 1) - 1;
      if (remaining) organizationRequests.current.set(scope.vault_id, remaining);
      else organizationRequests.current.delete(scope.vault_id);
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }

  async function saveNote() {
    if (!selected || !vault.captureNote) { setError("Choose a vault in the native Recall app before saving text."); return; }
    if (!draft.trim()) { setError("Write a note before saving."); return; }
    const scope = selected;
    if (pending && pending.kind !== "text") { setError("Finish the pending photo import before saving another capture."); return; }
    const intent = pending ?? { operationId: operationId(), note: draft, kind: "text" as const };
    sessionStorage.setItem(captureKey(scope.vault_identity), JSON.stringify(intent));
    setPending(intent); setBusy(true); setError("");
    try {
      const saved = await vault.captureNote(scope.vault_id, intent.operationId, intent.note);
      if (!inScope(scope.vault_id)) return;
      sessionStorage.removeItem(captureKey(scope.vault_identity)); setPending(null); setDraft("");
      setItems((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setSection("evidence"); evidenceRef.current = saved.id; setEvidenceId(saved.id); setCorrection(noteBody(saved));
      setNotice("Saved locally with original text evidence.");
      await loadSource(scope.vault_id, saved);
      await organizeMemory(saved);
    } catch (captureError) { if (inScope(scope.vault_id)) setError(message(captureError)); }
    finally { if (inScope(scope.vault_id)) setBusy(false); }
  }

  async function importPhoto() {
    if (!vault.available) {
      setError("Open the Recall desktop app to import a photo. This preview cannot write a vault.");
      return;
    }
    if (!selected) {
      setError("Choose a vault folder, or use the default vault, before importing a photo.");
      return;
    }
    if (pending?.kind === "text") { setError("Retry the pending text save before importing a photo."); return; }
    const intent = pending ?? { operationId: operationId(), note: draft, kind: "photo" as const };
    sessionStorage.setItem(captureKey(selected.vault_identity), JSON.stringify(intent));
    setPending(intent);
    setBusy(true); setError("");
    try {
      const saved = await vault.capture(selected.vault_id, intent.operationId, intent.note);
      if (!alive.current) return;
      if (!saved) {
        sessionStorage.removeItem(captureKey(selected.vault_identity));
        setPending(null);
        setNotice("Import cancelled. Nothing was written.");
        return;
      }
      sessionStorage.removeItem(captureKey(selected.vault_identity));
      setPending(null);
      setDraft("");
      setItems((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setNotice("Saved in your vault. The original photo and a Markdown note are on this device.");
      setSection("evidence");
      evidenceRef.current = saved.id;
      setEvidenceId(saved.id);
      setCorrection(noteBody(saved));
      await loadSource(selected.vault_id, saved);
      await organizeMemory(saved);
    } catch (importError) {
      if (alive.current) setError(`${message(importError)} Retry uses the same import, so a completed save is not duplicated.`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function loadSource(vaultId: string, memory: VaultMemory) {
    const request = ++sourceRequest.current;
    const source = await vault.source(vaultId, memory.id);
    if (!inScope(vaultId) || request !== sourceRequest.current) return;
    const sha = source.sha256.toLowerCase();
    const text = source.mime_type === "text/plain" ? new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(source.bytes)) : undefined;
    const textDigest = text === undefined ? null : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(source.bytes))), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!inScope(vaultId) || request !== sourceRequest.current) return;
    const matches = sha === (textDigest ?? memory.source_sha256.toLowerCase()) && /^[0-9a-f]{64}$/.test(sha);
    const url = URL.createObjectURL(new Blob([Uint8Array.from(source.bytes)], { type: source.mime_type }));
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { url, sha256: sha, matches, name: memory.source_name || "Original text capture", text, mime: source.mime_type };
    });
  }

  async function openVaultMemory(memory: VaultMemory) {
    if (!selected || !openable(memory)) return;
    setBusy(true); setError("");
    setHistory(null);
    if (!organizationActive()) setProcessingState("");
    setProcessingConsent(false); setReviewRetryAcknowledged(false);
    clearPreview();
    setReading(null);
    setConsent(false);
    setReadOp(null);
    setConfirmRemove(false);
    setCorrection(noteBody(memory));
    evidenceRef.current = memory.id;
    askRequest.current += 1;
    setEvidenceId(memory.id);
    setSection("evidence");
    try { await loadSource(selected.vault_id, memory); }
    catch (sourceError) { if (alive.current) setError(message(sourceError)); }
    finally { if (alive.current) setBusy(false); }
  }

  function openDemoMemory(memory: FixtureMemory) {
    evidenceRef.current = null; sourceRequest.current += 1; askRequest.current += 1;
    setEvidenceId(memory.id);
    setSection("evidence");
    setPreview(null);
    setReading(null);
  }

  async function saveCorrection(memory: VaultMemory) {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const intent = { operationId: operationId(), note: noteWithBody(memory, correction), expectedRevision: memory.revision };
      const saved = await vault.correct(selected.vault_id, memory.id, intent.expectedRevision, intent.operationId, intent.note);
      if (!alive.current) return;
      setItems((rows) => rows.map((row) => row.id === saved.id ? saved : row));
      if (evidenceRef.current === memory.id) { setEvidenceId(saved.id); setCorrection(noteBody(saved)); setHistory(null); setReading(null); }
      if (!organizationActive()) setProcessingState("");
      setNotice("Correction saved in the vault. The original source is unchanged. This is your note, not a verified fact.");
    } catch (correctError) {
      if (alive.current) setError(`${message(correctError)} The draft is still here. Reload the note before saving again.`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function reload(memory: VaultMemory) {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const rows = await vault.list(selected.vault_id, "", true);
      if (!alive.current) return;
      setItems(rows.filter(keptMemory));
      const latest = rows.find((row) => row.id === memory.id);
      if (!latest) throw new Error("That memory is no longer in the vault.");
      if (evidenceRef.current === memory.id) { setCorrection(noteBody(latest)); setEvidenceId(latest.id); }
    } catch (reloadError) {
      if (alive.current) setError(message(reloadError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function removeMemory(memory: VaultMemory) {
    if (!selected || !confirmRemove) return;
    const expectedState = memory.state === "missing" ? "missing" : "active";
    if (expectedState === "active" && memory.state !== "active") return;
    setBusy(true); setError("");
    try {
      const saved = await vault.remove(selected.vault_id, memory.id, memory.revision, operationId(), expectedState);
      if (!alive.current) return;
      setItems((rows) => rows.map((row) => row.id === saved.id ? saved : row).filter(keptMemory));
      setSection("home");
      setEvidenceId(null);
      setConfirmRemove(false);
      setNotice("Removed from Recall. The original source and history remain in the vault.");
    } catch (removeError) {
      if (alive.current) setError(message(removeError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function restoreMemory(memory: VaultMemory) {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const saved = await vault.restoreNote(selected.vault_id, memory.id, memory.revision, operationId());
      if (!alive.current) return;
      setItems((rows) => rows.map((row) => row.id === saved.id ? saved : row));
      setNotice("Note restored in the vault.");
      setEvidenceId(saved.id);
    } catch (restoreError) {
      if (alive.current) setError(message(restoreError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function showHistory(memory: VaultMemory) {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const rows = await vault.history(selected.vault_id, memory.id);
      if (inScope(selected.vault_id) && evidenceRef.current === memory.id) setHistory(rows);
    } catch (historyError) {
      if (alive.current) setError(message(historyError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function readPhoto(memory: VaultMemory) {
    if (!consent || reader.mode === "unavailable" || !selected) return;
    const operation = readOp ?? operationId();
    setReadOp(operation);
    setBusy(true); setError("");
    try {
      const result = await reader.read({
        sha256: memory.source_sha256,
        note: memory.note,
        consent: true,
        operationId: operation,
        vaultId: selected.vault_id,
        memoryId: memory.id,
      });
      if (!inScope(selected.vault_id) || evidenceRef.current !== memory.id) return;
      setReading(result);
      setCorrection(result.transcription);
      setConsent(false);
      setReadOp(null);
    } catch (readError) {
      if (alive.current) setError(message(readError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const context = projectFocus ? vaultContext(kept, projectFocus.id) : allContext;
  const demoMemories = board.memories;
  const vaultMemories = projectFocus ? kept.filter(memory => memory.id === projectFocus.id) : kept;
  const evidenceMemory = kept.find((memory) => memory.id === evidenceId) ?? null;
  const demoEvidence = demo ? fixtureMemory(evidenceId ?? "") : undefined;
  const ticks: TimelineTick[] = demo ? board.months.map((month) => ({ id: month, label: month })) : vaultTicks(vaultMemories);
  const activeMonth = focusMonth && ticks.some((tick) => tick.id === focusMonth) ? focusMonth : (demo ? board.marker : ticks[ticks.length - 1]?.id ?? "");
  const activeLabel = ticks.find((tick) => tick.id === activeMonth)?.label ?? activeMonth;

  return (
    <div className="ms" data-mode={demo ? "demo" : "vault"} style={{ backgroundImage: `url(${workspaceBackground})` }}>
      <aside className="ms-rail" aria-label="Recall">
        <div className="ms-brand"><span className="ms-brand-logo" style={{ backgroundImage: `url(${canonicalReference})` }} aria-hidden="true" /><div><p className="ms-mark">RECALL</p><p className="ms-tagline">Your knowledge. In context.</p></div></div>
        <nav className="ms-nav" aria-label="Memory">
          {RAIL.map((item) => (
            <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => go(item.id)}>
              <RailIcon id={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="ms-rail-bottom"><button type="button" aria-label={`Vault ${selected ? "Connected" : "Not connected"}`} onClick={() => go("vault")}><CubeIcon weight="light" /><span>Vault<small><i data-connected={Boolean(selected)} />{selected ? "Connected" : "Not connected"}</small></span></button><button type="button" aria-label="Settings" onClick={() => go("settings")}><GearSixIcon weight="light" /><span>Settings</span></button></div>
        <blockquote className="ms-rail-quote">“Information<br />compounds when<br />it’s connected.”</blockquote>

      </aside>
      <main className="ms-stage">
        <div className="ms-atmosphere" aria-hidden="true" />
        <div className="ms-ui">
          {checking && <p className="ms-notice" role="status">Checking this device…</p>}
          {demo && !checking && <p className="ms-banner" role="status">{referencePreview ? "Design preview · synthetic reference content · not your memories" : FIXTURE_BANNER}{selected ? " This vault has no active memories yet." : ""}</p>}
          {error && <p className="ms-error" role="alert">{error}</p>}
          {notice && <p className="ms-notice" role="status">{notice}</p>}
          {processingState && <p className="ms-notice" role="status">{processingState}</p>}
          <header className="ms-mast">
            <div className="ms-greeting"><SunIcon weight="light" /><div><strong>{referencePreview ? "Good evening, Nick" : "Your day, in context."}</strong><small>Focus creates freedom.</small></div><button type="button" aria-label="Open settings" className="ms-profile" onClick={openSettings}>{referencePreview ? "NS" : <UsersIcon weight="light" />}</button></div>
            <div className="ms-askrow">
              <form className="ms-ask" role="search" onSubmit={(event) => void ask(event)}>
                <SearchIcon />
                <label className="ms-sr" htmlFor="recall-ask">Ask Recall</label>
                <input id="recall-ask" ref={askRef} type="search" value={query} placeholder="Ask Recall anything about your notes, projects, people, or business…" onChange={(event) => setQuery(event.target.value)} />
                <button type="submit" disabled={busy} aria-label="Ask"><ArrowRightIcon aria-hidden="true" /></button>
              </form>
              <button className="ms-mic" type="button" disabled aria-label="Voice ask is not available in this build"><WaveIcon /></button>
            </div>
          </header>
          <div className="ms-prompts" aria-label="Ask suggestions">{["Find my meeting notes", "What needs a follow-up?", "Find project notes", "Show decisions from this month"].map(prompt => <button type="button" key={prompt} onClick={() => { setQuery(prompt); askRef.current?.focus(); }}>{prompt}</button>)}</div>

          {section === "evidence" ? (
            <Evidence
              demo={demo}
              demoMemory={demoEvidence}
              memory={evidenceMemory}
              preview={preview}
              correction={correction}
              history={history}
              busy={busy}
              confirmRemove={confirmRemove}
              consent={consent}
              reading={reading}
              librarian={reader}
              onBack={() => go("home")}
              onCorrection={(value) => { correctionVersion.current += 1; setCorrection(value); }}
              onSave={() => evidenceMemory && void saveCorrection(evidenceMemory)}
              onReload={() => evidenceMemory && void reload(evidenceMemory)}
              onHistory={() => evidenceMemory && void showHistory(evidenceMemory)}
              onConfirmRemove={setConfirmRemove}
              onRemove={() => evidenceMemory && void removeMemory(evidenceMemory)}
              onRestore={() => evidenceMemory && void restoreMemory(evidenceMemory)}
              onConsent={(value) => { setConsent(value); if (!value) setReadOp(null); }}
              onRead={() => evidenceMemory && void readPhoto(evidenceMemory)}
              processingConsent={processingConsent}
              onProcessingConsent={setProcessingConsent}
              onOrganize={() => evidenceMemory && void organizeMemory(evidenceMemory)}
              canProcess={Boolean(vault.parse)}
              canReviewOrganization={Boolean(vault.reviewedOrganize && selected && evidenceMemory && hasPendingMeeting(selected, evidenceMemory))}
              reviewRetryAcknowledged={reviewRetryAcknowledged}
              onReviewRetryAcknowledged={setReviewRetryAcknowledged}
              onReviewedRetry={() => evidenceMemory && void organizeMemory(evidenceMemory, true)}
            />
          ) : section === "capture" ? (
            <section className="glass ms-project" aria-label="Capture">
              <p className="ms-kicker">CAPTURE</p>
              <h1>Capture a note or photo</h1>
              <p>Save messy notes or import a photo. Originals stay in your vault. Organization runs after your consent.</p>
              <form className="ms-form" onSubmit={(event) => { event.preventDefault(); void importPhoto(); }}>
                <label htmlFor="capture-note">Optional note</label>
                <textarea id="capture-note" disabled={busy} value={draft} onChange={(event) => setDraft(event.target.value)} />
                <label className="ms-check"><input type="checkbox" checked={processingConsent} onChange={(event) => setProcessingConsent(event.target.checked)} /> Send this saved source to Jev and Claude with up to four relevant vault excerpts. Provider charges apply.</label>
                <button className="ms-primary" type="button" disabled={busy || !vault.captureNote} onClick={() => void saveNote()}>{pending?.kind === "text" ? "Retry the same note" : "Save note"}</button>
                <button className="ms-primary" type="submit" disabled={busy || pending?.kind === "text"}>{pending ? "Retry the same import" : "Import photo"}</button>
              </form>
            </section>
          ) : (
            <>
              <div className="ms-columns">
                {demo && (
                  <div className="ms-side">
                    <ContextCard title="Key People" icon={<PeopleMark />} onView={() => go("people")}>
                      <ul className="ms-list">
                        {board.people.map((person, index) => (
                          <li key={person.name}><button type="button" onClick={() => { setDetail({ title: person.name, text: `${person.role}. ${person.note}` }); setPanel("people"); setSection("people"); }}><i className={referencePreview ? "ms-avatar ms-avatar-reference" : avatarTone(person.name)} style={referencePreview ? { backgroundImage: `url(${canonicalReference})`, backgroundPosition: `calc(-216px * var(--portrait-scale, 1)) calc(-${187 + index * 39}px * var(--portrait-scale, 1))` } : undefined} aria-hidden="true">{referencePreview ? "" : initials(person.name)}</i><span className="ms-person"><strong>{person.name}</strong><small className="ms-role">{person.role}</small></span></button></li>
                        ))}
                      </ul>
                      <p className="ms-more">+ {board.morePeople}</p>
                    </ContextCard>
                    <ContextCard title="Key Locations" icon={<LocationMark />} onView={() => go("places")}>
                      <ul className="ms-list">
                        {board.places.map((place) => (
                          <li key={place.name}><button type="button" onClick={() => { setDetail({ title: place.name, text: `${place.locality}. ${place.note}` }); setPanel("places"); setSection("places"); }}><PinIcon /><span className="ms-person"><strong>{place.name}</strong><small className="ms-role">{place.locality}</small></span></button></li>
                        ))}
                      </ul>
                      <p className="ms-more">+ {board.morePlaces}</p>
                    </ContextCard>
                  </div>
                )}
                {!demo && (context.people.length > 0 || context.places.length > 0 || context.related.length > 0) && <div className="ms-side">
                  {context.people.length > 0 && <ContextCard title="Key People" icon={<PeopleMark />} onView={() => go("people")}><SourceList compact="people" rows={context.people} empty="" onOpen={(memory) => void openVaultMemory(memory)} /></ContextCard>}
                  {context.places.length > 0 && <ContextCard title="Key Locations" icon={<LocationMark />} onView={() => go("places")}><SourceList compact="places" rows={context.places} empty="" onOpen={(memory) => void openVaultMemory(memory)} /></ContextCard>}
                </div>}
                {!demo && !context.people.length && !context.places.length && !context.related.length && <div className="ms-side"><ContextCard title="Key People" icon={<PeopleMark />} onView={() => go("people")}><p className="ms-fine">People mentioned in your organized notes will appear here.</p></ContextCard><ContextCard title="Key Locations" icon={<LocationMark />} onView={() => go("places")}><p className="ms-fine">Your notes bring the places into focus.</p></ContextCard></div>}
                <div className="ms-center">
                <article className="glass ms-project" aria-label={demo ? "Brooks Campus" : "Your vault"}>
                  {section === "ask" ? sourceAnswer ? <div><h1>Source-backed matches</h1><p>{sourceAnswer.message}</p>{sourceAnswer.hits.map((hit) => <article className="ms-hit" key={hit.memory_id}><h2>{items.find(row => row.id === hit.memory_id) ? memoryTitle(items.find(row => row.id === hit.memory_id)!) : hit.note_basename}</h2><NoteMarkdown>{noteBody({ id: hit.memory_id, note: hit.current_excerpt })}</NoteMarkdown><h3>Original evidence</h3><p className="ms-note">{hit.original_excerpt}</p><small>SHA-256: {hit.source_sha256}</small><button type="button" onClick={() => { const memory = items.find((row) => row.id === hit.memory_id); if (memory) void openVaultMemory(memory); }}>Inspect original evidence</button></article>)}</div> : <AskResults demo={demo} answer={answer} hits={vaultHits} onOpenDemo={(id) => { const memory = fixtureMemory(id); if (memory) openDemoMemory(memory); else setDetail(detailFrom(id)); }} onOpenVault={(memory) => void openVaultMemory(memory)} /> : (
                    <>
                      <div className="ms-project-head">
                        <p className="ms-kicker"><ProjectMark />{demo ? board.kicker : "MEMORY"}</p>
                        {demo && <button className="ms-project-menu" type="button" aria-label="Browse design notes" onClick={() => setPanel("timeline")}><DotsThreeIcon /></button>}
                        {featured && !demo && <button className="ms-project-menu" type="button" aria-label={`Open original: ${titleOf(featured)}`} onClick={() => void openVaultMemory(featured)}><DotsThreeIcon /></button>}
                        <UpdatedLine value={demo ? `Last updated ${board.updated}` : featured ? `Last updated ${displayDate(featured.updated_at)}` : "Nothing saved yet"} />
                      </div>
                      <h1>{detail?.title ?? (demo ? board.project : featured ? titleOf(featured) : "Your memory starts here")}</h1>
                      <p className="ms-place">{demo ? board.place : "Your memory. In context."}</p>
                      {detail ? <p className="ms-summary">{detail.text}</p> : panel === "overview" && <p className="ms-summary">{demo ? board.summary : (featured ? noteSummary(noteBody(featured)) : "") || "Import a photo to keep the original and a note in this vault."}</p>}
                      {!demo && (section === "projects" || section === "organizations") && panel === "overview" && !detail && !projectFocus && <SourceList rows={section === "organizations" ? allContext.projects.filter(row => row.note.startsWith("organization")) : allContext.projects} empty={section === "organizations" ? "No unresolved organization mentions saved yet." : "No unresolved project or organization mentions saved yet."} onOpen={(memory) => { setProjectFocusId(memory.id); setPanel("overview"); }} />}
                      {!demo && projectFocus && <p className="ms-fine">Context from this source only; project and organization names remain unresolved. <button type="button" onClick={() => { setProjectFocusId(null); setPanel("overview"); }}>All project sources</button></p>}
                      {demo && !referencePreview && panel === "overview" && !detail && <p className="ms-fine">{board.caveat}</p>}
                      {panel === "timeline" && !demo && <><h2>Agenda</h2><SourceList rows={context.agenda} empty="No source follow-ups saved yet." onOpen={(memory) => void openVaultMemory(memory)} /><h2>Capture calendar</h2></>}
                      {panel === "timeline" && <MemoryList demo={demo} demoMemories={demoMemories} vaultMemories={vaultMemories} month={activeMonth} monthLabel={activeLabel} onDemo={openDemoMemory} onVault={(memory) => void openVaultMemory(memory)} />}
                      {panel === "people" && !detail && !demo && <SourceList rows={context.people} empty="No unresolved people mentions saved yet." onOpen={(memory) => void openVaultMemory(memory)} />}
                      {panel === "people" && !detail && demo && <SimpleList demo={demo} rows={board.people.map((person) => ({ label: person.name, note: person.note }))} empty="People are not inferred from your notes." />}
                      {panel === "places" && !detail && !demo && <SourceList rows={context.places} empty="No unresolved location mentions saved yet." onOpen={(memory) => void openVaultMemory(memory)} />}
                      {panel === "places" && !detail && demo && <SimpleList demo={demo} rows={board.places.map((place) => ({ label: place.name, note: place.note }))} empty="Places are not inferred from your notes." />}
                      {panel === "equipment" && <SimpleList demo={demo} rows={board.equipment.map((item) => ({ label: item.label, note: item.note }))} empty="Equipment is not inferred from your notes." />}
                      {panel === "topics" && !demo && <><h2>Saved note tags</h2><SourceList rows={context.topics} empty="No note tags saved yet. Tags you keep in Obsidian appear here." onOpen={memory => void openVaultMemory(memory)} /></>}
                      {panel === "topics" && demo && <SimpleList demo rows={board.topics.map(topic => ({ label: topic.label, note: topic.note }))} empty="" />}
                      {panel === "related" && !demo && <SourceList rows={context.related} empty="No saved related memories." onOpen={(memory) => void openVaultMemory(memory)} />}
                      {panel === "related" && demo && <SimpleList demo={demo} rows={board.related.map((item) => ({ label: item.label, note: item.note }))} empty="Connections are not inferred. Ask searches the note text you saved." />}
                      {referencePreview ? <dl className="ms-project-properties"><div><CrosshairIcon weight="light" /><span>Market</span><strong>Oil &amp; Gas</strong></div><div><MapPinIcon weight="light" /><span>Region</span><strong>Permian Basin, TX</strong></div><div><ChartBarIcon weight="light" /><span>Stage</span><strong>Opportunity</strong></div><div><CalendarBlankIcon weight="light" /><span>Target Start</span><strong>Q4 2025</strong></div></dl> : <dl className="ms-stats">
                        <div><dt>Memories</dt><dd>{demo ? board.stats.memories : projectFocus ? 1 : active.length}</dd></div>
                        {demo && (
                          <>
                            <div><dt>People</dt><dd>{board.stats.people}</dd></div>
                            <div><dt>Locations</dt><dd>{board.stats.locations}</dd></div>
                            <div><dt>Key Topics</dt><dd>{board.stats.topics}</dd></div>
                          </>
                        )}
                      </dl>}
                      {demo && !referencePreview && <p className="ms-fine">{board.statsNote}</p>}
                      <div className="ms-tabs" role="tablist" aria-label="Project">
                        {(["overview", "timeline", "people", "places", "topics", "related"] as const).map((tab) => (
                          <button key={tab} type="button" role="tab" aria-selected={panel === tab} onClick={() => { setPanel(tab); setDetail(null); }}>{tab === "overview" ? "Overview" : `${tab === "timeline" ? "Notes" : tab === "places" ? "Locations" : `${tab[0]?.toUpperCase()}${tab.slice(1)}`} (${referencePreview ? { timeline: 12, people: 6, places: 3, topics: 5, related: 8 }[tab] : tab === "timeline" ? vaultMemories.length : tab === "people" ? context.people.length : tab === "places" ? context.places.length : tab === "topics" ? context.topics.length : context.related.length})`}</button>
                        ))}
                      </div>

                    </>
                  )}
                </article>
                {section !== "ask" && <RecentNotes onReference={(title, text) => { setDetail({ title, text }); setPanel("overview"); }} referencePreview={referencePreview} memories={projectFocus ? active.filter(memory => memory.id === projectFocus.id) : active} onOpen={memory => void openVaultMemory(memory)} onAll={() => go("recent")} />}
                </div>
                <CaptureCalendar key={`${selected?.vault_identity ?? "preview"}:${projectFocus?.id ?? "all"}`} onReference={(title, text) => { setDetail({ title, text }); setPanel("overview"); }} referencePreview={referencePreview} memories={projectFocus ? active.filter(memory => memory.id === projectFocus.id) : active} initialMonth={referencePreview ? "2025-04" : projectFocus?.captured_at.slice(0, 7)} agenda={context.agenda} onOpen={memory => void openVaultMemory(memory)} onCapture={() => go("capture")} />
              </div>
              {(section === "timeline" || section === "recent") && ticks.length > 0 && <TimelineStrip ticks={ticks} active={activeMonth} onSelect={selectMonth} />}
            </>
          )}
          {section !== "evidence" && section !== "capture" && <QuickCards referencePreview={referencePreview} projects={new Set(allContext.projects.map(row => row.memory.id)).size} memories={active.length} openItems={allContext.agenda.length} onProjects={() => go("projects")} onWeek={() => go("recent")} onItems={() => go("timeline")} onCapture={() => go("capture")} />}
          {vaultSettings && <div className="ms-modal-backdrop" onClick={closeSettings}><div data-vault-dialog className="ms-vault-settings" role="dialog" aria-modal="true" aria-label="Vault settings" onClick={event => event.stopPropagation()}><header><h2>Your Obsidian vault</h2><button type="button" onClick={closeSettings} aria-label="Close vault settings">Close</button></header><p>Memory stays in the folder you choose. Originals and history stay with it.</p><p className="ms-root">{selected?.root || "No vault selected"}</p><button type="button" disabled={!vault.available || busy || checking} onClick={() => void choose("select")}>Choose a vault folder</button><button type="button" disabled={!vault.available || busy || checking} onClick={() => void choose("default")}>Use default vault</button></div></div>}
        </div>
      </main>
    </div>
  );
}

function titleOf(memory: VaultMemory): string {
  const title = /^title: (".*")$/m.exec(memory.note)?.[1];
  if (memory.note.startsWith("---\nrecall_id:") && title) { try { const parsed: unknown = JSON.parse(title); if (typeof parsed === "string") return parsed; } catch { /* User-owned YAML can differ from the generated subset. */ } }
  const name = memory.source_name.replace(/\.[a-z0-9]+$/i, "");
  return name || "Meeting capture";
}
function detailFrom(id: string): { title: string; text: string } | null {
  const docs = fixtureDocuments();
  const doc = docs.find((item) => item.id === id);
  return doc ? { title: doc.title, text: doc.text } : null;
}

function RailIcon({ id }: { id: Section }) {
  const Icon = { ask: MagnifyingGlassIcon, home: HouseIcon, recent: FileTextIcon, people: UsersIcon, places: MapPinIcon, projects: FolderSimpleIcon, equipment: CubeIcon, timeline: CalendarBlankIcon, capture: CameraIcon, evidence: FileTextIcon, organizations: BuildingsIcon, topics: TagIcon, settings: GearSixIcon, vault: CubeIcon }[id];
  return <Icon size={22} weight={id === "home" ? "fill" : "light"} aria-hidden="true" />;
}

function ContextCard({ title, icon, children, onView }: { title: string; icon: ReactNode; children: ReactNode; onView?: () => void }) {
  return (
    <section className="glass ms-card" aria-label={title}>
      <header className="ms-card-head">
        <span className="ms-card-icon" aria-hidden="true">{icon}</span>
        <h2>{title}</h2>
        {onView && <button className="ms-context-view" type="button" aria-label={`View ${title.toLowerCase()}`} onClick={onView}><CaretRightIcon /></button>}
      </header>
      {children}
    </section>
  );
}

function UpdatedLine({ value }: { value: string }) {
  const match = /^Last updated (.+)$/.exec(value);
  if (!match) return <p className="ms-updated">{value}</p>;
  return <p className="ms-updated"><span>Last updated</span>{match[1]}</p>;
}

function TimelineStrip({ ticks, active, onSelect }: { ticks: TimelineTick[]; active: string; onSelect: (id: string) => void }) {
  return (
    <section className="glass ms-timeline" aria-label="Timeline">
      <div className="ms-timeline-label"><TimelineGlyph /><span>Timeline</span></div>
      <ol className="ms-months">
        {ticks.map((tick) => (
          <li key={tick.id}>
            <button type="button" aria-current={tick.id === active ? "true" : undefined} onClick={() => onSelect(tick.id)}>
              <span className="ms-tick-slot" aria-hidden="true"><span className="ms-tick" /></span>
              {tick.label}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SourceList({ rows, empty, onOpen, compact }: { rows: SourceRow[]; empty: string; onOpen: (memory: VaultMemory) => void; compact?: "people" | "places" }) {
  if (rows.length === 0) return <p className="ms-fine">{empty}</p>;
  return <ul className="ms-list">{rows.map((row, index) => <li key={`${row.memory.id}-${index}`}><button type="button" onClick={() => onOpen(row.memory)}>{compact ? <>{compact === "people" ? <i className={avatarTone(row.label)} aria-hidden="true">{initials(row.label)}</i> : <PinIcon />}<span className="ms-person"><strong>{row.label}</strong><small className="ms-role">{compact === "people" ? "Identity unresolved" : "Unresolved place"}</small></span></> : row.label}</button>{!compact && <p className="ms-fine">{row.note}</p>}</li>)}</ul>;
}

function SimpleList({ demo, rows, empty }: { demo: boolean; rows: { label: string; note: string }[]; empty: string }) {
  if (!demo) return <p className="ms-fine">{empty}</p>;
  return (
    <ul className="ms-list">
      {rows.map((row) => <li key={row.label}><strong>{row.label}</strong><p className="ms-fine">{row.note}</p></li>)}
    </ul>
  );
}

function MemoryList({ demo, demoMemories, vaultMemories, month, monthLabel, onDemo, onVault }: { demo: boolean; demoMemories: FixtureMemory[]; vaultMemories: VaultMemory[]; month: string; monthLabel: string; onDemo: (memory: FixtureMemory) => void; onVault: (memory: VaultMemory) => void }) {
  if (demo) {
    const rows = month ? demoMemories.filter((memory) => memory.month === month) : demoMemories;
    if (rows.length === 0) return <p className="ms-fine">No sample notes fall in {monthPhrase(monthLabel)}.</p>;
    return (
      <ul className="ms-list ms-memories">
        {rows.map((memory) => <li key={memory.id}><button type="button" onClick={() => onDemo(memory)}>{memory.date} · {memory.title}</button></li>)}
      </ul>
    );
  }
  const rows = month ? vaultMemories.filter((memory) => memoryTickId(memory.captured_at) === month) : vaultMemories;
  if (rows.length === 0) return <p className="ms-fine">No notes fall in {monthPhrase(monthLabel)}.</p>;
  return (
    <ul className="ms-list ms-memories">
      {rows.map((memory) => <li key={memory.id}><button type="button" onClick={() => onVault(memory)}>{displayDate(memory.captured_at)} · {titleOf(memory)}</button></li>)}
    </ul>
  );
}

function AskResults({ demo, answer, hits, onOpenDemo, onOpenVault }: { demo: boolean; answer: KeywordAnswer | null; hits: VaultMemory[] | null; onOpenDemo: (id: string) => void; onOpenVault: (memory: VaultMemory) => void }) {
  const empty = demo ? answer?.kind === "abstain" : hits?.length === 0;
  return (
    <div>
      <p className="ms-kicker">ASK</p>
      <h1>Notes that match</h1>
      <p className="ms-fine">{KEYWORD_LABEL}{demo ? " Searched the synthetic Brooks Campus fixture." : " Searched the Markdown notes in your vault."}</p>
      {answer?.kind === "abstain" && <p role="status">{answer.message}</p>}
      {answer?.kind === "matches" && (
        <>
          <p className="ms-fine">{answer.hits.length} matching notes. Showing the first {Math.min(6, answer.hits.length)}.</p>
          <ul className="ms-hits">
            {answer.hits.slice(0, 6).map((hit) => (
              <li key={hit.id} className="ms-hit"><strong>{hit.title}</strong><p>{hit.excerpt}</p><button type="button" onClick={() => onOpenDemo(hit.id)}>Open {hit.title}</button></li>
            ))}
          </ul>
        </>
      )}
      {hits && hits.length === 0 && <p role="status">Nothing in the notes matches that. This is keyword search on this device, not a Claude answer.</p>}
      {hits && hits.length > 0 && (
        <ul className="ms-hits">
          {hits.map((hit) => (
            <li key={hit.id} className="ms-hit"><strong>{titleOf(hit)}</strong><p className="ms-note">{hit.note || "No note added."}</p><button type="button" onClick={() => onOpenVault(hit)}>Open original: {titleOf(hit)}</button></li>
          ))}
        </ul>
      )}
      {empty === false && answer === null && hits === null && <p role="status">Type a question to search the notes.</p>}
    </div>
  );
}

function Evidence(props: {
  demo: boolean;
  demoMemory: FixtureMemory | undefined;
  memory: VaultMemory | null;
  preview: Preview | null;
  correction: string;
  history: VaultRevision[] | null;
  busy: boolean;
  confirmRemove: boolean;
  consent: boolean;
  reading: Reading | null;
  librarian: Librarian;
  onBack: () => void;
  onCorrection: (value: string) => void;
  onSave: () => void;
  onReload: () => void;
  onHistory: () => void;
  onConfirmRemove: (value: boolean) => void;
  onRemove: () => void;
  onRestore: () => void;
  onConsent: (value: boolean) => void;
  onRead: () => void;
  canProcess: boolean;
  processingConsent: boolean;
  onProcessingConsent: (value: boolean) => void;
  onOrganize: () => void;
  canReviewOrganization: boolean;
  reviewRetryAcknowledged: boolean;
  onReviewRetryAcknowledged: (value: boolean) => void;
  onReviewedRetry: () => void;
}) {
  const { demo, demoMemory, memory, preview, librarian } = props;
  return (
    <section className="ms-evidence" aria-label="Original evidence">
      <div className="glass">
        <button type="button" onClick={props.onBack}>Back</button>
        <p className="ms-kicker">ORIGINAL</p>
        <h1>{demoMemory?.title ?? (memory ? titleOf(memory) : "Evidence")}</h1>
        {demoMemory && (
          <>
            <article className="ms-paper-view">{demoMemory.text}</article>
            <p className="ms-fine">Synthetic design fixture. This is not a photographed page and it is not in a vault.</p>
          </>
        )}
        {memory && preview && (
          <>
            {preview.text === undefined ? <img src={preview.url} alt={`Original photo ${preview.name}`} /> : <pre className="ms-paper-view">{preview.text}</pre>}
            <p className="ms-fine" data-testid="integrity">{preview.matches ? "Hash matches the vault record. Original bytes are unchanged." : "Hash does not match the vault record. Do not treat this image as the original."}</p>
            <p className="ms-fine">{preview.sha256}</p>
            {memory.note_path && <p className="ms-fine">Recall/Memories/{memory.note_path}</p>}
          </>
        )}
        {memory && !preview && <p role="status">Opening the original…</p>}
      </div>
      <div className="glass">
        {demo && <p>Choose a vault to save a correction. This demo is not written to disk.</p>}
        {memory && (
          <>
            <p className="ms-fine">{memory.state === "missing" ? "Markdown note missing. The original is still in the vault." : memory.note.startsWith("---\nrecall_id:") ? "Organized from source statements. Uncertain items require review; edits remain yours." : "Saved in your vault. The note below is human text, not a verified reading."}</p>
            {memory.conflict && <p role="alert">{memory.conflict}</p>}
            <NoteMarkdown>{noteBody(memory) || "No note added."}</NoteMarkdown>
            <form className="ms-form" onSubmit={(event) => { event.preventDefault(); props.onSave(); }}>
              <label htmlFor="correction">Your correction</label>
              <textarea id="correction" value={props.correction} onChange={(event) => props.onCorrection(event.target.value)} />
              <button className="ms-primary" type="submit" disabled={props.busy || memory.state !== "active" || Boolean(memory.conflict)}>Save correction</button>
            </form>
            <div className="ms-actions">
              <button type="button" disabled={props.busy} onClick={props.onHistory}>History</button>
              <button type="button" disabled={props.busy} onClick={props.onReload}>Reload this note</button>
              {memory.state === "missing" && <button type="button" disabled={props.busy} onClick={props.onRestore}>Restore missing note</button>}
            </div>
            {props.history && (
              <ol className="ms-hits">
                {props.history.map((revision) => <li key={revision.revision} className="ms-hit"><strong>Revision {revision.revision}</strong><NoteMarkdown>{noteBody({ id: memory.id, note: revision.note }) || "No note added."}</NoteMarkdown><small>{revision.kind} · {revision.origin} · {revision.recorded_at}</small></li>)}
              </ol>
            )}
            <label className="ms-check"><input type="checkbox" checked={props.confirmRemove} onChange={(event) => props.onConfirmRemove(event.target.checked)} /> Remove from Recall. The original source and history stay in the vault.</label>
            <button type="button" disabled={props.busy || !props.confirmRemove} onClick={props.onRemove}>Remove from Recall</button>
            {props.canProcess && <section aria-label="Meeting processing"><h2>Organize in Obsidian</h2><label className="ms-check"><input type="checkbox" checked={props.processingConsent} onChange={(event) => props.onProcessingConsent(event.target.checked)} /> Send this source to Jev and Claude with up to four relevant vault excerpts. Provider charges apply.</label><button type="button" disabled={props.busy || !props.processingConsent || memory.state !== "active" || Boolean(memory.conflict)} onClick={props.onOrganize}>Organize this memory</button></section>}
            {props.canReviewOrganization && <section aria-label="Reviewed organization retry"><h2>Review an organization retry</h2><p>The previous request may have incurred charges. Its record and reserved budget stay intact. Review authorizes one new Claude operation using the saved Jev result.</p><label className="ms-check"><input type="checkbox" disabled={props.busy} checked={props.reviewRetryAcknowledged} onChange={(event) => props.onReviewRetryAcknowledged(event.target.checked)} /> I reviewed the failed attempt and acknowledge that another request may incur additional charges.</label><button type="button" disabled={props.busy || !props.processingConsent || !props.reviewRetryAcknowledged} onClick={props.onReviewedRetry}>Review and retry organization</button></section>}
            {memory.source_name && preview && preview.text === undefined && <ReadingBlock librarian={librarian} busy={props.busy} consent={props.consent} reading={props.reading} onConsent={props.onConsent} onRead={props.onRead} />}
          </>
        )}
      </div>
    </section>
  );
}

function ReadingBlock({ librarian, busy, consent, reading, onConsent, onRead }: { librarian: Librarian; busy: boolean; consent: boolean; reading: Reading | null; onConsent: (value: boolean) => void; onRead: () => void }) {
  if (librarian.mode === "unavailable") {
    return <p>{librarian.notice}</p>;
  }
  const claude = librarian.mode === "claude";
  return (
    <section aria-label={claude ? "Claude reading" : "Synthetic reading"}>
      <h2>Unreviewed machine reading</h2>
      <p className="ms-fine">{librarian.notice}</p>
      <label className="ms-check"><input type="checkbox" checked={consent} onChange={(event) => onConsent(event.target.checked)} /> {claude ? "Send this one photo to Claude. This costs money. The reading stays unreviewed until I save a correction." : "Use the synthetic reader for this photo. It does not call Claude."}</label>
      <button type="button" disabled={busy || !consent} onClick={onRead}>{claude ? "Read this photo with Claude" : "Read this photo"}</button>
      {reading && (
        <>
          <p className="ms-note" data-status="unreviewed">{reading.transcription}</p>
          <ul>{reading.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul>
          <p className="ms-fine">{claude ? `Unreviewed proposal from ${reading.provider}${reading.model ? ` · ${reading.model}` : ""}. It is stored beside the note, not as the note. Ask still searches the correction you save.` : `Not saved to the vault. Provider: ${reading.provider}. Saving a correction stores your words, not a verified fact.`}</p>
        </>
      )}
    </section>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function avatarTone(name: string): string {
  const tones = ["a", "b", "c", "d"];
  const index = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length;
  return `ms-avatar ms-avatar-${tones[index]}`;
}

function SearchIcon() { return <MagnifyingGlassIcon className="ms-search" size={22} weight="light" aria-hidden="true" />; }
function PinIcon() { return <MapPinIcon className="ms-pin" size={22} weight="fill" aria-hidden="true" />; }
function WaveIcon() { return <WaveformIcon size={24} weight="light" aria-hidden="true" />; }
function ProjectMark() { return <FolderSimpleIcon size={18} weight="light" aria-hidden="true" />; }
function LocationMark() { return <MapPinIcon size={18} weight="light" aria-hidden="true" />; }
function PeopleMark() { return <UsersIcon size={18} weight="light" aria-hidden="true" />; }
function TimelineGlyph() { return <CalendarBlankIcon size={18} weight="light" aria-hidden="true" />; }
