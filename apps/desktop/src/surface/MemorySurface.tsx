import { graphTitle } from "./adaptive-graph";
import { attachmentIntent, clearAttachmentIntent } from "./attachment-intent";
import { MemoryEditor } from "./MemoryEditor";
import type { EditorIntent } from "./editor-session";
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
import { KnowledgePanel } from "./KnowledgePanel";
import type { KnowledgeRelationship, KnowledgeServiceStatus, KnowledgeStatus, MemoryAnswer, AnswerSelection } from "../platform/local-vault";

import { NoteMarkdown } from "./NoteMarkdown";
import { vaultContext, noteBody, type SourceRow } from "./vault-context";
import { useEffect, useMemo, useRef, useState } from "react";
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
function writeDraftKey(identity: string) {
  return `recall.write.v1:${identity}`;
}
function savedWriteDraft(identity: string) {
  const value = localStorage.getItem(writeDraftKey(identity));
  if (value && value.length > 262144)
    throw new Error(
      "Saved writing draft needs recovery; it was not discarded.",
    );
  return value ?? "";
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
  const [removed, setRemoved] = useState<VaultMemory[]>([]);
  const [importOperation, setImportOperation] = useState<string | null>(null);
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
  const [quotedAnswer, setQuotedAnswer] = useState<{ vaultId: string; question: string; requestId: string; result: MemoryAnswer } | null>(null);
  const [quotedAnswerBusy, setQuotedAnswerBusy] = useState(false);
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus | null>(null);
  const [knowledgeRows, setKnowledgeRows] = useState<KnowledgeRelationship[]>([]);
  const [knowledgeResultStatus, setKnowledgeResultStatus] = useState<KnowledgeServiceStatus | null>(null);
  const [knowledgeConsentChecked, setKnowledgeConsentChecked] = useState(false);
  const [knowledgeIncludeExisting, setKnowledgeIncludeExisting] = useState(false);
  const [answerConsentChecked, setAnswerConsentChecked] = useState(false);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [processingConsent, setProcessingConsent] = useState(false);
  const [processingState, setProcessingState] = useState("");
  const [reviewRetryAcknowledged, setReviewRetryAcknowledged] = useState(false);
  const [vaultHits, setVaultHits] = useState<VaultMemory[] | null>(null);
  const [_detail, setDetail] = useState<{ title: string; text: string } | null>(
    null,
  );
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [attachmentView, setAttachmentView] = useState<Preview | null>(null);
  const attachmentRequest = useRef(0);
  const [attachmentFile, setAttachmentFile] = useState<string | null>(null);
  const attachmentRef = useRef<Preview | null>(null);
  attachmentRef.current = attachmentView;
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
  const answerRequest = useRef(0);
  const activeAnswerRequest = useRef<{ vaultId: string; requestId: string; sequence: number } | null>(null);
  const knowledgeRequest = useRef(0);
  const evidenceRef = useRef<string | null>(null);
  const correctionVersion = useRef(0);
  const organizationRequests = useRef(new Map<string, number>());
  function organizationActive() {
    return Boolean(
      selected?.vault_id && organizationRequests.current.get(selected.vault_id),
    );
  }
  function closeAttachment() {
    attachmentRequest.current++;
    if (attachmentRef.current) URL.revokeObjectURL(attachmentRef.current.url);
    attachmentRef.current = null;
    setAttachmentView(null);
    setAttachmentFile(null);
  }
  function clearPreview() {
    closeAttachment();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null;
    setPreview(null);
  }
  function inScope(vaultId: string) {
    return alive.current && scopeRef.current === vaultId;
  }
  const kept = useMemo(() => items.filter(keptMemory), [items]);
  async function cancelMemoryAnswer(explicit = false) {
    const activeRequest = activeAnswerRequest.current;
    if (!activeRequest) {
      if (explicit) setNotice("There is no active quoted-answer request.");
      return;
    }
    activeAnswerRequest.current = null;
    const sequence = ++answerRequest.current;
    setQuotedAnswerBusy(false);
    setQuotedAnswer(null);
    if (!vault.memoryAnswerCancel) {
      if (explicit && inScope(activeRequest.vaultId)) setNotice("The answer is no longer shown, but native cancellation is unavailable; provider work or charges may remain.");
      return;
    }
    try {
      const cancelled = await vault.memoryAnswerCancel(activeRequest.vaultId, activeRequest.requestId);
      if (explicit && sequence === answerRequest.current && inScope(activeRequest.vaultId)) {
        setNotice(cancelled
          ? "The local request was fenced. A provider may still finish work, and any provider charge may remain."
          : "Cancellation was not confirmed; provider work or charges may remain.");
      }
    } catch {
      if (explicit && sequence === answerRequest.current && inScope(activeRequest.vaultId)) setNotice("Cancellation was not confirmed; provider work or charges may remain.");
    }
  }
  function changeQuestion(value: string) {
    if (value !== query) {
      void cancelMemoryAnswer();
      setQuotedAnswer(null);
    }
    setQuery(value);
  }
  const active = kept.filter(memory => memory.state === "active" && memory.revision > 0 && !memory.conflict);
  const demo = !vault.available;

  useEffect(() => {
    if (!quotedAnswer) return;
    const stillCurrent = quotedAnswer.vaultId === selected?.vault_id && quotedAnswer.question === query.trim()
      && quotedAnswer.result.selections.every(selection => active.some(memory => matchesAnswerSelection(memory, selection)));
    if (!stillCurrent) setQuotedAnswer(null);
  }, [items, query, quotedAnswer, selected?.vault_id]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
      if (attachmentRef.current) URL.revokeObjectURL(attachmentRef.current.url);
    };
  }, []);

  useEffect(() => {
    const vaultId = selected?.vault_id;
    return () => {
      const activeRequest = activeAnswerRequest.current;
      if (!vaultId || activeRequest?.vaultId !== vaultId) return;
      activeAnswerRequest.current = null;
      answerRequest.current += 1;
      if (vault.memoryAnswerCancel) void vault.memoryAnswerCancel(vaultId, activeRequest.requestId).catch(() => undefined);
    };
  }, [selected?.vault_id, vault.memoryAnswerCancel]);

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
            if (!restored) setDraft(savedWriteDraft(chosen.vault_identity));
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
    settingsTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setVaultSettings(true); setKnowledgeConsentChecked(false); setKnowledgeIncludeExisting(false); setAnswerConsentChecked(false);
    if (!selected || !vault.knowledgeStatus) { setKnowledgeStatus(null); return; }
    const vaultId = selected.vault_id;
    void vault.knowledgeStatus(vaultId).then(next => { if (inScope(vaultId)) setKnowledgeStatus(next); }).catch(() => {
      if (inScope(vaultId)) setKnowledgeStatus({ enabled: false, include_existing: false, generation: 0, provider_disclosure: "Graph knowledge is unavailable. Keyword search remains available.", providers: null, answer_enabled: false, answer_provider: null, service: { state: "unavailable", pending: 0, indexed: 0, failed: 0, message: "Graph knowledge is unavailable. Keyword search remains available." } });
    });
  }
  function closeSettings() { setVaultSettings(false); settingsTrigger.current?.focus(); }
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
        const controls = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
        const first = controls?.[0], last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", dialogKeys);
    return () => document.removeEventListener("keydown", dialogKeys);
  }, [vaultSettings]);

  function go(next: Section) {
    closeAttachment();
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
    if (section === "ask") { setBusy(false); void cancelMemoryAnswer(); setQuotedAnswer(null); }
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
    knowledgeRequest.current += 1; setKnowledgeRows([]); setKnowledgeResultStatus(null); setKnowledgeBusy(false);
    setAnswer(null);
    setSourceAnswer(null); setQuotedAnswer(null);
    setVaultHits(null);
    if (next === "home" || next === "projects" || next === "organizations") { setPanel("overview"); setDetail(null); }
    if (next === "topics") { setPanel("topics"); setDetail(null); }
    if (next === "people" || next === "places" || next === "equipment" || next === "timeline" || next === "recent") setPanel(panelFor(next));
    if ((next === "timeline" || next === "recent") && !demo) void loadKnowledge("");
  }

  async function loadKnowledge(queryText: string) {
    if (!selected || !vault.knowledgeSearch) return;
    const vaultId = selected.vault_id, request = ++knowledgeRequest.current;
    setKnowledgeBusy(true); setKnowledgeRows([]); setKnowledgeResultStatus(null);
    try {
      const result = await vault.knowledgeSearch(vaultId, queryText);
      if (inScope(vaultId) && request === knowledgeRequest.current) { setKnowledgeRows(result.relationships); setKnowledgeResultStatus(result.status); }
    } catch (knowledgeError) {
      if (inScope(vaultId) && request === knowledgeRequest.current) setKnowledgeResultStatus({ state: "unavailable", pending: 0, indexed: 0, failed: 0, message: message(knowledgeError) });
    } finally { if (inScope(vaultId) && request === knowledgeRequest.current) setKnowledgeBusy(false); }
  }

  async function loadMemoryKnowledge(memory: VaultMemory) {
    if (!selected || !vault.knowledgeSearch) return;
    const vaultId = selected.vault_id, request = ++knowledgeRequest.current;
    setKnowledgeBusy(true); setKnowledgeRows([]); setKnowledgeResultStatus(null);
    try {
      const result = await vault.knowledgeSearch(vaultId, "");
      if (!inScope(vaultId) || request !== knowledgeRequest.current) return;
      setKnowledgeRows(result.relationships.filter(row => row.source_id === memory.id || row.supports.some(support => support.source_id === memory.id)));
      setKnowledgeResultStatus(result.status);
    } catch (knowledgeError) {
      if (inScope(vaultId) && request === knowledgeRequest.current) setKnowledgeResultStatus({ state: "unavailable", pending: 0, indexed: 0, failed: 0, message: message(knowledgeError) });
    } finally { if (inScope(vaultId) && request === knowledgeRequest.current) setKnowledgeBusy(false); }
  }

  async function updateKnowledgeConsent(enabled: boolean) {
    if (!selected || !vault.knowledgeConsent) return;
    const vaultId = selected.vault_id;
    setKnowledgeBusy(true); setError("");
    try {
      await vault.knowledgeConsent(vaultId, enabled, enabled && knowledgeIncludeExisting);
      if (!inScope(vaultId)) return;
      const next = await vault.knowledgeStatus?.(vaultId);
      if (inScope(vaultId) && next) setKnowledgeStatus(next);
      setKnowledgeConsentChecked(false); setKnowledgeIncludeExisting(false);
      setAnswerConsentChecked(false);
      if (!enabled) { void cancelMemoryAnswer(); setQuotedAnswer(null); }
      setNotice(enabled ? "Connected knowledge consent saved. Existing notes are included only if you selected them." : "Connected knowledge and quoted answers are disabled locally. Remote removal was requested; in-flight provider work or costs may remain until cancellation is confirmed. Keyword search remains available.");
    } catch (knowledgeError) {
      if (!inScope(vaultId)) return;
      const failure = message(knowledgeError);
      const remoteUnconfirmed = !enabled && failure.toLowerCase().includes("locally disabled");
      if (remoteUnconfirmed) {
        setKnowledgeConsentChecked(false);
        setAnswerConsentChecked(false); void cancelMemoryAnswer(); setQuotedAnswer(null);
        setKnowledgeStatus(current => current ? { ...current, enabled: false, include_existing: false, answer_enabled: false, service: { ...current.service, state: "unavailable", message: "Locally disabled; remote purge is unconfirmed." } } : current);
      }
      // Reload native state even on rejection: a revocation error can mean the
      // durable local fence committed while loopback cancellation did not.
      try {
        const next = await vault.knowledgeStatus?.(vaultId);
        if (inScope(vaultId) && next) setKnowledgeStatus(remoteUnconfirmed
          ? { ...next, enabled: false, include_existing: false, answer_enabled: false, service: { ...next.service, state: "unavailable", message: "Locally disabled; remote purge is unconfirmed." } }
          : next);
      } catch { /* retain the explicit disabled-but-unconfirmed state above */ }
      if (inScope(vaultId)) setError(remoteUnconfirmed ? "Connected knowledge is locally disabled; remote purge is unconfirmed and will retry when the service reconnects." : failure);
    }
    finally { if (inScope(vaultId)) setKnowledgeBusy(false); }
  }

  async function updateAnswerConsent(enabled: boolean) {
    if (!selected || !vault.knowledgeAnswerConsent) return;
    const vaultId = selected.vault_id;
    setKnowledgeBusy(true); setError("");
    try {
      await vault.knowledgeAnswerConsent(vaultId, enabled);
      if (!inScope(vaultId)) return;
      if (!enabled) { void cancelMemoryAnswer(); setQuotedAnswer(null); }
      const next = await vault.knowledgeStatus?.(vaultId);
      if (!inScope(vaultId)) return;
      if (next) setKnowledgeStatus(next);
      setAnswerConsentChecked(false);
      setNotice(enabled
        ? `Quoted-answer consent saved for ${next?.answer_provider ?? "the configured answer provider"}. Each answer still requires your separate action.`
        : "Quoted answers are disabled locally. In-flight provider work or costs may remain until cancellation is confirmed.");
    } catch (consentError) {
      if (inScope(vaultId)) setError(message(consentError));
    } finally { if (inScope(vaultId)) setKnowledgeBusy(false); }
  }

  async function rebuildKnowledge() {
    if (!selected || !vault.knowledgeRebuild) return;
    const vaultId = selected.vault_id;
    setKnowledgeBusy(true); setError("");
    try {
      const service = await vault.knowledgeRebuild(vaultId);
      if (!inScope(vaultId)) return;
      setKnowledgeStatus(current => current ? { ...current, service } : current);
      setKnowledgeResultStatus(service);
      setNotice(service.message);
    } catch (rebuildError) {
      if (inScope(vaultId)) setError(message(rebuildError));
    } finally { if (inScope(vaultId)) setKnowledgeBusy(false); }
  }

  async function dismissKnowledge(factId: string) {
    if (!selected || !vault.knowledgeDismiss) throw new Error("Connected knowledge dismissal is unavailable.");
    const vaultId = selected.vault_id;
    try {
      await vault.knowledgeDismiss(vaultId, factId);
      if (!inScope(vaultId)) return;
    } catch (dismissError) {
      if (inScope(vaultId)) setError(message(dismissError));
      throw dismissError;
    }
  }

  async function choose(kind: "select" | "default" | "create" | "restore") {
    setBusy(true);
    setError("");
    try {
      const next =
        kind === "select"
          ? await vault.select()
          : kind === "restore"
            ? await vault.restoreLibrary?.()
            : kind === "create"
              ? await vault.create?.()
              : await vault.openDefault();
      if (!alive.current) return;
      if (!next) { setNotice("Folder choice cancelled. Nothing was written."); return; }
      clearPreview(); evidenceRef.current = null; askRequest.current += 1;
      setSourceAnswer(null); setProcessingState(""); setProcessingConsent(false); setReviewRetryAcknowledged(false);
      knowledgeRequest.current += 1; setKnowledgeStatus(null); setKnowledgeRows([]); setKnowledgeResultStatus(null); setKnowledgeBusy(false);
      sourceRequest.current += 1;
      setPending(null);
      setDraft("");
      setRemoved([]);
      setImportOperation(null);
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
      setDraft(
        restored?.note ??
          (chosen ? savedWriteDraft(chosen.vault_identity) : ""),
      );
      setNotice(
        kind === "default"
          ? "Opened your default Recall library."
          : "Opened your Recall library.",
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
    void cancelMemoryAnswer(); setQuotedAnswer(null);
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
        if (!inScope(selected.vault_id) || request !== askRequest.current) return;
        setSourceAnswer(response); setVaultHits(null); setAnswer(null);
        if (vault.knowledgeStatus) void vault.knowledgeStatus(selected.vault_id).then(next => {
          if (inScope(selected.vault_id) && request === askRequest.current) setKnowledgeStatus(next);
        }).catch(() => undefined);
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

  async function answerFromNotes() {
    if (!selected || demo || !query.trim() || !vault.memoryAnswer || !knowledgeStatus?.answer_enabled || !knowledgeStatus.answer_provider) return;
    if (activeAnswerRequest.current) return;
    const requestId = globalThis.crypto?.randomUUID?.();
    if (!requestId) { setError("This device cannot create an answer request id. Nothing was sent."); return; }
    const vaultId = selected.vault_id, question = query.trim(), sequence = ++answerRequest.current;
    activeAnswerRequest.current = { vaultId, requestId, sequence };
    setQuotedAnswer(null); setQuotedAnswerBusy(true); setError(""); setNotice("");
    try {
      const response = await vault.memoryAnswer(vaultId, question, requestId);
      if (!inScope(vaultId) || answerRequest.current !== sequence || activeAnswerRequest.current?.requestId !== requestId) return;
      const currentProvider = knowledgeStatus.answer_provider;
      const selectionsAreCurrent = response.selections.every(selection => active.some(memory =>
        matchesAnswerSelection(memory, selection)));
      const providerChanged = response.status === "supported" && response.answer_provider !== currentProvider;
      const result = !selectionsAreCurrent || providerChanged
        ? { ...response, status: "stale", message: "A source or approved provider changed while answering. No quotations are shown; run Ask again after reviewing Settings.", selections: [] }
        : response;
      setQuotedAnswer({ vaultId, question, requestId, result });
    } catch (answerError) {
      if (inScope(vaultId) && answerRequest.current === sequence) setError(message(answerError));
    } finally {
      if (activeAnswerRequest.current?.requestId === requestId) {
        activeAnswerRequest.current = null;
        setQuotedAnswerBusy(false);
      }
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
      localStorage.removeItem(writeDraftKey(scope.vault_identity));
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
        "Open existing library, or use the default vault, before importing a photo.",
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
      localStorage.removeItem(writeDraftKey(selected.vault_identity));
      setPending(null);
      setDraft("");
      setItems((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setNotice(
        "Saved in your library. The original photo and a Markdown note are on this device.",
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
    void loadMemoryKnowledge(memory);
    try {
      await loadSource(selected.vault_id, memory);
    } catch (sourceError) {
      if (inScope(selected.vault_id)) setError(message(sourceError));
    } finally {
      if (inScope(selected.vault_id)) setBusy(false);
    }
  }

  async function commitEdit(
    memory: VaultMemory,
    intent: EditorIntent,
  ): Promise<VaultMemory> {
    if (!selected) throw new Error("Open a library before editing.");
    const scope = selected;
    const saved = await vault.correct(
      scope.vault_id,
      memory.id,
      intent.expectedRevision,
      intent.operationId,
      intent.note,
    );
    if (!inScope(scope.vault_id))
      throw new Error(
        "Library changed while saving. Your draft stays with its original library.",
      );
    setItems((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
    if (evidenceRef.current === memory.id) {
      setHistory(null);
      setReading(null);
    }
    setNotice(
      "Correction saved in the library. The original source is unchanged. This is your note, not a verified fact.",
    );
    return saved;
  }
  async function importMarkdown() {
    if (!selected || !vault.importMarkdown) return;
    const scope = selected;
    const key = `recall.import.v1:${scope.vault_identity ?? scope.vault_id}`;
    setBusy(true);
    setError("");
    try {
      const operation = localStorage.getItem(key) ?? operationId();
      if (!/^[0-9a-f-]{36}$/.test(operation))
        throw new Error(
          "Import recovery identity needs review; it was preserved.",
        );
      localStorage.setItem(key, operation);
      setImportOperation(operation);
      const saved = await vault.importMarkdown(scope.vault_id, operation);
      if (!inScope(scope.vault_id)) return;
      if (!saved) {
        localStorage.removeItem(key);
        setImportOperation(null);
        return;
      }
      localStorage.removeItem(key);
      setImportOperation(null);
      setItems((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      closeSettings();
      await openVaultMemory(saved);
      setNotice(
        "Imported into your library. The original file was not changed.",
      );
    } catch (error) {
      if (inScope(scope.vault_id)) setError(message(error));
    } finally {
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }
  async function attachFile(memory: VaultMemory) {
    if (!selected || !vault.attach) return;
    const scope = selected;
    setBusy(true);
    setError("");
    try {
      const intent = attachmentIntent(
        localStorage,
        scope.vault_identity ?? scope.vault_id,
        memory.id,
        memory.revision,
      );
      const saved = await vault.attach(
        scope.vault_id,
        memory.id,
        intent.revision,
        intent.operation,
      );
      if (!inScope(scope.vault_id)) return;
      intent.acknowledge();
      if (!saved) return;
      setItems((rows) =>
        rows.map((row) => (row.id === saved.id ? saved : row)),
      );
      if (evidenceRef.current === saved.id) {
        setCorrection(noteBody(saved));
        setHistory(null);
      }
      setNotice(
        "Attachment saved in your library. Original evidence was not changed.",
      );
    } catch (error) {
      if (inScope(scope.vault_id)) setError(message(error));
    } finally {
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }
  function resetAttachment(memory: VaultMemory) {
    if (!selected) return;
    try {
      clearAttachmentIntent(
        localStorage,
        selected.vault_identity ?? selected.vault_id,
        memory.id,
      );
      setError("");
      setNotice(
        "Pending attachment attempt cleared. Previously stored attachment bytes and receipts remain in your library; a new attachment will use a new operation.",
      );
    } catch (error) {
      setError(message(error));
    }
  }
  async function inspectAttachment(memory: VaultMemory, fileName: string) {
    if (!selected || !vault.attachment) return;
    const scope = selected;
    const request = ++attachmentRequest.current;
    setBusy(true);
    setError("");
    try {
      const source = await vault.attachment(
        scope.vault_id,
        memory.id,
        fileName,
      );
      if (
        !inScope(scope.vault_id) ||
        evidenceRef.current !== memory.id ||
        request !== attachmentRequest.current
      )
        return;
      if (attachmentRef.current) URL.revokeObjectURL(attachmentRef.current.url);
      const text =
        source.mime_type === "text/plain"
          ? new TextDecoder("utf-8", { fatal: true }).decode(
              Uint8Array.from(source.bytes),
            )
          : undefined;
      const actual = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", Uint8Array.from(source.bytes)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (
        !inScope(scope.vault_id) ||
        evidenceRef.current !== memory.id ||
        request !== attachmentRequest.current
      )
        return;
      if (actual !== source.sha256)
        throw new Error("Attachment bytes did not match the native receipt.");
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(source.bytes)], { type: source.mime_type }),
      );
      setAttachmentFile(fileName);
      setAttachmentView({
        url,
        text,
        name: source.name,
        mime: source.mime_type,
        sha256: source.sha256,
        matches: true,
      });
    } catch (error) {
      if (inScope(scope.vault_id)) setError(message(error));
    } finally {
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }
  async function saveAttachmentCopy(memory: VaultMemory, fileName: string) {
    if (!selected || !vault.saveAttachment) return;
    const scope = selected;
    setBusy(true);
    setError("");
    try {
      const saved = await vault.saveAttachment(
        scope.vault_id,
        memory.id,
        fileName,
      );
      if (saved && inScope(scope.vault_id))
        setNotice("Attachment copy saved. Library evidence is unchanged.");
    } catch (error) {
      if (inScope(scope.vault_id)) setError(message(error));
    } finally {
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }
  async function exportLibrary() {
    if (!selected || !vault.exportLibrary) return;
    const scope = selected;
    setBusy(true);
    setError("");
    try {
      const backup = await vault.exportLibrary(scope.vault_id);
      if (backup && inScope(scope.vault_id))
        setNotice(
          `Exported ${backup.files} library files with originals and history. Backup SHA-256: ${backup.sha256}. Unsaved editor drafts are device-local; save them before restoring on another device.`,
        );
    } catch (error) {
      if (inScope(scope.vault_id)) setError(message(error));
    } finally {
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }
  async function recoverLibrary() {
    if (!selected) return;
    const scope = selected;
    setBusy(true);
    setError("");
    try {
      const rows = await vault.rebuild(scope.vault_id, true);
      if (!inScope(scope.vault_id)) return;
      setItems(rows);
      setRemoved(rows.filter((row) => row.state === "deleted"));
      setNotice(
        "Library refreshed. Saved originals, pending journals and revision history were checked.",
      );
    } catch (error) {
      if (inScope(scope.vault_id)) setError(message(error));
    } finally {
      if (inScope(scope.vault_id)) setBusy(false);
    }
  }
  async function recoverRemoved(memory: VaultMemory) {
    if (!selected || !vault.restoreDeleted) return;
    const scope = selected;
    setBusy(true);
    setError("");
    try {
      const saved = await vault.restoreDeleted(
        scope.vault_id,
        memory.id,
        memory.revision,
        operationId(),
      );
      if (!inScope(scope.vault_id)) return;
      setItems((rows) =>
        rows.map((row) => (row.id === saved.id ? saved : row)),
      );
      setRemoved((rows) => rows.filter((row) => row.id !== saved.id));
      setNotice(
        "Memory restored with its original identifier, source and revision history.",
      );
    } catch (error) {
      if (inScope(scope.vault_id)) setError(message(error));
    } finally {
      if (inScope(scope.vault_id)) setBusy(false);
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
      if (!latest) throw new Error("That memory is no longer in the library.");
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
        "Removed from Recall. The original source and history remain in the library.",
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
      setNotice("Note restored in the library.");
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
  const visibleMemories = useMemo(
    () =>
      focusMonth
        ? kept.filter((m) => memoryTickId(m.captured_at) === focusMonth)
        : kept,
    [kept, focusMonth],
  );
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
    setCaptureMode(pending?.kind ?? kind);
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
      if (event.key === "Escape" && !vaultSettings) {
        if (attachmentRef.current) closeAttachment();
        else go(exploring ? "graph" : "home");
      }
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });
  const activeKnowledgeKey = selected && vault.knowledgeSearch
    ? section === "ask" && sourceAnswer?.knowledge_status ? `ask:${selected.vault_identity}:${sourceAnswer.question}`
      : section === "evidence" && evidenceMemory ? `evidence:${selected.vault_identity}:${evidenceMemory.id}`
        : (section === "recent" || section === "timeline") ? `${section}:${selected.vault_identity}` : null
    : null;
  const activeKnowledgeStatus = section === "ask" ? sourceAnswer?.knowledge_status : knowledgeResultStatus;
  const knowledgePollable = Boolean(activeKnowledgeStatus && activeKnowledgeStatus.pending > 0 && activeKnowledgeStatus.failed === 0
    && !["failed", "error", "unavailable", "disabled"].includes(activeKnowledgeStatus.state.toLowerCase()));
  const activeKnowledgeRef = useRef<string | null>(null);
  activeKnowledgeRef.current = activeKnowledgeKey;
  useEffect(() => {
    if (!activeKnowledgeKey || !selected || !vault.knowledgeSearch || !knowledgePollable || !activeKnowledgeStatus) return;
    let cancelled = false;
    let timer: number | undefined;
    const vaultId = selected.vault_id;
    const viewKey = activeKnowledgeKey;
    const queryText = section === "ask" ? sourceAnswer?.question ?? "" : "";
    const startedAt = Date.now();
    const current = () => !cancelled && inScope(vaultId) && activeKnowledgeRef.current === viewKey;
    const publish = (service: KnowledgeServiceStatus, relationships: KnowledgeRelationship[]) => {
      if (!current()) return;
      if (section === "ask") setSourceAnswer(value => value?.question === queryText ? { ...value, knowledge_status: service, graph_relationships: relationships } : value);
      else {
        const relevant = section === "evidence" && evidenceMemory
          ? relationships.filter(row => row.source_id === evidenceMemory.id || row.supports.some(support => support.source_id === evidenceMemory.id))
          : relationships;
        setKnowledgeRows(relevant); setKnowledgeResultStatus(service);
      }
    };
    const poll = async () => {
      if (!current()) return;
      if (Date.now() - startedAt >= 60_000) {
        const timeoutStatus = { ...activeKnowledgeStatus, message: "Indexing is still pending. Reopen this view later to check its status." };
        publish(timeoutStatus, section === "ask" ? sourceAnswer?.graph_relationships ?? [] : knowledgeRows);
        return;
      }
      try {
        const result = await vault.knowledgeSearch!(vaultId, queryText);
        if (!current()) return;
        publish(result.status, result.relationships);
        const next = result.status;
        const canContinue = next.pending > 0 && next.failed === 0 && !["failed", "error", "unavailable", "disabled"].includes(next.state.toLowerCase());
        if (canContinue && Date.now() - startedAt < 60_000) timer = window.setTimeout(() => void poll(), 2_000);
      } catch (pollError) {
        const unavailable: KnowledgeServiceStatus = { state: "unavailable", pending: 0, indexed: 0, failed: 0, message: message(pollError) };
        publish(unavailable, []);
      }
    };
    timer = window.setTimeout(() => void poll(), 2_000);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [activeKnowledgeKey, activeKnowledgeStatus?.pending, activeKnowledgeStatus?.failed, activeKnowledgeStatus?.state, knowledgePollable, section, sourceAnswer?.question, selected?.vault_id, vault.knowledgeSearch]);
  const currentQuotedAnswer = quotedAnswer && selected?.vault_id === quotedAnswer.vaultId && query.trim() === quotedAnswer.question
    && quotedAnswer.result.selections.every(selection => active.some(memory => matchesAnswerSelection(memory, selection)))
    ? quotedAnswer.result : null;
  const quotedAnswerPanel = selected && !demo && query.trim() && vault.memoryAnswer ? <section className="ms-knowledge-settings" aria-label="Quoted answer from notes">
    <h2>Quoted answer from notes</h2>
    {knowledgeStatus?.answer_enabled && knowledgeStatus.answer_provider
      ? <><p className="ms-fine">Each request sends this question and the selected current note excerpts to {knowledgeStatus.answer_provider}. Recall shows exact source quotations, not a verified synthesized answer.</p>
        {!quotedAnswerBusy && <button type="button" onClick={() => void answerFromNotes()}>Answer from notes</button>}</>
      : <p role="status">Quoted answers are off. Review Settings to separately approve a configured answer provider; keyword search remains available.</p>}
    {quotedAnswerBusy && <><p role="status">Selecting exact source quotations…</p><button type="button" onClick={() => void cancelMemoryAnswer(true)}>Cancel answer</button></>}
    {currentQuotedAnswer && <article className="ms-hit" aria-label="Quoted answer result"><h3>{currentQuotedAnswer.status === "supported" ? "Selected source quotations" : "No supported quoted answer"}</h3><p>{currentQuotedAnswer.message}</p>{currentQuotedAnswer.answer_provider && <small>Provider: {currentQuotedAnswer.answer_provider}</small>}{currentQuotedAnswer.selections.map(selection => {
      const memory = active.find(row => matchesAnswerSelection(row, selection));
      return <div key={`${selection.source_id}:${selection.revision}:${selection.source_sha256}`}><blockquote>{selection.quote}</blockquote>{memory && <><p>{titleOf(memory)} · revision {selection.revision}</p><button type="button" onClick={() => void openVaultMemory(memory)}>Inspect supporting note and original</button></>}</div>;
    })}</article>}
  </section> : null;
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
                onChange={(e) => changeQuestion(e.target.value)}
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
                  Open the Recall desktop app to save to your Recall library.
                </p>
              )}
              {!demo && !selected && !checking && (
                <button onClick={openSettings}>
                  Create or open your Recall library
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
                    onResetAttachment={
                      evidenceMemory
                        ? () => resetAttachment(evidenceMemory)
                        : undefined
                    }
                    onAttach={
                      vault.attach && evidenceMemory
                        ? () => void attachFile(evidenceMemory)
                        : undefined
                    }
                    onAttachment={(fileName) => {
                      if (evidenceMemory)
                        void inspectAttachment(evidenceMemory, fileName);
                    }}
                    editorIdentity={selected?.vault_identity ?? "unavailable"}
                    editorMemories={kept}
                    commitEdit={(intent) => {
                      if (!evidenceMemory)
                        return Promise.reject(new Error("Memory unavailable"));
                      return commitEdit(evidenceMemory, intent);
                    }}
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
                      disabled={busy || Boolean(pending)}
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        if (selected) {
                          try {
                            localStorage.setItem(
                              writeDraftKey(selected.vault_identity),
                              event.target.value,
                            );
                          } catch (error) {
                            setError(
                              `Draft storage unavailable. Keep this window open: ${message(error)}`,
                            );
                          }
                        }
                      }}
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
                        {hit.match_reason && <p>{hit.match_reason}</p>}
                        <p>Current note · revision {hit.revision}{hit.human_corrected ? " · Includes user corrections; the original below is unchanged." : ""}</p>
                        {hit.captured_at && <small>Captured {hit.captured_at} · Note revised {hit.updated_at}</small>}
                        <NoteMarkdown>
                          {noteBody({
                            id: hit.memory_id,
                            note: hit.current_excerpt,
                          })}
                        </NoteMarkdown>
                        <h2>Original evidence</h2>
                        <p>{hit.original_excerpt}</p>
                        {hit.original_start_byte != null && hit.original_end_byte != null && (
                          <small>Original excerpt: bytes {hit.original_start_byte}–{hit.original_end_byte}</small>
                        )}
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
              {section === "ask" && sourceAnswer?.knowledge_status && <KnowledgePanel relationships={sourceAnswer.graph_relationships ?? []} status={sourceAnswer.knowledge_status} memories={active} onInspect={memory => void openVaultMemory(memory)} onCorrect={memory => void openVaultMemory(memory)} onDismiss={vault.knowledgeDismiss ? id => dismissKnowledge(id) : undefined} />}
              {section === "ask" && quotedAnswerPanel}
              {(section === "evidence" || section === "recent") && vault.knowledgeSearch && <KnowledgePanel relationships={knowledgeRows} status={knowledgeResultStatus} memories={active} onInspect={memory => void openVaultMemory(memory)} onCorrect={memory => void openVaultMemory(memory)} onDismiss={vault.knowledgeDismiss ? id => dismissKnowledge(id) : undefined} />}
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
          {section === "timeline" && vault.knowledgeSearch && <div className="adaptive-timeline glass"><KnowledgePanel temporalOnly relationships={knowledgeRows} status={knowledgeResultStatus} memories={active} onInspect={memory => void openVaultMemory(memory)} onCorrect={memory => void openVaultMemory(memory)} onDismiss={vault.knowledgeDismiss ? id => dismissKnowledge(id) : undefined} /></div>}
          {vaultSettings && (
            <div className="ms-modal-backdrop" onClick={closeSettings}>
              <div
                data-vault-dialog
                className="ms-vault-settings"
                role="dialog"
                aria-modal="true"
                aria-label="Library settings"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <h2>Your Recall library</h2>
                  <button
                    type="button"
                    onClick={closeSettings}
                    aria-label="Close library settings"
                  >
                    Close
                  </button>
                </header>
                <p>
                  Memory stays in the folder you choose. Originals and history
                  stay with it.
                </p>
                <p className="ms-root">
                  {selected?.root || "No library selected"}
                </p>
                <button
                  type="button"
                  disabled={
                    !vault.available || busy || checking || !vault.create
                  }
                  onClick={() => void choose("create")}
                >
                  Create library
                </button>
                <button
                  type="button"
                  disabled={!vault.available || busy || checking}
                  onClick={() => void choose("select")}
                >
                  Open existing library
                </button>
                <button
                  type="button"
                  disabled={!vault.available || busy || checking}
                  onClick={() => void choose("default")}
                >
                  Use default library
                </button>
                <button
                  disabled={busy || !vault.restoreLibrary}
                  onClick={() => void choose("restore")}
                >
                  Restore library backup
                </button>
                {selected && (
                  <section aria-label="Library management">
                    <p>
                      Portable Markdown, originals and history stay in this
                      library. Other Markdown applications are optional.
                    </p>
                    <button
                      disabled={busy || !vault.importMarkdown}
                      onClick={() => void importMarkdown()}
                    >
                      {importOperation
                        ? "Retry Markdown import"
                        : "Import Markdown or text"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void recoverLibrary()}
                    >
                      Refresh and recover library
                    </button>
                    <button
                      disabled={busy || !vault.exportLibrary}
                      onClick={() => void exportLibrary()}
                    >
                      Export library backup
                    </button>
                    <p className="ms-fine">
                      Backups contain this library’s Recall Markdown, original
                      sources, attachments and revision history. Restore always
                      creates a new folder and preserves existing libraries.
                      Save any editor drafts before exporting.
                    </p>
                    {removed.map((memory) => (
                      <article key={memory.id}>
                        <p>
                          {titleOf(memory)} · removed · revision{" "}
                          {memory.revision}
                        </p>
                        <button
                          disabled={busy || !vault.restoreDeleted}
                          onClick={() => void recoverRemoved(memory)}
                        >
                          Restore {titleOf(memory)}
                        </button>
                      </article>
                    ))}
                  </section>
                )}
            {selected && vault.knowledgeStatus && vault.knowledgeConsent && <section className="ms-knowledge-settings" aria-label="Connected knowledge settings"><h3>Connected knowledge</h3>{knowledgeStatus ? <><p>{knowledgeStatus.provider_disclosure}</p><p role="status">{knowledgeStatus.enabled ? "Enabled" : "Disabled"} · {knowledgeStatus.service.message} {knowledgeStatus.service.pending ? `${knowledgeStatus.service.pending} pending.` : ""}</p>{knowledgeStatus.providers && <p>Configured providers: extraction {knowledgeStatus.providers.extraction}; embeddings {knowledgeStatus.providers.embedding}; reranking {knowledgeStatus.providers.reranking}.</p>}{!knowledgeStatus.enabled && <><label className="ms-check"><input type="checkbox" checked={knowledgeConsentChecked} onChange={event => setKnowledgeConsentChecked(event.target.checked)} /> I understand that graph processing may send notes and Ask questions to the configured providers above.</label><label className="ms-check"><input type="checkbox" checked={knowledgeIncludeExisting} onChange={event => setKnowledgeIncludeExisting(event.target.checked)} /> Also process existing notes (optional; off by default).</label></>}
              {!knowledgeStatus.enabled && !(knowledgeStatus.providers?.extraction.trim() && knowledgeStatus.providers.embedding.trim() && knowledgeStatus.providers.reranking.trim()) && <p role="status">Providers are unavailable or not configured. Keyword search still works; connected knowledge cannot be enabled yet.</p>}
              <button type="button" disabled={knowledgeBusy || (!knowledgeStatus.enabled && (!knowledgeConsentChecked || !(knowledgeStatus.providers?.extraction.trim() && knowledgeStatus.providers.embedding.trim() && knowledgeStatus.providers.reranking.trim())))} onClick={() => void updateKnowledgeConsent(!knowledgeStatus.enabled)}>{knowledgeStatus.enabled ? "Disable connected knowledge" : "Enable connected knowledge"}</button>
              {knowledgeStatus.enabled && vault.knowledgeRebuild && <><p>Rebuild reprocesses only notes already allowed by your current consent. Provider charges may apply.</p><button type="button" disabled={knowledgeBusy} onClick={() => void rebuildKnowledge()}>Rebuild connected knowledge</button></>}</> : <p role="status">Loading connected knowledge configuration…</p>}
            </section>}
            {selected && knowledgeStatus && vault.knowledgeAnswerConsent && <section className="ms-knowledge-settings" aria-label="Quoted answer settings"><h3>Quoted answers</h3>
              <p>Separate opt-in: when requested, Recall sends your question and selected current note excerpts to the named answer model. The model can select exact quotations; it cannot write a synthesized answer. This setting does not follow graph-processing consent.</p>
              {!knowledgeStatus.enabled ? <p role="status">Enable connected knowledge first, then review and separately approve a configured answer model here.</p>
                : knowledgeStatus.answer_enabled && knowledgeStatus.answer_provider ? <><p role="status">Enabled for {knowledgeStatus.answer_provider}. Every question still requires the Answer from notes action.</p><button type="button" disabled={knowledgeBusy} onClick={() => void updateAnswerConsent(false)}>Disable quoted answers</button><p className="ms-fine">Disabling fences new local requests. In-flight provider work or charges may remain until cancellation is confirmed.</p></>
                  : knowledgeStatus.answer_provider ? <><p>Configured answer model: {knowledgeStatus.answer_provider}. A changed provider identity requires fresh approval.</p><label className="ms-check"><input type="checkbox" checked={answerConsentChecked} onChange={event => setAnswerConsentChecked(event.target.checked)} /> I approve sending each asked question and its selected current note excerpts to {knowledgeStatus.answer_provider} for exact quotation selection.</label><button type="button" disabled={knowledgeBusy || !answerConsentChecked} onClick={() => void updateAnswerConsent(true)}>Enable quoted answers</button></>
                    : <p role="status">No configured answer model is available. Keyword Ask and relationship browsing remain available.</p>}
            </section>}
              </div>
            </div>
          )}
          {attachmentView && (
            <div
              className="attachment-sheet glass"
              role="region"
              aria-label="Attachment inspection"
            >
              <header>
                <h2>{attachmentView.name}</h2>
                <button
                  onClick={() => {
                    attachmentRequest.current++;
                    setAttachmentFile(null);
                    if (attachmentRef.current)
                      URL.revokeObjectURL(attachmentRef.current.url);
                    attachmentRef.current = null;
                    setAttachmentView(null);
                  }}
                >
                  Close attachment
                </button>
              </header>
              {attachmentView.text !== undefined ? (
                <pre>{attachmentView.text}</pre>
              ) : attachmentView.mime?.startsWith("image/") ? (
                <img
                  src={attachmentView.url}
                  alt={`Attachment ${attachmentView.name}`}
                />
              ) : (
                <p>
                  Original PDF retained. Download to inspect with a PDF viewer.
                </p>
              )}
              <p className="ms-fine">
                Native receipt and byte hash match. SHA-256:{" "}
                {attachmentView.sha256}
              </p>
              {vault.saveAttachment && attachmentFile && evidenceMemory && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void saveAttachmentCopy(evidenceMemory, attachmentFile)
                  }
                >
                  Save attachment copy
                </button>
              )}
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

// Native answers verify the immutable original hash, current note hash and exact quote.
// Text-only legacy rows retain the empty-attachment sentinel in their list metadata;
// their stable ID and revision still identify the native-verified original.
function matchesAnswerSelection(memory: VaultMemory, selection: AnswerSelection): boolean {
  const textOnly = memory.source_name === "" && memory.source_sha256 === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  return memory.id === selection.source_id && memory.revision === selection.revision
    && (memory.source_sha256 === selection.source_sha256 || textOnly);
}

function titleOf(memory: VaultMemory): string {
  return graphTitle(memory);
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
  onResetAttachment?: () => void;
  onAttach?: () => void;
  onAttachment?: (fileName: string) => void;
  editorIdentity: string;
  editorMemories: VaultMemory[];
  commitEdit: (intent: EditorIntent) => Promise<VaultMemory>;
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
                  ? "Markdown note missing. The original is still in the library."
                  : memory.note.startsWith("---\nrecall_id:")
                    ? "Organized from source statements. Uncertain items require review; edits remain yours."
                    : "Saved in your library. The note below is human text, not a verified reading."}
              </p>
              {memory.conflict && <p role="alert">{memory.conflict}</p>}
              <NoteMarkdown
                memories={props.editorMemories}
                onOpen={props.onRelated}
                onAttachment={props.onAttachment}
              >
                {noteBody(memory) || "No note added."}
              </NoteMarkdown>
              <MemoryEditor
                key={`${props.editorIdentity}:${memory.id}`}
                identity={props.editorIdentity}
                memory={memory}
                value={props.correction}
                onChange={props.onCorrection}
                commit={props.commitEdit}
                memories={props.editorMemories}
                onOpen={props.onRelated}
                onResetAttachment={props.onResetAttachment}
                onAttach={props.onAttach}
                onAttachment={props.onAttachment}
                disabled={props.busy}
              />
              <div className="ms-actions">
                {props.onOpenObsidian && (
                  <details>
                    <summary>Optional Markdown compatibility</summary>
                    <button type="button" onClick={props.onOpenObsidian}>
                      Open in Obsidian (optional)
                    </button>
                  </details>
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
                      <button
                        type="button"
                        disabled={
                          props.busy ||
                          memory.state !== "active" ||
                          Boolean(memory.conflict)
                        }
                        onClick={() =>
                          props.onCorrection(
                            noteBody({ id: memory.id, note: revision.note }),
                          )
                        }
                      >
                        Use revision {revision.revision} as draft
                      </button>
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
                  <h2>Organize in Recall</h2>
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
