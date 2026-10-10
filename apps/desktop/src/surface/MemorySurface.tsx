import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LocalVault, VaultMemory, VaultRevision, VaultStatus } from "../platform/local-vault";
import { brooks, FIXTURE_BANNER, fixtureDocuments, fixtureMemory, type FixtureMemory } from "./brooks-fixture";
import { KEYWORD_LABEL, keywordSearch, type KeywordAnswer } from "./keyword";
import { unavailableLibrarian, type Librarian, type Reading } from "./librarian";

type Section = "home" | "ask" | "recent" | "people" | "places" | "projects" | "equipment" | "timeline" | "capture" | "evidence";
type Panel = "overview" | "timeline" | "people" | "places" | "equipment" | "related";
interface Selected { root: string; vault_id: string; vault_identity: string }
interface PendingCapture { operationId: string; note: string }
interface Preview { url: string; sha256: string; matches: boolean; name: string }

const RAIL: { id: Section; label: string }[] = [
  { id: "ask", label: "Ask Recall" },
  { id: "home", label: "Home" },
  { id: "recent", label: "Recent" },
  { id: "people", label: "People" },
  { id: "places", label: "Places" },
  { id: "projects", label: "Projects" },
  { id: "equipment", label: "Equipment" },
  { id: "timeline", label: "Timeline" },
  { id: "capture", label: "Capture" },
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
  return { operationId: operationIdValue, note };
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

export function MemorySurface({ vault, librarian = unavailableLibrarian }: { vault: LocalVault; librarian?: Librarian }) {
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
  const askRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const previewRef = useRef<Preview | null>(null);
  previewRef.current = preview;

  const selected = selectedFrom(status);
  const kept = items.filter(keptMemory);
  const active = kept.filter((memory) => memory.state === "active" && memory.revision > 0 && !memory.conflict);
  const demo = !selected || kept.length === 0;
  const featured = active[0] ?? kept[0] ?? null;

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

  function go(next: Section) {
    if (next === "ask") {
      askRef.current?.focus();
      return;
    }
    setSection(next);
    setEvidenceId(null);
    setError("");
    setAnswer(null);
    setVaultHits(null);
    if (next === "home" || next === "projects") { setPanel("overview"); setDetail(null); }
    if (next === "people" || next === "places" || next === "equipment" || next === "timeline" || next === "recent") setPanel(panelFor(next));
  }

  async function choose(kind: "select" | "default") {
    setBusy(true); setError("");
    try {
      const next = kind === "select" ? await vault.select() : await vault.openDefault();
      if (!alive.current) return;
      if (!next) { setNotice("Folder choice cancelled. Nothing was written."); return; }
      setStatus(next);
      const chosen = selectedFrom(next);
      setItems(chosen ? await vault.list(chosen.vault_id, "") : []);
      setNotice(kind === "default" ? "Opened the default vault folder." : "Opened the folder you chose.");
      setSection("home");
    } catch (chooseError) {
      if (alive.current) setError(message(chooseError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function ask(event: { preventDefault(): void }) {
    event.preventDefault();
    setError("");
    setDetail(null);
    setEvidenceId(null);
    setSection("ask");
    if (demo || !selected) {
      setVaultHits(null);
      setAnswer(keywordSearch(query, fixtureDocuments()));
      return;
    }
    setBusy(true);
    try {
      const hits = await vault.list(selected.vault_id, query);
      if (!alive.current) return;
      setVaultHits(hits);
      setAnswer(null);
    } catch (askError) {
      if (alive.current) setError(message(askError));
    } finally {
      if (alive.current) setBusy(false);
    }
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
    const intent = pending ?? { operationId: operationId(), note: draft };
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
      setEvidenceId(saved.id);
      setCorrection(saved.note);
      await loadSource(selected.vault_id, saved);
    } catch (importError) {
      if (alive.current) setError(`${message(importError)} Retry uses the same import, so a completed save is not duplicated.`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function loadSource(vaultId: string, memory: VaultMemory) {
    const source = await vault.source(vaultId, memory.id);
    if (!alive.current) return;
    const sha = source.sha256.toLowerCase();
    const matches = sha === memory.source_sha256.toLowerCase() && /^[0-9a-f]{64}$/.test(sha);
    const url = URL.createObjectURL(new Blob([Uint8Array.from(source.bytes)], { type: source.mime_type }));
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { url, sha256: sha, matches, name: memory.source_name };
    });
  }

  async function openVaultMemory(memory: VaultMemory) {
    if (!selected || !openable(memory)) return;
    setBusy(true); setError("");
    setHistory(null);
    setReading(null);
    setConsent(false);
    setReadOp(null);
    setConfirmRemove(false);
    setCorrection(memory.note);
    setEvidenceId(memory.id);
    setSection("evidence");
    try { await loadSource(selected.vault_id, memory); }
    catch (sourceError) { if (alive.current) setError(message(sourceError)); }
    finally { if (alive.current) setBusy(false); }
  }

  function openDemoMemory(memory: FixtureMemory) {
    setEvidenceId(memory.id);
    setSection("evidence");
    setPreview(null);
    setReading(null);
  }

  async function saveCorrection(memory: VaultMemory) {
    if (!selected) return;
    const intent = { operationId: operationId(), note: correction, expectedRevision: memory.revision };
    setBusy(true); setError("");
    try {
      const saved = await vault.correct(selected.vault_id, memory.id, intent.expectedRevision, intent.operationId, intent.note);
      if (!alive.current) return;
      setItems((rows) => rows.map((row) => row.id === saved.id ? saved : row));
      setEvidenceId(saved.id);
      setCorrection(saved.note);
      setHistory(null);
      setReading(null);
      setNotice("Correction saved in the vault. The original photo is unchanged. This is your note, not a verified fact.");
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
      setCorrection(latest.note);
      setEvidenceId(latest.id);
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
      setNotice("Removed from Recall. The original photo and history remain in the vault.");
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
      if (alive.current) setHistory(rows);
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
      if (!alive.current) return;
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

  const demoMemories = brooks.memories;
  const vaultMemories = kept;
  const evidenceMemory = kept.find((memory) => memory.id === evidenceId) ?? null;
  const demoEvidence = demo ? fixtureMemory(evidenceId ?? "") : undefined;

  return (
    <div className="ms" data-mode={demo ? "demo" : "vault"}>
      <aside className="ms-rail" aria-label="Recall">
        <p className="ms-mark">RECALL</p>
        <p className="ms-tagline">Your life remembers itself.</p>
        <nav className="ms-nav" aria-label="Memory">
          {RAIL.map((item) => (
            <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => go(item.id)}>
              <RailIcon id={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="ms-rail-actions">
          <button type="button" disabled={!vault.available || busy || checking} onClick={() => void choose("select")}>Choose a vault folder</button>
          <button type="button" disabled={!vault.available || busy || checking} onClick={() => void choose("default")}>Use default vault</button>
          {selected && <p className="ms-root">{selected.root}</p>}
        </div>
      </aside>
      <div className="ms-stage">
        {demo && section !== "evidence" && (
          <div className="ms-desk" aria-hidden="true">
            <article className="ms-paper">
              <p>Brooks Campus  8/16/26</p>
              <ul>
                <li>Met w/ Brad + Blake</li>
                <li>Temporary generation likely</li>
                <li>Oncor timeline ~ Q1 2027</li>
                <li>Need site walk w/ Prism</li>
                <li>Discussed laydown yard (north side)</li>
                <li>Potential 300MW (phased)</li>
              </ul>
            </article>
            <div className="ms-polaroid" />
            <p className="ms-mug">Important conversations deserve a long memory.</p>
          </div>
        )}
        <div className="ms-ui">
          {checking && <p className="ms-notice" role="status">Checking this device…</p>}
          {demo && !checking && <p className="ms-banner" role="status">{FIXTURE_BANNER}{selected ? " This vault has no active memories yet." : ""}</p>}
          {error && <p className="ms-error" role="alert">{error}</p>}
          {notice && <p className="ms-notice" role="status">{notice}</p>}
          <div className="ms-toprow">{demo && <p className="ms-editorial">{brooks.editorial}</p>}</div>
          <div className="ms-askrow">
            <form className="ms-ask" role="search" onSubmit={(event) => void ask(event)}>
              <SearchIcon />
              <label className="ms-sr" htmlFor="recall-ask">Ask Recall</label>
              <input id="recall-ask" ref={askRef} type="search" value={query} placeholder={demo ? "What do you know about Brooks Campus?" : "Ask your notes"} onChange={(event) => setQuery(event.target.value)} />
              <button type="submit" disabled={busy} aria-label="Ask"><span aria-hidden="true">→</span></button>
            </form>
            <button className="ms-mic" type="button" disabled aria-label="Voice ask is not available in this build">Voice</button>
          </div>

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
              onCorrection={setCorrection}
              onSave={() => evidenceMemory && void saveCorrection(evidenceMemory)}
              onReload={() => evidenceMemory && void reload(evidenceMemory)}
              onHistory={() => evidenceMemory && void showHistory(evidenceMemory)}
              onConfirmRemove={setConfirmRemove}
              onRemove={() => evidenceMemory && void removeMemory(evidenceMemory)}
              onRestore={() => evidenceMemory && void restoreMemory(evidenceMemory)}
              onConsent={(value) => { setConsent(value); if (!value) setReadOp(null); }}
              onRead={() => evidenceMemory && void readPhoto(evidenceMemory)}
            />
          ) : section === "capture" ? (
            <section className="glass ms-project" aria-label="Capture">
              <p className="ms-kicker">CAPTURE</p>
              <h1>Import a photo</h1>
              <p>Recall writes the original bytes into the vault, then a Markdown note with a link to that file. The note is your words. It is not a reading of the page.</p>
              <form className="ms-form" onSubmit={(event) => { event.preventDefault(); void importPhoto(); }}>
                <label htmlFor="capture-note">Optional note</label>
                <textarea id="capture-note" value={draft} onChange={(event) => setDraft(event.target.value)} />
                <button className="ms-primary" type="submit" disabled={busy}>{pending ? "Retry the same import" : "Import photo"}</button>
              </form>
            </section>
          ) : (
            <>
              <div className="ms-columns">
                <div className="ms-side">
                  <ContextCard title="People" demo={demo} empty="Names in your notes stay as you wrote them. Recall does not turn a first name into a person record.">
                    <ul className="ms-list">
                      {brooks.people.map((person) => (
                        <li key={person.name}><button type="button" onClick={() => { setDetail({ title: person.name, text: `${person.role}. ${person.note}` }); setPanel("people"); setSection("people"); }}><i className="ms-avatar" aria-hidden="true">{initials(person.name)}</i><span className="ms-person"><strong>{person.name}</strong><small className="ms-role">{person.role}</small></span></button></li>
                      ))}
                    </ul>
                    <p className="ms-more">+ {brooks.morePeople}</p>
                  </ContextCard>
                  <ContextCard title="Locations" demo={demo} empty="Places are not split out of your notes in this build.">
                    <ul className="ms-list">
                      {brooks.places.map((place) => (
                        <li key={place.name}><button type="button" onClick={() => { setDetail({ title: place.name, text: `${place.locality}. ${place.note}` }); setPanel("places"); setSection("places"); }}><PinIcon /><span className="ms-person"><strong>{place.name}</strong><small className="ms-role">{place.locality}</small></span></button></li>
                      ))}
                    </ul>
                    <p className="ms-more">+ {brooks.morePlaces}</p>
                  </ContextCard>
                </div>
                <article className="glass ms-project" aria-label={demo ? "Brooks Campus" : "Your vault"}>
                  {section === "ask" ? <AskResults demo={demo} answer={answer} hits={vaultHits} onOpenDemo={(id) => { const memory = fixtureMemory(id); if (memory) openDemoMemory(memory); else setDetail(detailFrom(id)); }} onOpenVault={(memory) => void openVaultMemory(memory)} /> : (
                    <>
                      <div className="ms-project-head">
                        <p className="ms-kicker">{demo ? brooks.kicker : "MEMORY"}</p>
                        <p className="ms-updated">{demo ? `Last updated ${brooks.updated}` : featured ? `Last updated ${displayDate(featured.updated_at)}` : "Nothing saved yet"}</p>
                      </div>
                      <h1>{detail?.title ?? (demo ? brooks.project : featured ? titleOf(featured) : "Your vault")}</h1>
                      <p className="ms-place">{demo ? brooks.place : selected ? selected.root : "No vault open"}</p>
                      <div className="ms-split">
                        <div>
                          {detail ? <p className="ms-summary">{detail.text}</p> : panel === "overview" && <p className="ms-summary">{demo ? brooks.summary : featured?.note || "Import a photo to keep the original and a note in this vault."}</p>}
                          {demo && panel === "overview" && !detail && <p className="ms-fine">{brooks.caveat}</p>}
                          {panel === "timeline" && <MemoryList demo={demo} demoMemories={demoMemories} vaultMemories={vaultMemories} onDemo={openDemoMemory} onVault={(memory) => void openVaultMemory(memory)} />}
                          {panel === "people" && !detail && <SimpleList demo={demo} rows={brooks.people.map((person) => ({ label: person.name, note: person.note }))} empty="People are not inferred from your notes." />}
                          {panel === "places" && !detail && <SimpleList demo={demo} rows={brooks.places.map((place) => ({ label: place.name, note: place.note }))} empty="Places are not inferred from your notes." />}
                          {panel === "equipment" && <SimpleList demo={demo} rows={brooks.equipment.map((item) => ({ label: item.label, note: item.note }))} empty="Equipment is not inferred from your notes." />}
                          {panel === "related" && <SimpleList demo={demo} rows={brooks.related.map((item) => ({ label: item.label, note: item.note }))} empty="Connections are not inferred. Ask searches the note text you saved." />}
                          <dl className="ms-stats">
                            <div><dt>Memories</dt><dd>{demo ? brooks.stats.memories : active.length}</dd></div>
                            <div><dt>People</dt><dd>{demo ? brooks.stats.people : "—"}</dd></div>
                            <div><dt>Locations</dt><dd>{demo ? brooks.stats.locations : "—"}</dd></div>
                            <div><dt>Key Topics</dt><dd>{demo ? brooks.stats.topics : "—"}</dd></div>
                          </dl>
                          {demo && <p className="ms-fine">{brooks.statsNote}</p>}
                          <div className="ms-tabs" role="tablist" aria-label="Project">
                            {(["overview", "timeline", "people", "equipment", "related"] as const).map((tab) => (
                              <button key={tab} type="button" role="tab" aria-selected={panel === tab} onClick={() => { setPanel(tab); setDetail(null); }}>{tab[0]?.toUpperCase()}{tab.slice(1)}</button>
                            ))}
                          </div>
                        </div>
                        <div className="ms-site" aria-hidden="true">{demo ? <SiteArt /> : <span className="ms-site-label">Original stays in the vault</span>}</div>
                      </div>
                      {featured && !demo && <div className="ms-actions"><button type="button" onClick={() => void openVaultMemory(featured)}>Open original: {titleOf(featured)}</button></div>}
                    </>
                  )}
                </article>
                <div className="ms-side">
                  <CountCard title="Key Topics" demo={demo} rows={brooks.topics} empty="Topics are not counted from your notes in this build." onOpen={(label, note) => { setDetail({ title: label, text: note }); setPanel("overview"); }} />
                  <CountCard title="Related" demo={demo} rows={brooks.related} empty="Connections are not inferred. Ask searches the note text you saved." onOpen={(label, note) => { setDetail({ title: label, text: note }); setPanel("related"); setSection("projects"); }} />
                  {demo && <p className="ms-quote glass">{brooks.quote}</p>}
                </div>
              </div>
            </>
          )}
          <p className="ms-footer">CAPTURE · UNDERSTAND · CONNECT · REMEMBER · RECALL · ACT</p>
        </div>
      </div>
    </div>
  );
}

function titleOf(memory: VaultMemory): string {
  const name = memory.source_name.replace(/\.[a-z0-9]+$/i, "");
  return name || "Untitled page";
}
function detailFrom(id: string): { title: string; text: string } | null {
  const docs = fixtureDocuments();
  const doc = docs.find((item) => item.id === id);
  return doc ? { title: doc.title, text: doc.text } : null;
}

function RailIcon({ id }: { id: Section }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      {id === "ask" && <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm7 2-3.5-3.5" />}
      {id === "home" && <path d="M4 11.5 12 4l8 7.5V20H4v-8.5Z" />}
      {id === "recent" && <path d="M12 7v6l4 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" />}
      {id === "people" && <path d="M8 14a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM2 20a6 6 0 0 1 12 0M14 20a5 5 0 0 1 8 0" />}
      {id === "places" && <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />}
      {id === "projects" && <path d="M4 7h16v12H4V7Zm0 0 2-3h12l2 3" />}
      {id === "equipment" && <path d="M14 7a2 2 0 1 0-4 0L5 9l1 3 3-1v6h6v-6l3 1 1-3-5-2Z" />}
      {id === "timeline" && <path d="M4 12h16M7 12v.01M12 12v.01M17 12v.01" />}
      {id === "capture" && <path d="M8 7h2l1-2h2l1 2h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm4 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />}
    </svg>
  );
}

function ContextCard({ title, demo, empty, children }: { title: string; demo: boolean; empty: string; children: ReactNode }) {
  return (
    <section className="glass" aria-label={title}>
      <h2>{title}</h2>
      {demo ? children : <p>{empty}</p>}
    </section>
  );
}

function CountCard({ title, demo, rows, empty, onOpen }: { title: string; demo: boolean; rows: { label: string; count: number; note: string }[]; empty: string; onOpen: (label: string, note: string) => void }) {
  return (
    <section className="glass" aria-label={title}>
      <h2>{title}</h2>
      {demo ? (
        <ul className="ms-list">
          {rows.map((row) => (
            <li key={row.label}><button type="button" onClick={() => onOpen(row.label, row.note)}><span>{row.label}</span><span className="ms-count">{row.count}</span></button></li>
          ))}
        </ul>
      ) : <p>{empty}</p>}
    </section>
  );
}

function SimpleList({ demo, rows, empty }: { demo: boolean; rows: { label: string; note: string }[]; empty: string }) {
  if (!demo) return <p className="ms-fine">{empty}</p>;
  return (
    <ul className="ms-list">
      {rows.map((row) => <li key={row.label}><strong>{row.label}</strong><p className="ms-fine">{row.note}</p></li>)}
    </ul>
  );
}

function MemoryList({ demo, demoMemories, vaultMemories, onDemo, onVault }: { demo: boolean; demoMemories: FixtureMemory[]; vaultMemories: VaultMemory[]; onDemo: (memory: FixtureMemory) => void; onVault: (memory: VaultMemory) => void }) {
  if (demo) {
    return (
      <ul className="ms-list">
        {demoMemories.map((memory) => <li key={memory.id}><button type="button" onClick={() => onDemo(memory)}>{memory.date} · {memory.title}</button></li>)}
      </ul>
    );
  }
  return (
    <ul className="ms-list">
      {vaultMemories.map((memory) => <li key={memory.id}><button type="button" onClick={() => onVault(memory)}>{displayDate(memory.captured_at)} · {titleOf(memory)}</button></li>)}
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
            <img src={preview.url} alt={`Original photo ${preview.name}`} />
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
            <p className="ms-fine">{memory.state === "missing" ? "Markdown note missing. The original is still in the vault." : "Saved in your vault. The note below is human text, not a verified reading."}</p>
            {memory.conflict && <p role="alert">{memory.conflict}</p>}
            <p className="ms-note">{memory.note || "No note added."}</p>
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
                {props.history.map((revision) => <li key={revision.revision} className="ms-hit"><strong>Revision {revision.revision}</strong><p className="ms-note">{revision.note || "No note added."}</p><small>{revision.kind} · {revision.origin} · {revision.recorded_at}</small></li>)}
              </ol>
            )}
            <label className="ms-check"><input type="checkbox" checked={props.confirmRemove} onChange={(event) => props.onConfirmRemove(event.target.checked)} /> Remove from Recall. The photo and history stay in the vault.</label>
            <button type="button" disabled={props.busy || !props.confirmRemove} onClick={props.onRemove}>Remove from Recall</button>
            <ReadingBlock librarian={librarian} busy={props.busy} consent={props.consent} reading={props.reading} onConsent={props.onConsent} onRead={props.onRead} />
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

function SearchIcon() {
  return (
    <svg className="ms-search" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l5 5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="ms-pin" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

function SiteArt() {
  return (
    <svg className="ms-site-art" viewBox="0 0 640 420" role="img" aria-label="Synthetic site illustration">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0c48a" />
          <stop offset="0.45" stopColor="#c9845a" />
          <stop offset="1" stopColor="#6e7f90" />
        </linearGradient>
      </defs>
      <rect width="640" height="420" fill="url(#sky)" />
      <path d="M40 250h80l20-70h40l18 70h70" fill="none" stroke="#2c241c" strokeWidth="8" />
      <path d="M70 180 V90 M70 110 H150 M150 110 V250" fill="none" stroke="#2c241c" strokeWidth="6" />
      <rect x="230" y="150" width="210" height="160" fill="#8d6a45" />
      <path d="M230 150 H440 V250 H250 V170 H300 V250" fill="none" stroke="#1d1814" strokeWidth="7" />
      <path d="M250 190 H430 M250 220 H430 M280 150 V310 M330 150 V310 M380 150 V310" stroke="#1d1814" strokeWidth="3" opacity="0.7" />
      <path d="M470 250 V70 M470 90 H560 M545 90 V250" fill="none" stroke="#241c16" strokeWidth="7" />
      <path d="M0 300 H640 V420 H0Z" fill="#6b543c" />
      <path d="M0 330 H640" stroke="#8a704f" strokeWidth="8" />
      <text x="24" y="392" fill="#f7f1e6" fontSize="22" fontFamily="Georgia, serif">Synthetic site illustration</text>
    </svg>
  );
}
