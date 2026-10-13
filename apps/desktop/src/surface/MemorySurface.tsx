import { AdaptiveGraph } from "./AdaptiveGraph";
import {
  ArrowRightIcon,
  GraphIcon,
  MicrophoneIcon,
  PencilSimpleIcon,
  CalendarBlankIcon,
  CameraIcon,
  CubeIcon,
  FileTextIcon,
  FolderSimpleIcon,
  GearSixIcon,
  HouseIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
  TagIcon,
  UsersIcon,
  BuildingsIcon,
} from "@phosphor-icons/react";

import { NoteMarkdown } from "./NoteMarkdown";
import {
  vaultContext,
  noteBody,
  noteWithBody,
  type SourceRow,
} from "./vault-context";
import { useEffect, useRef, useState } from "react";
import type {
  LocalVault,
  VaultMemory,
  VaultRevision,
  VaultStatus,
  SourceAnswer,
} from "../platform/local-vault";
import { type FixtureMemory } from "./brooks-fixture";
import { KEYWORD_LABEL, type KeywordAnswer } from "./keyword";
import { hasPendingMeeting, processMeeting } from "./meeting-workflow";
import {
  unavailableLibrarian,
  type Librarian,
  type Reading,
} from "./librarian";

type Section =
  | "graph"
  | "organizations"
  | "topics"
  | "settings"
  | "vault"
  | "home"
  | "ask"
  | "recent"
  | "people"
  | "places"
  | "projects"
  | "equipment"
  | "timeline"
  | "capture"
  | "evidence";
type Panel =
  | "topics"
  | "overview"
  | "timeline"
  | "people"
  | "places"
  | "equipment"
  | "related";
interface Selected {
  root: string;
  vault_id: string;
  vault_identity: string;
}
interface PendingCapture {
  operationId: string;
  note: string;
  kind?: "photo" | "text";
}
interface Preview {
  text?: string;
  mime?: string;
  url: string;
  sha256: string;
  matches: boolean;
  name: string;
}

const RAIL: { id: Section; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "graph", label: "Graph View" },
  { id: "recent", label: "Memories" },
  { id: "people", label: "People" },
  { id: "topics", label: "Topics" },
  { id: "timeline", label: "Timeline" },
  { id: "ask", label: "Search" },
];

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function selectedFrom(status: VaultStatus | null): Selected | null {
  if (!status?.root || !status.vault_id || !status.vault_identity) return null;
  return {
    root: status.root,
    vault_id: status.vault_id,
    vault_identity: status.vault_identity,
  };
}
function keptMemory(memory: VaultMemory): boolean {
  return memory.state !== "deleted";
}
function openable(memory: VaultMemory): boolean {
  return (
    memory.revision > 0 &&
    (memory.state === "active" ||
      memory.state === "missing" ||
      memory.state === "conflict")
  );
}
function captureKey(identity: string): string {
  return `recall.desktop.capture.v1:${identity}`;
}
function operationId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id)
    throw new Error(
      "This device cannot create a save id. Nothing was written.",
    );
  return id;
}
function readPending(identity: string): PendingCapture | null {
  const raw = sessionStorage.getItem(captureKey(identity));
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "A pending import on this device could not be read. The vault was not changed.",
    );
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("operationId" in data) ||
    !("note" in data)
  ) {
    throw new Error(
      "A pending import on this device could not be read. The vault was not changed.",
    );
  }
  const operationIdValue = data.operationId;
  const note = data.note;
  if (
    typeof operationIdValue !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(operationIdValue) ||
    typeof note !== "string"
  ) {
    throw new Error(
      "A pending import on this device could not be read. The vault was not changed.",
    );
  }
  const kind = "kind" in data ? data.kind : undefined;
  if (kind !== undefined && kind !== "photo" && kind !== "text")
    throw new Error("Pending capture kind is invalid.");
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

interface TimelineTick {
  id: string;
  label: string;
}

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
    ticks.push({
      id: `${year}-${month}`,
      label: multi ? `${name} ${String(year).slice(2)}` : name,
    });
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

export function MemorySurface({
  vault,
  librarian = unavailableLibrarian,
}: {
  vault: LocalVault;
  librarian?: Librarian;
}) {
  const [vaultSettings, setVaultSettings] = useState(false);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<VaultMemory[]>([]);
  const [checking, setChecking] = useState(vault.available);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [captureMode, setCaptureMode] = useState<"photo" | "text">("text");
  const [exploring, setExploring] = useState(false);
  const [section, setSection] = useState<Section>("home");
  const [_panel, setPanel] = useState<Panel>("overview");
  const [answer, setAnswer] = useState<KeywordAnswer | null>(null);
  const [sourceAnswer, setSourceAnswer] = useState<SourceAnswer | null>(null);
  const [processingConsent, setProcessingConsent] = useState(false);
  const [processingState, setProcessingState] = useState("");
  const [reviewRetryAcknowledged, setReviewRetryAcknowledged] = useState(false);
  const [vaultHits, setVaultHits] = useState<VaultMemory[] | null>(null);
  const [_detail, setDetail] = useState<{ title: string; text: string } | null>(
    null,
  );
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
  const [_projectFocusId, setProjectFocusId] = useState<string | null>(null);
  const [focusMonth, setFocusMonth] = useState<string | null>(null);
  const askRef = useRef<HTMLInputElement>(null);
  const inspectorTrigger = useRef<HTMLElement | SVGElement | null>(null);
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
  function organizationActive() {
    return Boolean(
      selected?.vault_id && organizationRequests.current.get(selected.vault_id),
    );
  }
  function clearPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null;
    setPreview(null);
  }
  function inScope(vaultId: string) {
    return alive.current && scopeRef.current === vaultId;
  }
  const kept = items.filter(keptMemory);
  const demo = !vault.available;

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
              setCaptureMode(restored.kind === "photo" ? "photo" : "text");
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
    return () => {
      cancel = true;
    };
  }, [vault]);

  useEffect(() => {
    setReader(librarian);
    if (!librarian.inspect) return;
    let cancel = false;
    void librarian
      .inspect()
      .then((next) => {
        if (!cancel) setReader(next);
      })
      .catch((inspectError) => {
        if (!cancel) setError(message(inspectError));
      });
    return () => {
      cancel = true;
    };
  }, [librarian]);

  function openSettings() {
    settingsTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setVaultSettings(true);
  }
  function closeSettings() {
    setVaultSettings(false);
    settingsTrigger.current?.focus();
  }
  useEffect(() => {
    if (!vaultSettings) return;
    const dialog = document.querySelector<HTMLElement>("[data-vault-dialog]");
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    function dialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setVaultSettings(false);
        settingsTrigger.current?.focus();
      }
      if (event.key === "Tab") {
        const controls = dialog?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        );
        const first = controls?.[0],
          last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", dialogKeys);
    return () => document.removeEventListener("keydown", dialogKeys);
  }, [vaultSettings]);

  function go(next: Section) {
    if (
      (section === "evidence" || section === "capture") &&
      next !== "evidence" &&
      next !== "capture"
    )
      requestAnimationFrame(() => {
        if (inspectorTrigger.current?.isConnected)
          inspectorTrigger.current.focus();
        else
          document
            .querySelector<HTMLButtonElement>(
              ".ms-nav button[aria-current=page]",
            )
            ?.focus();
      });
    if (next === "vault" || next === "settings") {
      openSettings();
      return;
    }
    if (next === "ask") {
      setSection("ask");
      requestAnimationFrame(() => askRef.current?.focus());
      return;
    }
    if (section === "ask") setBusy(false);
    if (next === "graph") setExploring(true);
    if (next === "home") setExploring(false);
    setSection(next);
    evidenceRef.current = null;
    sourceRequest.current += 1;
    askRequest.current += 1;
    setEvidenceId(null);
    setError("");
    setNotice("");
    if (!organizationActive()) setProcessingState("");
    setAnswer(null);
    setSourceAnswer(null);
    setVaultHits(null);
    if (next === "home" || next === "projects" || next === "organizations") {
      setPanel("overview");
      setDetail(null);
    }
    if (next === "topics") {
      setPanel("topics");
      setDetail(null);
    }
    if (
      next === "people" ||
      next === "places" ||
      next === "equipment" ||
      next === "timeline" ||
      next === "recent"
    )
      setPanel(panelFor(next));
  }

  async function choose(kind: "select" | "default") {
    setBusy(true);
    setError("");
    try {
      const next =
        kind === "select" ? await vault.select() : await vault.openDefault();
      if (!alive.current) return;
      if (!next) {
        setNotice("Folder choice cancelled. Nothing was written.");
        return;
      }
      clearPreview();
      evidenceRef.current = null;
      askRequest.current += 1;
      setSourceAnswer(null);
      setProcessingState("");
      setProcessingConsent(false);
      setReviewRetryAcknowledged(false);
      sourceRequest.current += 1;
      setPending(null);
      setDraft("");
      setAnswer(null);
      setVaultHits(null);
      setEvidenceId(null);
      setCorrection("");
      setHistory(null);
      setReading(null);
      setConsent(false);
      setReadOp(null);
      setQuery("");
      setConfirmRemove(false);
      setStatus(next);
      scopeRef.current = next.vault_id;
      const chosen = selectedFrom(next);
      setItems([]);
      const rows = chosen ? await vault.list(chosen.vault_id, "") : [];
      if (chosen && !inScope(chosen.vault_id)) return;
      setItems(rows);
      const restored = chosen ? readPending(chosen.vault_identity) : null;
      setPending(restored);
      setDraft(restored?.note ?? "");
      setNotice(
        kind === "default"
          ? "Opened the default vault folder."
          : "Opened the folder you chose.",
      );
      setExploring(false);
      setSection(restored ? "capture" : "home");
      setCaptureMode(restored?.kind === "photo" ? "photo" : "text");
      closeSettings();
      setFocusMonth(null);
      setProjectFocusId(null);
    } catch (chooseError) {
      if (alive.current) setError(message(chooseError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function ask(event: { preventDefault(): void }) {
    event.preventDefault();
    const request = ++askRequest.current;
    evidenceRef.current = null;
    sourceRequest.current += 1;
    setError("");
    setDetail(null);
    setEvidenceId(null);
    setSection("ask");
    setSourceAnswer(null);
    if (!selected) {
      setVaultHits(null);
      setAnswer({
        kind: "abstain",
        message:
          "No vault evidence is available. Open the native Recall app and choose a vault.",
      });
      return;
    }
    setBusy(true);
    try {
      if (vault.ask) {
        const response = await vault.ask(selected.vault_id, query);
        if (!inScope(selected.vault_id) || request !== askRequest.current)
          return;
        setSourceAnswer(response);
        setVaultHits(null);
        setAnswer(null);
        return;
      }
      const hits = await vault.list(selected.vault_id, query);
      if (!inScope(selected.vault_id) || request !== askRequest.current) return;
      setVaultHits(hits);
      setAnswer(null);
    } catch (askError) {
      if (inScope(selected.vault_id) && request === askRequest.current)
        setError(message(askError));
    } finally {
      if (inScope(selected.vault_id) && request === askRequest.current)
        setBusy(false);
    }
  }

  async function organizeMemory(memory: VaultMemory, reviewRetry = false) {
    if (!selected) return;
    const scope = selected;
    organizationRequests.current.set(
      scope.vault_id,
      (organizationRequests.current.get(scope.vault_id) ?? 0) + 1,
    );
    const draftVersion = correctionVersion.current;
    const acknowledged = reviewRetryAcknowledged;
    setReviewRetryAcknowledged(false);
    setBusy(true);
    setError("");
    try {
      const published = await processMeeting(
        vault,
        scope,
        memory,
        processingConsent,
        (state) => {
          if (inScope(scope.vault_id)) setProcessingState(state);
        },
        reviewRetry
          ? { reviewRetry: true, acknowledgeUncertainty: acknowledged }
          : undefined,
      );
      if (!inScope(scope.vault_id) || !published) return;
      setItems((rows) =>
        rows.map((row) => (row.id === published.id ? published : row)),
      );
      if (evidenceRef.current === published.id) {
        if (correctionVersion.current === draftVersion)
          setCorrection(noteBody(published));
        else
          setNotice(
            "Organization saved. Your newer unsaved correction draft is preserved; review the saved note before applying it.",
          );
        setHistory(null);
        setProcessingConsent(false);
        setReviewRetryAcknowledged(false);
      }
    } catch (processingError) {
      if (inScope(scope.vault_id)) {
        if (organizationRequests.current.get(scope.vault_id) === 1)
          setProcessingState("");
        setError(message(processingError));
      }
    } finally {
      const remaining =
        (organizationRequests.current.get(scope.vault_id) ?? 1) - 1;
      if (remaining)
        organizationRequests.current.set(scope.vault_id, remaining);
      else organizationRequests.current.delete(scope.vault_id);
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }

  async function saveNote() {
    if (!selected || !vault.captureNote) {
      setError("Choose a vault in the native Recall app before saving text.");
      return;
    }
    if (!draft.trim()) {
      setError("Write a note before saving.");
      return;
    }
    const scope = selected;
    if (pending && pending.kind !== "text") {
      setError(
        "Finish the pending photo import before saving another capture.",
      );
      return;
    }
    const intent = pending ?? {
      operationId: operationId(),
      note: draft,
      kind: "text" as const,
    };
    sessionStorage.setItem(
      captureKey(scope.vault_identity),
      JSON.stringify(intent),
    );
    setPending(intent);
    setBusy(true);
    setError("");
    try {
      const saved = await vault.captureNote(
        scope.vault_id,
        intent.operationId,
        intent.note,
      );
      if (!inScope(scope.vault_id)) return;
      sessionStorage.removeItem(captureKey(scope.vault_identity));
      setPending(null);
      setDraft("");
      setItems((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setSection("evidence");
      evidenceRef.current = saved.id;
      setEvidenceId(saved.id);
      setCorrection(noteBody(saved));
      setNotice("Saved locally with original text evidence.");
      await loadSource(scope.vault_id, saved);
      await organizeMemory(saved);
    } catch (captureError) {
      if (inScope(scope.vault_id)) setError(message(captureError));
    } finally {
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }

  async function importPhoto() {
    if (!vault.available) {
      setError(
        "Open the Recall desktop app to import a photo. This preview cannot write a vault.",
      );
      return;
    }
    if (!selected) {
      setError(
        "Choose a vault folder, or use the default vault, before importing a photo.",
      );
      return;
    }
    if (pending?.kind === "text") {
      setError("Retry the pending text save before importing a photo.");
      return;
    }
    const intent = pending ?? {
      operationId: operationId(),
      note: draft,
      kind: "photo" as const,
    };
    sessionStorage.setItem(
      captureKey(selected.vault_identity),
      JSON.stringify(intent),
    );
    setPending(intent);
    setBusy(true);
    setError("");
    try {
      const saved = await vault.capture(
        selected.vault_id,
        intent.operationId,
        intent.note,
      );
      if (!inScope(selected.vault_id)) return;
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
      setNotice(
        "Saved in your vault. The original photo and a Markdown note are on this device.",
      );
      setSection("evidence");
      evidenceRef.current = saved.id;
      setEvidenceId(saved.id);
      setCorrection(noteBody(saved));
      await loadSource(selected.vault_id, saved);
      await organizeMemory(saved);
    } catch (importError) {
      if (inScope(selected.vault_id))
        setError(
          `${message(importError)} Retry uses the same import, so a completed save is not duplicated.`,
        );
    } finally {
      if (inScope(selected.vault_id)) setBusy(false);
    }
  }

  async function loadSource(vaultId: string, memory: VaultMemory) {
    const request = ++sourceRequest.current;
    const source = await vault.source(vaultId, memory.id);
    if (!inScope(vaultId) || request !== sourceRequest.current) return;
    const sha = source.sha256.toLowerCase();
    const text =
      source.mime_type === "text/plain"
        ? new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(source.bytes),
          )
        : undefined;
    const textDigest =
      text === undefined
        ? null
        : Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                Uint8Array.from(source.bytes),
              ),
            ),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
    if (!inScope(vaultId) || request !== sourceRequest.current) return;
    const matches =
      sha === (textDigest ?? memory.source_sha256.toLowerCase()) &&
      /^[0-9a-f]{64}$/.test(sha);
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(source.bytes)], { type: source.mime_type }),
    );
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return {
        url,
        sha256: sha,
        matches,
        name: memory.source_name || "Original text capture",
        text,
        mime: source.mime_type,
      };
    });
  }

  async function openVaultMemory(memory: VaultMemory) {
    if (!selected || !openable(memory)) return;
    inspectorTrigger.current =
      document.activeElement instanceof HTMLElement ||
      document.activeElement instanceof SVGElement
        ? document.activeElement
        : null;
    setBusy(true);
    setError("");
    setHistory(null);
    if (!organizationActive()) setProcessingState("");
    setProcessingConsent(false);
    setReviewRetryAcknowledged(false);
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
    try {
      await loadSource(selected.vault_id, memory);
    } catch (sourceError) {
      if (inScope(selected.vault_id)) setError(message(sourceError));
    } finally {
      if (inScope(selected.vault_id)) setBusy(false);
    }
  }

  async function saveCorrection(memory: VaultMemory) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const intent = {
        operationId: operationId(),
        note: noteWithBody(memory, correction),
        expectedRevision: memory.revision,
      };
      const saved = await vault.correct(
        selected.vault_id,
        memory.id,
        intent.expectedRevision,
        intent.operationId,
        intent.note,
      );
      if (!inScope(selected.vault_id)) return;
      setItems((rows) =>
        rows.map((row) => (row.id === saved.id ? saved : row)),
      );
      if (evidenceRef.current === memory.id) {
        setEvidenceId(saved.id);
        setCorrection(noteBody(saved));
        setHistory(null);
        setReading(null);
      }
      if (!organizationActive()) setProcessingState("");
      setNotice(
        "Correction saved in the vault. The original source is unchanged. This is your note, not a verified fact.",
      );
    } catch (correctError) {
      if (inScope(selected.vault_id))
        setError(
          `${message(correctError)} The draft is still here. Reload the note before saving again.`,
        );
    } finally {
      if (inScope(selected.vault_id)) setBusy(false);
    }
  }

  async function reload(memory: VaultMemory) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const rows = await vault.list(selected.vault_id, "", true);
      if (!inScope(selected.vault_id)) return;
      setItems(rows.filter(keptMemory));
      const latest = rows.find((row) => row.id === memory.id);
      if (!latest) throw new Error("That memory is no longer in the vault.");
      if (evidenceRef.current === memory.id) {
        setCorrection(noteBody(latest));
        setEvidenceId(latest.id);
      }
    } catch (reloadError) {
      if (inScope(selected.vault_id)) setError(message(reloadError));
    } finally {
      if (inScope(selected.vault_id)) setBusy(false);
    }
  }

  async function removeMemory(memory: VaultMemory) {
    if (!selected || !confirmRemove) return;
    const expectedState = memory.state === "missing" ? "missing" : "active";
    if (expectedState === "active" && memory.state !== "active") return;
    setBusy(true);
    setError("");
    try {
      const saved = await vault.remove(
        selected.vault_id,
        memory.id,
        memory.revision,
        operationId(),
        expectedState,
      );
      if (!inScope(selected.vault_id)) return;
      setItems((rows) =>
        rows
          .map((row) => (row.id === saved.id ? saved : row))
          .filter(keptMemory),
      );
      setSection("home");
      setEvidenceId(null);
      setConfirmRemove(false);
      setNotice(
        "Removed from Recall. The original source and history remain in the vault.",
      );
    } catch (removeError) {
      if (inScope(selected.vault_id)) setError(message(removeError));
    } finally {
      if (inScope(selected.vault_id)) setBusy(false);
    }
  }

  async function restoreMemory(memory: VaultMemory) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const saved = await vault.restoreNote(
        selected.vault_id,
        memory.id,
        memory.revision,
        operationId(),
      );
      if (!inScope(selected.vault_id)) return;
      setItems((rows) =>
        rows.map((row) => (row.id === saved.id ? saved : row)),
      );
      setNotice("Note restored in the vault.");
      setEvidenceId(saved.id);
    } catch (restoreError) {
      if (inScope(selected.vault_id)) setError(message(restoreError));
    } finally {
      if (inScope(selected.vault_id)) setBusy(false);
    }
  }

  async function showHistory(memory: VaultMemory) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const rows = await vault.history(selected.vault_id, memory.id);
      if (inScope(selected.vault_id) && evidenceRef.current === memory.id)
        setHistory(rows);
    } catch (historyError) {
      if (inScope(selected.vault_id)) setError(message(historyError));
    } finally {
      if (inScope(selected.vault_id)) setBusy(false);
    }
  }

  async function readPhoto(memory: VaultMemory) {
    if (!consent || reader.mode === "unavailable" || !selected) return;
    const operation = readOp ?? operationId();
    setReadOp(operation);
    setBusy(true);
    setError("");
    try {
      const result = await reader.read({
        sha256: memory.source_sha256,
        note: memory.note,
        consent: true,
        operationId: operation,
        vaultId: selected.vault_id,
        memoryId: memory.id,
      });
      if (!inScope(selected.vault_id) || evidenceRef.current !== memory.id)
        return;
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

  const evidenceMemory =
    kept.find((memory) => memory.id === evidenceId) ?? null;
  const ticks = vaultTicks(kept);
  const visibleMemories = focusMonth
    ? kept.filter((m) => memoryTickId(m.captured_at) === focusMonth)
    : kept;
  const inspector =
    section === "evidence" ||
    section === "capture" ||
    section === "ask" ||
    section === "recent" ||
    section === "people" ||
    section === "topics";
  function startCapture(kind: "photo" | "text") {
    inspectorTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setCaptureMode(kind);
    go("capture");
  }
  useEffect(() => {
    if (section === "evidence" || section === "capture")
      document
        .querySelector<HTMLElement>(
          ".adaptive-inspector button, .adaptive-inspector textarea",
        )
        ?.focus();
  }, [section]);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !vaultSettings)
        go(exploring ? "graph" : "home");
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });
  return (
    <div
      className="ms adaptive"
      data-mode={demo ? "unavailable" : "vault"}
      data-inspector={inspector}
    >
      <AdaptiveGraph
        key={selected?.vault_identity ?? "no-vault"}
        memories={visibleMemories}
        explore={exploring || section === "evidence"}
        selected={evidenceId}
        highlights={
          sourceAnswer?.hits.map((h) => h.memory_id) ??
          vaultHits?.map((m) => m.id) ??
          []
        }
        onSelect={(memory) => void openVaultMemory(memory)}
      />
      <aside className="ms-rail" aria-label="Recall">
        <div className="ms-brand">
          <span className="ms-brand-logo" aria-hidden="true" />
          <span className="ms-mark">Recall</span>
        </div>
        <nav className="ms-nav" aria-label="Memory">
          {RAIL.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => go(item.id)}
            >
              <RailIcon id={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="ms-rail-bottom">
          <button type="button" aria-label="Settings" onClick={openSettings}>
            <GearSixIcon />
            <span>Settings</span>
          </button>
        </div>
      </aside>
      <main className="ms-stage">
        <div className="ms-ui">
          {checking && (
            <p className="ms-notice" role="status">
              Checking this device…
            </p>
          )}
          {error && (
            <p className="ms-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="ms-notice" role="status">
              {notice}
            </p>
          )}
          {processingState && section !== "evidence" && (
            <p className="ms-notice" role="status">
              {processingState}
            </p>
          )}
          {(section === "ask" || exploring) && (
            <form
              className="ms-ask"
              role="search"
              onSubmit={(event) => void ask(event)}
            >
              <SearchIcon />
              <label className="ms-sr" htmlFor="recall-ask">
                Ask Recall
              </label>
              <input
                id="recall-ask"
                ref={askRef}
                type="search"
                value={query}
                placeholder="Ask Recall anything…"
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit" disabled={busy} aria-label="Ask">
                <ArrowRightIcon />
              </button>
            </form>
          )}
          {!exploring && section !== "ask" && section !== "evidence" && (
            <section className="capture-center" aria-label="Capture actions">
              <h1>Capture</h1>
              <p>Turn moments into lasting memory.</p>
              <div className="capture-bubbles">
                <button
                  type="button"
                  aria-label="Camera · Import a photo"
                  onClick={() => startCapture("photo")}
                  data-active={section === "capture" && captureMode === "photo"}
                >
                  <span>
                    <CameraIcon size={40} weight="light" />
                  </span>
                  <strong>Camera</strong>
                  <small>Import a photo</small>
                </button>
                <button
                  type="button"
                  aria-label="Speak · Voice capture unavailable"
                  aria-disabled="true"
                  onClick={() =>
                    setNotice(
                      "Voice capture is unavailable in this build. Use Camera or Write.",
                    )
                  }
                >
                  <span>
                    <MicrophoneIcon size={40} weight="light" />
                  </span>
                  <strong>Speak</strong>
                  <small>Voice unavailable</small>
                </button>
                <button
                  type="button"
                  aria-label="Write · Type a note"
                  onClick={() => startCapture("text")}
                  data-active={section === "capture" && captureMode === "text"}
                >
                  <span>
                    <PencilSimpleIcon size={40} weight="light" />
                  </span>
                  <strong>Write</strong>
                  <small>Type a note</small>
                </button>
              </div>
              {demo && (
                <p className="ms-fine">
                  Open the Recall desktop app to save to your Obsidian vault.
                </p>
              )}
              {!demo && !selected && !checking && (
                <button onClick={openSettings}>
                  Choose your Obsidian vault
                </button>
              )}
            </section>
          )}
          {inspector && (
            <aside
              className="adaptive-inspector glass"
              aria-label="Memory inspector"
            >
              {
                <button
                  className="inspector-close"
                  onClick={() => go(exploring ? "graph" : "home")}
                  aria-label="Close inspector"
                >
                  ×
                </button>
              }
              {section === "evidence" ? (
                <>
                  {processingState && (
                    <section aria-label="Processing receipt">
                      <h2>Processing your memory</h2>
                      <p role="status">{processingState}</p>
                      <p>Saved · Original retained in your vault</p>
                    </section>
                  )}
                  <Evidence
                    demo={false}
                    demoMemory={undefined}
                    memory={evidenceMemory}
                    preview={preview}
                    correction={correction}
                    history={history}
                    busy={busy}
                    confirmRemove={confirmRemove}
                    consent={consent}
                    reading={reading}
                    librarian={reader}
                    onBack={() => go(exploring ? "graph" : "home")}
                    onCorrection={(value) => {
                      correctionVersion.current += 1;
                      setCorrection(value);
                    }}
                    onSave={() =>
                      evidenceMemory && void saveCorrection(evidenceMemory)
                    }
                    onReload={() =>
                      evidenceMemory && void reload(evidenceMemory)
                    }
                    onRelated={(memory) => void openVaultMemory(memory)}
                    related={
                      evidenceMemory
                        ? vaultContext(kept, evidenceMemory.id).related
                        : []
                    }
                    onOpenObsidian={
                      vault.openObsidian && selected
                        ? () => {
                            void vault.openObsidian!(
                              selected.vault_id,
                              evidenceMemory!.id,
                            )
                              .then(() => {
                                if (inScope(selected.vault_id))
                                  setNotice(
                                    "Requested Obsidian to open this note. Obsidian must be installed with this vault registered.",
                                  );
                              })
                              .catch((error) => {
                                if (inScope(selected.vault_id))
                                  setError(message(error));
                              });
                          }
                        : undefined
                    }
                    onHistory={() =>
                      evidenceMemory && void showHistory(evidenceMemory)
                    }
                    onConfirmRemove={setConfirmRemove}
                    onRemove={() =>
                      evidenceMemory && void removeMemory(evidenceMemory)
                    }
                    onRestore={() =>
                      evidenceMemory && void restoreMemory(evidenceMemory)
                    }
                    onConsent={(value) => {
                      setConsent(value);
                      if (!value) setReadOp(null);
                    }}
                    onRead={() =>
                      evidenceMemory && void readPhoto(evidenceMemory)
                    }
                    processingConsent={processingConsent}
                    onProcessingConsent={setProcessingConsent}
                    onOrganize={() =>
                      evidenceMemory && void organizeMemory(evidenceMemory)
                    }
                    canProcess={Boolean(vault.parse)}
                    canReviewOrganization={Boolean(
                      vault.reviewedOrganize &&
                      selected &&
                      evidenceMemory &&
                      hasPendingMeeting(selected, evidenceMemory),
                    )}
                    reviewRetryAcknowledged={reviewRetryAcknowledged}
                    onReviewRetryAcknowledged={setReviewRetryAcknowledged}
                    onReviewedRetry={() =>
                      evidenceMemory &&
                      void organizeMemory(evidenceMemory, true)
                    }
                  />
                </>
              ) : section === "capture" ? (
                <section aria-label="Capture">
                  <h2>{captureMode === "photo" ? "Camera" : "Write"}</h2>
                  <p>
                    {captureMode === "photo"
                      ? "Select a photo using the native file picker. Original bytes are saved before processing."
                      : "Save messy notes. Originals stay in your vault."}
                  </p>
                  <form
                    className="ms-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void (captureMode === "photo"
                        ? importPhoto()
                        : saveNote());
                    }}
                  >
                    <label htmlFor="capture-note">
                      {captureMode === "photo" ? "Optional note" : "Your note"}
                    </label>
                    <textarea
                      id="capture-note"
                      autoFocus
                      disabled={busy}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <label className="ms-check">
                      <input
                        type="checkbox"
                        checked={processingConsent}
                        onChange={(event) =>
                          setProcessingConsent(event.target.checked)
                        }
                      />{" "}
                      Send this saved source to Jev and Claude with up to four
                      relevant vault excerpts. Provider charges apply.
                    </label>
                    {captureMode === "text" && (
                      <button
                        className="ms-primary"
                        type="button"
                        disabled={busy || !vault.captureNote}
                        onClick={() => void saveNote()}
                      >
                        {pending?.kind === "text"
                          ? "Retry the same note"
                          : "Save note"}
                      </button>
                    )}
                    {captureMode === "photo" && (
                      <button
                        type="button"
                        disabled={busy || pending?.kind === "text"}
                        onClick={() => void importPhoto()}
                      >
                        {pending ? "Retry the same import" : "Import photo"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => go(exploring ? "graph" : "home")}
                    >
                      Cancel
                    </button>
                  </form>
                </section>
              ) : section === "ask" ? (
                sourceAnswer ? (
                  <section>
                    <h1>Source-backed matches</h1>
                    <p>{sourceAnswer.message}</p>
                    {sourceAnswer.hits.map((hit) => (
                      <article className="ms-hit" key={hit.memory_id}>
                        <h2>
                          {items.find((m) => m.id === hit.memory_id)
                            ? titleOf(
                                items.find((m) => m.id === hit.memory_id)!,
                              )
                            : hit.note_basename}
                        </h2>
                        <NoteMarkdown>
                          {noteBody({
                            id: hit.memory_id,
                            note: hit.current_excerpt,
                          })}
                        </NoteMarkdown>
                        <h3>Original evidence</h3>
                        <p>{hit.original_excerpt}</p>
                        <small>SHA-256: {hit.source_sha256}</small>
                        <button
                          onClick={() => {
                            const memory = items.find(
                              (m) => m.id === hit.memory_id,
                            );
                            if (memory) void openVaultMemory(memory);
                          }}
                        >
                          Inspect original evidence
                        </button>
                      </article>
                    ))}
                  </section>
                ) : (
                  <AskResults
                    demo={false}
                    answer={answer}
                    hits={vaultHits}
                    onOpenDemo={() => {}}
                    onOpenVault={(memory) => void openVaultMemory(memory)}
                  />
                )
              ) : (
                <section>
                  <h2>
                    {section === "people"
                      ? "People mentioned"
                      : section === "topics"
                        ? "Topics"
                        : "Memories"}
                  </h2>
                  {section === "people" || section === "topics" ? (
                    <SourceList
                      rows={
                        section === "people"
                          ? vaultContext(visibleMemories).people
                          : vaultContext(visibleMemories).topics
                      }
                      empty="No grounded mentions yet."
                      onOpen={(memory) => void openVaultMemory(memory)}
                    />
                  ) : (
                    <>
                      {visibleMemories.length === 0 && (
                        <p>No memories yet. Capture a source to begin.</p>
                      )}
                      {visibleMemories.map((memory) => (
                        <article className="ms-hit" key={memory.id}>
                          <h3>{titleOf(memory)}</h3>
                          <p>
                            {displayDate(memory.captured_at)} · revision{" "}
                            {memory.revision}
                          </p>
                          <button onClick={() => void openVaultMemory(memory)}>
                            Open original: {titleOf(memory)}
                          </button>
                        </article>
                      ))}
                    </>
                  )}
                </section>
              )}
            </aside>
          )}
          {section === "timeline" && (
            <section className="adaptive-timeline glass" aria-label="Timeline">
              <label>
                Source capture month
                <select
                  aria-label="Source capture month"
                  value={focusMonth ?? ""}
                  onChange={(e) => setFocusMonth(e.target.value || null)}
                >
                  <option value="">All dates</option>
                  {ticks.map((tick) => (
                    <option key={tick.id} value={tick.id}>
                      {tick.label}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => setFocusMonth(null)}>Reset dates</button>
              <p>
                Filters source capture dates; interpretation revisions remain in
                History.
              </p>
              {visibleMemories.map((memory) => (
                <button
                  key={memory.id}
                  onClick={() => void openVaultMemory(memory)}
                >
                  {displayDate(memory.captured_at)} · {titleOf(memory)}
                </button>
              ))}
            </section>
          )}
          {vaultSettings && (
            <div className="ms-modal-backdrop" onClick={closeSettings}>
              <div
                data-vault-dialog
                className="ms-vault-settings"
                role="dialog"
                aria-modal="true"
                aria-label="Vault settings"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <h2>Your Obsidian vault</h2>
                  <button
                    type="button"
                    onClick={closeSettings}
                    aria-label="Close vault settings"
                  >
                    Close
                  </button>
                </header>
                <p>
                  Memory stays in the folder you choose. Originals and history
                  stay with it.
                </p>
                <p className="ms-root">
                  {selected?.root || "No vault selected"}
                </p>
                <button
                  type="button"
                  disabled={!vault.available || busy || checking}
                  onClick={() => void choose("select")}
                >
                  Choose a vault folder
                </button>
                <button
                  type="button"
                  disabled={!vault.available || busy || checking}
                  onClick={() => void choose("default")}
                >
                  Use default vault
                </button>
              </div>
            </div>
          )}
          {section === "evidence" && (
            <div
              className="compact-capture"
              aria-label="Capture another source"
            >
              <button onClick={() => startCapture("photo")}>
                <CameraIcon /> Camera
              </button>
              <button onClick={() => startCapture("text")}>
                <PencilSimpleIcon /> Write
              </button>
            </div>
          )}
          <footer className="adaptive-signature">
            CAPTURE · UNDERSTAND · CONNECT
          </footer>
        </div>
      </main>
    </div>
  );
}

function titleOf(memory: VaultMemory): string {
  const title = /^title: (".*")$/m.exec(memory.note)?.[1];
  if (memory.note.startsWith("---\nrecall_id:") && title) {
    try {
      const parsed: unknown = JSON.parse(title);
      if (typeof parsed === "string") return parsed;
    } catch {
      /* User-owned YAML can differ from the generated subset. */
    }
  }
  const name = memory.source_name.replace(/\.[a-z0-9]+$/i, "");
  return name || "Meeting capture";
}
function RailIcon({ id }: { id: Section }) {
  const Icon = {
    graph: GraphIcon,
    ask: MagnifyingGlassIcon,
    home: HouseIcon,
    recent: FileTextIcon,
    people: UsersIcon,
    places: MapPinIcon,
    projects: FolderSimpleIcon,
    equipment: CubeIcon,
    timeline: CalendarBlankIcon,
    capture: CameraIcon,
    evidence: FileTextIcon,
    organizations: BuildingsIcon,
    topics: TagIcon,
    settings: GearSixIcon,
    vault: CubeIcon,
  }[id];
  return (
    <Icon
      size={22}
      weight={id === "home" ? "fill" : "light"}
      aria-hidden="true"
    />
  );
}

function SourceList({
  rows,
  empty,
  onOpen,
}: {
  rows: SourceRow[];
  empty: string;
  onOpen: (memory: VaultMemory) => void;
}) {
  if (rows.length === 0) return <p className="ms-fine">{empty}</p>;
  return (
    <ul className="ms-list">
      {rows.map((row, index) => (
        <li key={`${row.memory.id}-${index}`}>
          <button onClick={() => onOpen(row.memory)}>{row.label}</button>
          <p className="ms-fine">{row.note}</p>
        </li>
      ))}
    </ul>
  );
}

function AskResults({
  demo,
  answer,
  hits,
  onOpenDemo,
  onOpenVault,
}: {
  demo: boolean;
  answer: KeywordAnswer | null;
  hits: VaultMemory[] | null;
  onOpenDemo: (id: string) => void;
  onOpenVault: (memory: VaultMemory) => void;
}) {
  const empty = demo ? answer?.kind === "abstain" : hits?.length === 0;
  return (
    <div>
      <p className="ms-kicker">ASK</p>
      <h1>Notes that match</h1>
      <p className="ms-fine">
        {KEYWORD_LABEL}
        {demo
          ? " Searched the synthetic Brooks Campus fixture."
          : " Searched the Markdown notes in your vault."}
      </p>
      {answer?.kind === "abstain" && <p role="status">{answer.message}</p>}
      {answer?.kind === "matches" && (
        <>
          <p className="ms-fine">
            {answer.hits.length} matching notes. Showing the first{" "}
            {Math.min(6, answer.hits.length)}.
          </p>
          <ul className="ms-hits">
            {answer.hits.slice(0, 6).map((hit) => (
              <li key={hit.id} className="ms-hit">
                <strong>{hit.title}</strong>
                <p>{hit.excerpt}</p>
                <button type="button" onClick={() => onOpenDemo(hit.id)}>
                  Open {hit.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {hits && hits.length === 0 && (
        <p role="status">
          Nothing in the notes matches that. This is keyword search on this
          device, not a Claude answer.
        </p>
      )}
      {hits && hits.length > 0 && (
        <ul className="ms-hits">
          {hits.map((hit) => (
            <li key={hit.id} className="ms-hit">
              <strong>{titleOf(hit)}</strong>
              <p className="ms-note">{hit.note || "No note added."}</p>
              <button type="button" onClick={() => onOpenVault(hit)}>
                Open original: {titleOf(hit)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {empty === false && answer === null && hits === null && (
        <p role="status">Type a question to search the notes.</p>
      )}
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
  related: SourceRow[];
  onRelated: (memory: VaultMemory) => void;
  onOpenObsidian?: () => void;
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
  const [tab, setTab] = useState("overview");
  useEffect(() => setTab("overview"), [memory?.id]);
  return (
    <section
      className="ms-evidence"
      aria-label="Original evidence"
      data-tab={tab}
    >
      <div className="inspector-tabs" role="tablist" aria-label="Memory layers">
        {["overview", "original", "understanding", "related", "history"].map(
          (layer) => (
            <button
              type="button"
              role="tab"
              id={`memory-tab-${layer}`}
              aria-controls="memory-layer-panel"
              tabIndex={tab === layer ? 0 : -1}
              aria-selected={tab === layer}
              onKeyDown={(event) => {
                const layers = [
                  "overview",
                  "original",
                  "understanding",
                  "related",
                  "history",
                ];
                const index = layers.indexOf(layer);
                const next =
                  event.key === "ArrowRight"
                    ? layers[(index + 1) % layers.length]
                    : event.key === "ArrowLeft"
                      ? layers[(index + layers.length - 1) % layers.length]
                      : event.key === "Home"
                        ? layers[0]
                        : event.key === "End"
                          ? layers[layers.length - 1]
                          : undefined;
                if (next) {
                  event.preventDefault();
                  setTab(next);
                  if (next === "history") props.onHistory();
                  document.getElementById(`memory-tab-${next}`)?.focus();
                }
              }}
              key={layer}
              onClick={() => {
                setTab(layer);
                if (layer === "history") props.onHistory();
              }}
            >
              {layer[0]!.toUpperCase() + layer.slice(1)}
            </button>
          ),
        )}
      </div>
      <div
        role="tabpanel"
        id="memory-layer-panel"
        aria-labelledby={`memory-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "related" && (
          <section aria-label="Related evidence">
            <h2>Related memories</h2>
            {props.related.length === 0 ? (
              <p>
                No eligible related memories. Graph links never imply
                confirmation.
              </p>
            ) : (
              props.related.map((row, index) => (
                <article key={index}>
                  <button onClick={() => props.onRelated(row.memory)}>
                    {titleOf(row.memory)}
                  </button>
                  <p>{row.note}</p>
                </article>
              ))
            )}
          </section>
        )}
        <div className="glass evidence-original">
          <button type="button" onClick={props.onBack}>
            Back
          </button>
          <p className="ms-kicker">ORIGINAL</p>
          <h1>
            {demoMemory?.title ?? (memory ? titleOf(memory) : "Evidence")}
          </h1>
          {demoMemory && (
            <>
              <article className="ms-paper-view">{demoMemory.text}</article>
              <p className="ms-fine">
                Synthetic design fixture. This is not a photographed page and it
                is not in a vault.
              </p>
            </>
          )}
          {memory && preview && (
            <>
              {preview.text === undefined ? (
                <img src={preview.url} alt={`Original photo ${preview.name}`} />
              ) : (
                <pre className="ms-paper-view">{preview.text}</pre>
              )}
              <p className="ms-fine" data-testid="integrity">
                {preview.matches
                  ? "Hash matches the vault record. Original bytes are unchanged."
                  : "Hash does not match the vault record. Do not treat this image as the original."}
              </p>
              <p className="ms-fine">{preview.sha256}</p>
              {memory.note_path && (
                <p className="ms-fine">Recall/Memories/{memory.note_path}</p>
              )}
            </>
          )}
          {memory && !preview && <p role="status">Opening the original…</p>}
        </div>
        <div className="glass evidence-understanding">
          {demo && (
            <p>
              Choose a vault to save a correction. This demo is not written to
              disk.
            </p>
          )}
          {memory && (
            <>
              <p className="ms-fine">
                {memory.state === "missing"
                  ? "Markdown note missing. The original is still in the vault."
                  : memory.note.startsWith("---\nrecall_id:")
                    ? "Organized from source statements. Uncertain items require review; edits remain yours."
                    : "Saved in your vault. The note below is human text, not a verified reading."}
              </p>
              {memory.conflict && <p role="alert">{memory.conflict}</p>}
              <NoteMarkdown>
                {noteBody(memory) || "No note added."}
              </NoteMarkdown>
              <form
                className="ms-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  props.onSave();
                }}
              >
                <label htmlFor="correction">Your correction</label>
                <textarea
                  id="correction"
                  value={props.correction}
                  onChange={(event) => props.onCorrection(event.target.value)}
                />
                <button
                  className="ms-primary"
                  type="submit"
                  disabled={
                    props.busy ||
                    memory.state !== "active" ||
                    Boolean(memory.conflict)
                  }
                >
                  Save correction
                </button>
              </form>
              <div className="ms-actions">
                {props.onOpenObsidian && (
                  <button type="button" onClick={props.onOpenObsidian}>
                    Open in Obsidian
                  </button>
                )}

                <button
                  type="button"
                  disabled={props.busy}
                  onClick={props.onReload}
                >
                  Reload this note
                </button>
                {memory.state === "missing" && (
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={props.onRestore}
                  >
                    Restore missing note
                  </button>
                )}
              </div>
              {props.history && (
                <ol className="ms-hits">
                  {props.history.map((revision) => (
                    <li key={revision.revision} className="ms-hit">
                      <strong>Revision {revision.revision}</strong>
                      <NoteMarkdown>
                        {noteBody({ id: memory.id, note: revision.note }) ||
                          "No note added."}
                      </NoteMarkdown>
                      <small>
                        {revision.kind} · {revision.origin} ·{" "}
                        {revision.recorded_at}
                      </small>
                    </li>
                  ))}
                </ol>
              )}
              <label className="ms-check">
                <input
                  type="checkbox"
                  checked={props.confirmRemove}
                  onChange={(event) =>
                    props.onConfirmRemove(event.target.checked)
                  }
                />{" "}
                Remove from Recall. The original source and history stay in the
                vault.
              </label>
              <button
                type="button"
                disabled={props.busy || !props.confirmRemove}
                onClick={props.onRemove}
              >
                Remove from Recall
              </button>
              {props.canProcess && (
                <section aria-label="Meeting processing">
                  <h2>Organize in Obsidian</h2>
                  <label className="ms-check">
                    <input
                      type="checkbox"
                      checked={props.processingConsent}
                      onChange={(event) =>
                        props.onProcessingConsent(event.target.checked)
                      }
                    />{" "}
                    Send this source to Jev and Claude with up to four relevant
                    vault excerpts. Provider charges apply.
                  </label>
                  <button
                    type="button"
                    disabled={
                      props.busy ||
                      !props.processingConsent ||
                      memory.state !== "active" ||
                      Boolean(memory.conflict)
                    }
                    onClick={props.onOrganize}
                  >
                    Organize this memory
                  </button>
                </section>
              )}
              {props.canReviewOrganization && (
                <section aria-label="Reviewed organization retry">
                  <h2>Review an organization retry</h2>
                  <p>
                    The previous request may have incurred charges. Its record
                    and reserved budget stay intact. Review authorizes one new
                    Claude operation using the saved Jev result.
                  </p>
                  <label className="ms-check">
                    <input
                      type="checkbox"
                      disabled={props.busy}
                      checked={props.reviewRetryAcknowledged}
                      onChange={(event) =>
                        props.onReviewRetryAcknowledged(event.target.checked)
                      }
                    />{" "}
                    I reviewed the failed attempt and acknowledge that another
                    request may incur additional charges.
                  </label>
                  <button
                    type="button"
                    disabled={
                      props.busy ||
                      !props.processingConsent ||
                      !props.reviewRetryAcknowledged
                    }
                    onClick={props.onReviewedRetry}
                  >
                    Review and retry organization
                  </button>
                </section>
              )}
              {memory.source_name && preview && preview.text === undefined && (
                <ReadingBlock
                  librarian={librarian}
                  busy={props.busy}
                  consent={props.consent}
                  reading={props.reading}
                  onConsent={props.onConsent}
                  onRead={props.onRead}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ReadingBlock({
  librarian,
  busy,
  consent,
  reading,
  onConsent,
  onRead,
}: {
  librarian: Librarian;
  busy: boolean;
  consent: boolean;
  reading: Reading | null;
  onConsent: (value: boolean) => void;
  onRead: () => void;
}) {
  if (librarian.mode === "unavailable") {
    return <p>{librarian.notice}</p>;
  }
  const claude = librarian.mode === "claude";
  return (
    <section aria-label={claude ? "Claude reading" : "Synthetic reading"}>
      <h2>Unreviewed machine reading</h2>
      <p className="ms-fine">{librarian.notice}</p>
      <label className="ms-check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => onConsent(event.target.checked)}
        />{" "}
        {claude
          ? "Send this one photo to Claude. This costs money. The reading stays unreviewed until I save a correction."
          : "Use the synthetic reader for this photo. It does not call Claude."}
      </label>
      <button type="button" disabled={busy || !consent} onClick={onRead}>
        {claude ? "Read this photo with Claude" : "Read this photo"}
      </button>
      {reading && (
        <>
          <p className="ms-note" data-status="unreviewed">
            {reading.transcription}
          </p>
          <ul>
            {reading.uncertainties.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="ms-fine">
            {claude
              ? `Unreviewed proposal from ${reading.provider}${reading.model ? ` · ${reading.model}` : ""}. It is stored beside the note, not as the note. Ask still searches the correction you save.`
              : `Not saved to the vault. Provider: ${reading.provider}. Saving a correction stores your words, not a verified fact.`}
          </p>
        </>
      )}
    </section>
  );
}

function SearchIcon() {
  return (
    <MagnifyingGlassIcon
      className="ms-search"
      size={22}
      weight="light"
      aria-hidden="true"
    />
  );
}
