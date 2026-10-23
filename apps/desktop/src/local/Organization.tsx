import { useEffect, useRef, useState } from "react";
import type { AudioOrganizationCapability, LocalVault, OrganizationCapability, OrganizationOperation, OrganizationProposal } from "../platform/local-vault";

type ConsentProps = { vault: LocalVault; sessionId: string; vaultIdentity: string; onChanged: () => void };
export function OrganizationSettings(props: ConsentProps) { return <ConsentControl kind="text" {...props} />; }
// Voice notes have their own server consent, epoch and local marker; this control shares no state with the text/photo one.
export function AudioOrganizationSettings(props: ConsentProps) { return props.vault.audioOrganizationCapability ? <ConsentControl kind="audio" {...props} /> : null; }

function ConsentControl({ kind, vault, sessionId, vaultIdentity, onChanged }: ConsentProps & { kind: "text" | "audio" }) {
  const audio = kind === "audio";
  const [capability, setCapability] = useState<OrganizationCapability | AudioOrganizationCapability | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const request = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  function validate<T extends OrganizationCapability | AudioOrganizationCapability>(result: T): T {
    if (result.vault_id !== vaultIdentity || result.scope !== "vault_intelligence" || result.purpose !== (audio ? "organize_audio" : "organize")) throw new Error(`${audio ? "Voice organization" : "Organization"} status does not match this vault. Check again before changing its setting.`);
    return result;
  }
  async function refresh() {
    const id = ++request.current;
    setLoading(true); setError(""); setCapability(null);
    try {
      if (!(audio ? vault.audioOrganizationCapability : vault.organizationCapability)) throw new Error(`${audio ? "Voice-note organization" : "Automatic organization"} is unavailable in this vault adapter.`);
      const result = await (audio ? vault.audioOrganizationCapability!(sessionId) : vault.organizationCapability!(sessionId));
      if (!alive.current || id !== request.current) return;
      setCapability(validate(result));
    } catch (e) { if (alive.current && id === request.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (alive.current && id === request.current) setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [vault, sessionId, vaultIdentity]);
  const canWrite = audio ? Boolean(vault.setAudioOrganizationConsent) : Boolean(vault.setOrganizationConsent);
  const canReconcile = audio ? Boolean(vault.reconcileAudioOrganizationConsent) : Boolean(vault.reconcileOrganizationConsent);
  // Consent writes are never retried automatically: an ambiguous outcome clears the shown state and asks for a fresh read.
  async function decide(enabled: boolean) {
    if (!capability || saving || !canWrite) return;
    const id = ++request.current;
    setSaving(true); setError("");
    try {
      const result = await (audio ? vault.setAudioOrganizationConsent!(sessionId, enabled, capability.consent_epoch) : vault.setOrganizationConsent!(sessionId, enabled, capability.consent_epoch));
      if (!alive.current || id !== request.current) return;
      setCapability(validate(result)); onChanged();
    } catch (e) {
      if (alive.current && id === request.current) { setCapability(null); setError(`${e instanceof Error ? e.message : String(e)} Check the current setting before trying again.`); }
    } finally { if (alive.current && id === request.current) setSaving(false); }
  }
  async function reconcile() {
    if (!capability || saving || !canReconcile) return;
    const id = ++request.current;
    setSaving(true); setError("");
    try {
      const result = await (audio ? vault.reconcileAudioOrganizationConsent!(sessionId) : vault.reconcileOrganizationConsent!(sessionId));
      if (!alive.current || id !== request.current) return;
      setCapability(validate(result)); onChanged();
    } catch (e) {
      if (alive.current && id === request.current) { setCapability(null); setError(`${e instanceof Error ? e.message : String(e)} Check again when the vault is available.`); }
    } finally { if (alive.current && id === request.current) setSaving(false); }
  }
  const activePermission = capability?.consent === "active";
  const canTurnOn = Boolean(capability && !loading && !saving && capability.provider && !activePermission && canWrite);
  const canTurnOff = Boolean(capability && !loading && !saving && activePermission && canWrite);
  const status = !capability ? null : audio ? audioConsentStatus(capability) : textConsentStatus(capability);
  return <details className={`local-tools local-organization-settings${audio ? " local-audio-organization-settings" : ""}`}>
    <summary>{audio ? "Organize voice notes automatically" : "Automatically organize new notes and photos"}</summary>
    {audio
      ? <p>When turned on, the transcript text of voice notes you record or import from then on is sent, via your private Recall service, to {capability?.provider === "anthropic" ? "Anthropic Claude" : "the configured cloud provider"} to suggest a summary and other proposals. The recording or audio file itself is never sent. Recordings and imported audio you already have are not affected. The results are unreviewed machine proposals, not facts. Your choice is remembered until you turn it off, and it needs the private service connection.</p>
      : <p>When turned on, notes and photos you save from then on, plus up to three short excerpts from current memories in this vault, are sent to {capability?.provider === "anthropic" ? "Anthropic Claude" : "the configured cloud provider"} through your private Recall service. The excerpts help suggest possibly related memories. Originals stay in your Obsidian vault. Older captures are not processed.</p>}
    {loading && <p>{audio ? "Checking this vault’s voice-organization setting…" : "Checking this vault’s organization setting…"}</p>}
    {status && <p>{status}</p>}
    {error && <p role="alert" className="local-error">{error}</p>}
    <div className="local-actions"><button disabled={!canTurnOn} onClick={() => void decide(true)}>{saving ? "Saving…" : audio ? "Turn on voice organization" : "Turn on"}</button><button disabled={!canTurnOff} onClick={() => void decide(false)}>{audio ? "Turn off voice organization" : "Turn off"}</button>{capability?.consent === "active" && capability.local_readiness === "needs_setup" && <button disabled={saving || !canReconcile} onClick={() => void reconcile()}>{saving ? "Finishing setup…" : audio ? "Finish voice setup" : "Finish setup"}</button>}{capability?.local_readiness === "unknown" && <button disabled={saving || !canReconcile} onClick={() => void reconcile()}>{saving ? "Checking…" : audio ? "Check voice setup again" : "Check again"}</button>}<button disabled={loading || saving} onClick={() => void refresh()}>{audio ? "Refresh voice setting" : "Refresh setting"}</button></div>
  </details>;
}

function textConsentStatus(capability: OrganizationCapability | AudioOrganizationCapability): string {
  return capability.automatic_enabled
    ? `Automatic organization is on${capability.provider === "anthropic" ? " with Anthropic Claude" : ""}.`
    : capability.local_readiness === "unknown"
      ? capability.consent === "active"
        ? "Your permission is saved, but this device’s setup status is unknown. Captures stay local until you check again."
        : "Automatic organization is off, but this device’s previous setup could not be cleared. Check again to confirm its status."
      : capability.consent === "active" && capability.local_readiness === "needs_setup"
        ? "Your permission is saved. Finish setup on this device before new captures can be organized. New captures stay local."
        : capability.consent === "active"
          ? "Your permission is saved, but organization is unavailable right now. New captures stay local for now. You can still turn it off."
          : capability.consent === "outdated"
            ? "The previous permission no longer applies. Review the current provider disclosure and turn it on again if you want to continue."
            : capability.provider
              ? "Automatic organization is off. New captures stay local."
              : "No organization provider is configured. New captures stay local.";
}
function audioConsentStatus(capability: OrganizationCapability | AudioOrganizationCapability): string {
  return capability.automatic_enabled
    ? `Voice-note organization is on${capability.provider === "anthropic" ? " with Anthropic Claude" : ""}. Only the transcript text of voice notes you record or import from now on is sent.`
    : capability.local_readiness === "unknown"
      ? capability.consent === "active"
        ? "Your permission is saved, but this device’s setup status is unknown. New voice notes stay local until you check again."
        : "Voice-note organization is off, but this device’s previous setup could not be cleared. Check again to confirm its status."
      : capability.consent === "active" && capability.local_readiness === "needs_setup"
        ? "Your permission is saved. Finish setup on this device before new voice notes can be organized. New voice notes stay local."
        : capability.consent === "active"
          ? "Your permission is saved, but voice organization is unavailable right now, for example because the private service connection is missing. New voice notes stay local for now. You can still turn it off."
          : capability.consent === "outdated"
            ? "The previous permission no longer applies. Review the disclosure above and turn it on again if you want to continue."
            : capability.provider
              ? "Voice-note organization is off. New voice notes stay local."
              : "No organization provider is configured, so voice notes stay local.";
}

export function organizationEffective(proposal: OrganizationProposal | null | undefined): boolean {
  // Native validates the current revision/source and persists explicit suppression on edits.
  return Boolean(proposal && !proposal.suppressed && proposal.review_state === "unreviewed");
}

export function organizationPollDelay(attempt: number): number { return Math.min(10_000, 1_500 * 2 ** Math.min(attempt, 3)); }

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const lines: string[] = [];
    if (typeof row.kind === "string") lines.push(row.kind === "unknown" ? "Unclear" : row.kind.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()));
    for (const key of ["raw_text", "text", "description", "value_text", "attribution_text", "temporal_text", "due_text"]) if (typeof row[key] === "string" && row[key]) lines.push(String(row[key]));
    if (typeof row.epistemic_state === "string") {
      const labels: Record<string, string> = { reported: "Reported", uncertain: "Uncertain", question: "Question", confirmed_by_user: "Confirmed by you", superseded: "Superseded", retracted: "Retracted" };
      lines.unshift(labels[row.epistemic_state] ?? "Unclear");
    }
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    for (const e of evidence) if (e && typeof e === "object" && typeof (e as Record<string, unknown>).quote === "string") lines.push(`Source: ${(e as Record<string, unknown>).quote as string}`);
    return lines.length ? [lines.join(" · ")] : [];
  });
}

function List({ title, items }: { title: string; items: unknown }) {
  const rows = strings(items);
  return rows.length ? <section><h3>{title}</h3><ul>{rows.map((row, i) => <li key={`${title}-${i}`}>{row}</li>)}</ul></section> : null;
}

// Proposals derived from a voice transcript: always unreviewed, never approvable, and retired (not shown as current) once suppressed.
export function AudioProposals({ proposal, retained = false }: { proposal: OrganizationProposal; retained?: boolean }) {
  if (proposal.suppressed && !retained) return <section className="local-organization" aria-label="Machine proposals (suppressed)"><h2>Machine proposals · suppressed</h2><p>Suppressed after your correction; kept in history.</p></section>;
  if (proposal.suppressed) return <OrganizationContent proposal={proposal} historical audio heading="Retained machine proposals · suppressed after your correction" />;
  const human = proposal.binding.transcript_evidence_kind === "human_corrected";
  return <OrganizationContent proposal={proposal} historical={retained} audio heading={`Unreviewed machine proposals derived from ${human ? "a human-corrected transcript" : "an unreviewed machine transcript"}`} />;
}

export function OrganizationContent({ proposal, historical = false, heading, audio = false }: { proposal: OrganizationProposal; historical?: boolean; heading?: string; audio?: boolean }) {
  const extraction = proposal.result.extraction;
  const coverage = proposal.binding.context_coverage;
  return <section className="local-organization" aria-label={audio ? "Machine proposals from the transcript" : "Automatic organization"}>
    <h2>{heading ?? (historical || proposal.suppressed ? "Earlier AI suggestion" : "AI suggestion · not confirmed")}</h2>{(historical || proposal.suppressed) && <p className="local-muted">Historical only · a human correction or edit takes precedence.</p>}
    {extraction.summary && <><h3>Summary</h3><p>{extraction.summary}</p></>}
    {(extraction.summary_evidence ?? []).map((e, i) => <blockquote key={`summary-evidence-${i}`}>{e.quote}</blockquote>)}
    <List title="Mentions" items={extraction.mentions} /><List title={audio ? "What the transcript may say" : "What the source says"} items={extraction.statements} /><List title="Possible next steps" items={extraction.action_suggestions} /><List title="Uncertainty" items={extraction.uncertainties} />
    {proposal.binding.source_kind === "photo" && extraction.pages?.map((page, i) => <section key={`${page.page_id}-${i}`}><h3>Text seen in photo</h3><p>{page.transcription}</p></section>)}
    {coverage && <p className="local-muted" aria-label="Related memory coverage">{coverage.eligible_count === 0 ? "No current memories were available to compare." : `For related suggestions, Recall considered ${coverage.selected_count} of ${coverage.eligible_count} current memories.`}{coverage.limited ? " More memories were available than could be considered." : ""}{coverage.truncated_count > 0 ? ` ${coverage.truncated_count} excerpt${coverage.truncated_count === 1 ? " was" : "s were"} shortened to fit.` : ""}</p>}
    <details className="local-tools local-organization-provenance"><summary>About this suggestion</summary>{audio ? <p>Anthropic Claude read only the transcript text, never the recording · transcript revision {proposal.binding.transcript_revision ?? proposal.binding.expected_revision} · {proposal.binding.transcript_evidence_kind === "human_corrected" ? "your corrected wording" : "an unreviewed machine transcript"}. These are proposals, not verified facts.</p> : <p>{proposal.result.provider === "anthropic" ? "Anthropic Claude" : "Configured provider"} · revision {proposal.binding.expected_revision} · source checked by Recall</p>}</details>
  </section>;
}

export function operationLabel(operation: OrganizationOperation | undefined, memory: { organization?: OrganizationProposal | null; note: string; source_sha256: string }): string {
  if (organizationEffective(memory.organization)) return "AI suggestion · not confirmed";
  if (memory.organization?.suppressed) return "Saved in vault · organization suppressed after your edit";
  if (!operation) return "Saved in vault · Stored on this device";
  if (operation.state === "prepared" || operation.state === "queued") return "Saved locally · waiting for organization";
  if (operation.state === "processing") return "Organizing in the background…";
  if (operation.state === "unknown") return "Processing status uncertain · check status";
  if (operation.state === "failed") return `Saved locally · ${operationGuidance(operation.error_code)}`;
  if (operation.state === "stale") return "Saved locally · organization no longer applies";
  return "Saved in vault · organization proposal unavailable";
}

function operationGuidance(code: string | null): string {
  if (code === "NOT_DISPATCHED") return "your original is safe and was not sent for processing";
  if (code === "SOURCE_OR_CONNECTION_CHANGED") return "the note or connection changed; review the note and settings";
  if (["CONSENT_CHANGED", "CONSENT_STALE", "POLICY_STALE"].includes(code ?? "")) return "permission changed; review organization settings";
  if (["CONNECTION_CHANGED", "AUTHORIZATION_CHANGED"].includes(code ?? "")) return "the connection is unavailable; review its status";
  if (code === "INPUT_LIMIT_EXCEEDED" || code === "OUTPUT_TOO_LARGE" || code === "NORMALIZED_OUTPUT_TOO_LARGE") return "this note is too long to organize";
  if (code?.includes("BUDGET") || code === "AI_NOT_CONFIGURED") return "organization is temporarily unavailable";
  if (code === "RECEIPT_UNAVAILABLE" || code === "RECEIPT_EXPIRED" || code === "PROVIDER_OUTCOME_UNKNOWN") return "processing status could not be confirmed; check processing status";
  if (code === "PROVIDER_FAILED" || code === "INVALID_EXTRACTION" || code === "INVALID_JSON" || code === "SCHEMA_INVALID") return "processing could not finish";
  return "processing could not finish; your original remains saved";
}

export function OrganizationMemory({ vault, vaultId, memory, active, onMemory }: { vault: LocalVault; vaultId: string; memory: import("../platform/local-vault").VaultMemory; active: boolean; onMemory: (m: import("../platform/local-vault").VaultMemory) => void }) {
  const [operation, setOperation] = useState<OrganizationOperation>();
  const [error, setError] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const iterations = useRef(0);
  const pendingSince = useRef(0);
  const [observationExpired, setObservationExpired] = useState(false);
  const onMemoryRef = useRef(onMemory); onMemoryRef.current = onMemory;
  const request = useRef(0);
  const load = async () => {
    const id = ++request.current;
    if (!vault.organizationOperations) return;
    try {
      const rows = await vault.organizationOperations(vaultId, memory.id);
      if (id !== request.current) return;
      const current = rows.at(-1); setOperation(current);
      if (current?.state === "organized" || organizationEffective(memory.organization)) {
        const latest = await vault.list(vaultId, "", true);
        if (id === request.current) { const updated = latest.find(x => x.id === memory.id); if (updated) onMemoryRef.current(updated); }
      }
    } catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { iterations.current = 0; pendingSince.current = Date.now(); setObservationExpired(false); void load(); return () => { request.current++; }; }, [vault, vaultId, memory.id, memory.revision, active]);
  useEffect(() => {
    if (!active || (operation?.state !== "queued" && operation?.state !== "prepared" && operation?.state !== "processing")) return;
    if (Date.now() - pendingSince.current >= 600_000) { setObservationExpired(true); return; }
    const timer = window.setTimeout(() => { iterations.current++; void load().finally(() => setPollTick(t => t + 1)); }, organizationPollDelay(iterations.current));
    return () => window.clearTimeout(timer);
  }, [active, operation?.state, pollTick]);
  async function recover() {
    if (!operation || !vault.recoverOrganization || recovering || !active) return;
    const id = ++request.current;
    setRecovering(true); setError(""); iterations.current = 0; pendingSince.current = Date.now(); setObservationExpired(false);
    try {
      const recovered = await vault.recoverOrganization(vaultId, operation.operation_id); if (!active || id !== request.current) return;
      setOperation(recovered);
      const latest = await vault.list(vaultId, "", true); if (!active || id !== request.current) return; const updated = latest.find(x => x.id === memory.id);
      if (updated) onMemoryRef.current(updated);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRecovering(false); }
  }
  return <>
    {organizationEffective(memory.organization) && <OrganizationContent proposal={memory.organization!} />}
    {(operation || error) && !(operation?.state === "organized" && organizationEffective(memory.organization)) && <section className="local-organization-operation" aria-label="Organization status"><p>{operationLabel(operation, memory)}</p>{operation?.error_code && <details className="local-tools"><summary>Technical details</summary><code>{operation.error_code}</code></details>}{error && <p role="alert" className="local-error">{error}</p>}{operation?.state === "unknown" && <><p className="local-muted">Your original is safe. Check whether processing finished before trying again.</p><button disabled={recovering || !active} onClick={() => void recover()}>{recovering ? "Checking processing status…" : "Check processing status"}</button></>}{observationExpired && <><p className="local-muted">Still waiting for an update. Automatic checks paused after ten minutes; refresh to check again.</p><button disabled={!active} onClick={() => { iterations.current = 0; pendingSince.current = Date.now(); setObservationExpired(false); void load(); }}>Check processing status</button></>}</section>}
  </>;
}

export function organizationSearchText(proposal: OrganizationProposal | null | undefined): string {
  if (!proposal || !organizationEffective(proposal)) return "";
  const e = proposal.result.extraction;
  return [e.summary ?? "", ...strings(e.mentions), ...strings(e.statements), ...strings(e.action_suggestions), ...strings(e.uncertainties), ...strings(e.pages?.map(p => ({ text: p.transcription })))].join(" ");
}
