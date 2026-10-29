import { invoke } from "@tauri-apps/api/core";
export interface VaultStatus { root: string | null; vault_id: string | null; vault_identity: string | null }
export type VaultMemoryState = "active" | "missing" | "deleted" | "conflict";
export interface ReadingBinding { schema_version: "1.0"; operation_id: string; vault_id: string; memory_id: string; source_id: string; source_sha256: string; expected_revision: number; captured_at: string }
export interface ReadingEvidence { page_id: string; quote: string }
export interface ReadingExtraction { schema_version: "1.1"; capture_id: string; input_manifest_sha256: string; summary: string | null; summary_evidence: ReadingEvidence[]; pages: { page_id: string; ordinal: number; transcription: string; legibility: "clear" | "mixed" | "unreadable" }[]; mentions: unknown[]; statements: unknown[]; action_suggestions: unknown[]; uncertainties: { kind: string; description: string; evidence: ReadingEvidence[] }[] }
export interface VaultReading { machine: { request: { binding: ReadingBinding; media_type: string }; result: { provider: "anthropic"; model_id: string; input_manifest_sha256: string; derivative: { sha256: string; transform_version: "jpeg-rgb-exif-orient-v1"; media_type: "image/jpeg" }; extraction: ReadingExtraction; validation_notes: { code: string; detail: string }[]; review_state: "unreviewed" } }; human_correction: string | null }
export interface ReadingCapability { enabled: boolean; explanation: string }
export interface PairingStatus { state: "pending_owner_approval" | "connected" | "disconnected" | "unknown"; device_id: string | null; vault_id: string; fingerprint: string | null; scope: "photo_inference" | null }
export interface IntelligencePairingStatus { state: "pending_owner_approval" | "connected" | "disconnected" | "unknown"; device_id: string | null; vault_id: string; fingerprint: string | null; scope: "vault_intelligence" | null }
export interface AskCapability { enabled: boolean; scope: "vault_intelligence"; consent: "active" | "missing" | "unknown"; explanation: string; history_consent?: HistoryConsent; history_enabled?: boolean; consent_version?: number; history_policy_version?: string | null }
export type HistoryConsent = "active" | "missing" | "outdated" | "unknown";
export interface HistoryCapability { scope: "vault_intelligence"; history_consent: HistoryConsent; history_enabled: boolean; consent_version: number; history_policy_version: string | null }
export interface AskTemporal { mode: "as_of" | "compare_to_current"; start_utc: string; end_exclusive_utc: string; display_date: string; display_timezone: string }
export interface HistoryEvidence { citation_id: string; memory_id: string; memory_revision: number; event_sha256: string; source_sha256: string; captured_at: string; recorded_at: string; current_revision: number; history_status: "as_of" | "as_of_later_corrected" | "current_counterpart"; evidence_kind: AskCitation["evidence_kind"]; epistemic_state: string; excerpt: string }
export interface HistoryAskOutcome { operation: AskOutcome["operation"]; answer: AskAnswer | null; temporal: AskTemporal; history_evidence: HistoryEvidence[] }
export interface HistoryCitation { memory_id: string; revision: number; event_sha256: string; source_sha256: string; current_revision: number; current: boolean; quote: string; retained_revision: VaultRevision; original: VaultSource }
export interface OrganizationCapability { schema_version: "1.0"; scope: "vault_intelligence"; purpose: "organize"; vault_id: string; policy_version: string; provider: "anthropic" | null; consent: "active" | "missing" | "outdated"; enabled: boolean; consent_epoch: number; decided_at: string | null; local_readiness: "ready" | "needs_setup" | "off" | "unknown"; automatic_enabled: boolean }
export type AudioOrganizationCapability = Omit<OrganizationCapability, "purpose"> & { purpose: "organize_audio" };
export interface OrganizationOperation { operation_id: string; memory_id: string; state: "prepared" | "queued" | "processing" | "organized" | "failed" | "unknown" | "stale" | "awaiting_transcript" | "saved_local"; error_code: string | null }
export type AskAnswerStatus = "answered" | "ambiguous" | "insufficient_evidence" | "unavailable" | "stale_evidence";
export interface AskSentence { text: string; citation_ids: string[] }
export interface AskCitation { citation_id: string; memory_id: string; memory_revision: number; source_sha256: string; evidence_kind: "text_source" | "human_note" | "human_reading_correction" | "machine_reading" | "machine_audio_transcript" | "human_audio_correction"; quote: string }
export interface AskCoverage { eligible_count: number; selected_count: number; limited: boolean; truncated_count: number }
export interface AskAnswer { status: AskAnswerStatus; sentences: AskSentence[]; citations: AskCitation[]; limitations: string[]; coverage: AskCoverage }
export interface AskOutcome { operation: { operation_id: string; state: "prepared" | "in_flight" | "unknown" | "complete" | "failed" | "expired"; error_code: string | null }; answer: AskAnswer | null }
export interface ReadingOperation { operation_id: string; memory_id: string; expected_revision: number; state: "prepared" | "unknown" | "in_flight" | "ready" | "committed" | "cancelled" | "failed" | "expired"; may_have_been_sent: boolean; error_code: string | null }
export interface ReadingOutcome { operation: ReadingOperation; memory: VaultMemory | null }
export function effectiveReading(memory: Pick<VaultMemory, "reading">): string { return memory.reading?.human_correction ?? memory.reading?.machine.result.extraction.pages[0]?.transcription ?? ""; }
export interface RelatedMemoryLink { target_memory_id: string; label: "Possibly related (unreviewed)"; source_quote: string; target_quote: string; note_basename: string }
export interface RelatedMemoryVerification { memory_id: string; revision: number; source_sha256: string; source_name: string; note_basename: string; original: VaultSource }
export interface ContextCoverage { eligible_count: number; selected_count: number; limited: boolean; truncated_count: number }
export interface ImportedText { original_name: string; original_extension: string; source_media_type: "text/plain; charset=utf-8"; semantic_sha256: string; semantic_bytes: number; semantic_characters: number }
export type AudioState = "recording" | "saved_local" | "transcription_processing" | "transcribed" | "transcription_unavailable" | "recovery_required" | "unknown" | "failed" | "discarded";
export interface AudioSource { capture_origin: "recorded" | "imported_wav"; original_name: string | null; media_type: "audio/wav"; source_sha256: string; source_bytes: number; sample_rate_hz: 16000 | 32000 | 44100 | 48000; channels: 1 | 2; pcm_bits: 16; duration_ms: number }
export interface AudioSegment { start_ms: number; end_ms: number; text: string }
export interface AudioMachineTranscript { operation_id: string; source_sha256: string; source_revision: number; runtime_source_commit: string; runtime_binary_sha256: string; model_sha256: string; derivative_sha256: string; transform_version: string; output_sha256: string; text: string; segments: AudioSegment[] | null; input_rms_pcm16: number; quality_flags: string[]; eligibility: "eligible" | "ineligible"; quality_state: "machine_unreviewed" }
export interface AudioTranscript { machine: AudioMachineTranscript; human_correction: { operation_id: string; text: string; corrected_at: string } | null }
export interface AudioOperationStatus { schema_version: string; operation_id: string; vault_id: string; state: AudioState; memory: VaultMemory | null; error_code: string | null; limit_reason: "duration_limit" | "byte_limit" | string | null; source_sample_rate_hz: number | null; source_channels: number | null }
export function isAudioMemory(memory: Pick<VaultMemory, "audio_source">): boolean { return Boolean(memory.audio_source); }
// A human correction (possibly empty) is the only current wording; machine text counts only when eligible.
export function effectiveTranscript(memory: Pick<VaultMemory, "audio_transcript">): string | null { const t = memory.audio_transcript; return !t ? null : t.human_correction ? t.human_correction.text : t.machine.eligibility === "eligible" ? t.machine.text : null; }
export interface VaultMemory { reading?: VaultReading; organization?: OrganizationProposal | null; related_context?: RelatedMemoryLink[]; context_repair_pending?: boolean; imported_text?: ImportedText; audio_source?: AudioSource | null; audio_transcript?: AudioTranscript | null; audio_organization?: OrganizationProposal | null; state: VaultMemoryState; note_path: string | null; id: string; revision: number; note: string; source_name: string; source_sha256: string; captured_at: string; updated_at: string; conflict: string | null }
export interface OrganizationProposal { binding: { schema_version: string; operation_id: string; vault_id: string; memory_id: string; source_kind: "text" | "photo" | "audio_transcript"; derivative_sha256?: string; transcript_revision?: number; transcript_evidence_kind?: "machine_unreviewed" | "human_corrected"; source_sha256: string; expected_revision: number; input_sha256: string; consent_epoch: number; captured_at: string; context_coverage?: ContextCoverage }; media_type: string; payload_sha256: string; result: { provider: string; model_id: string; input_manifest_sha256: string; derivative?: { sha256: string; transform_version: string; media_type: string } | null; related_context?: { target_memory_id: string; source_quote: string; target_quote: string }[]; extraction: { summary?: string | null; summary_evidence?: { page_id: string; quote: string }[]; pages?: { page_id: string; ordinal: number; transcription: string; legibility: string }[]; mentions?: unknown[]; statements?: unknown[]; action_suggestions?: unknown[]; uncertainties?: unknown[] }; validation_notes: { code: string; detail: string }[]; review_state: string }; review_state: string; suppressed: boolean }
export interface VaultSource { bytes: number[]; mime_type: string; sha256: string }
export interface VaultRevision { audio_organization?: OrganizationProposal | null; audio_transcript?: AudioTranscript | null; reading?: VaultReading; organization?: OrganizationProposal | null; revision: number; note: string; recorded_at: string; origin: "human:recall" | "human:obsidian" | "machine:anthropic" | string; kind: "capture" | "correct" | "external" | "restore" | "remove" | "machine_reading" | "reading_correction" | "organization" | string }
export interface LocalVault {
  readonly available: boolean;
  status(): Promise<VaultStatus>;
  select(): Promise<VaultStatus | null>;
  capture(expectedVaultId: string, operationId: string, note: string): Promise<VaultMemory | null>;
  captureText?(expectedVaultId: string, operationId: string, text: string): Promise<VaultMemory | null>;
  importTextFile?(expectedVaultId: string, operationId: string): Promise<VaultMemory | null>;
  importWav?(expectedVaultId: string, operationId: string): Promise<VaultMemory | null>;
  audioStart?(expectedVaultId: string, operationId: string): Promise<AudioOperationStatus>;
  audioStop?(expectedVaultId: string, operationId: string): Promise<AudioOperationStatus>;
  audioStatus?(expectedVaultId: string, operationId: string): Promise<AudioOperationStatus>;
  audioRecover?(expectedVaultId: string, operationId: string, action: "save" | "discard"): Promise<AudioOperationStatus>;
  audioCorrect?(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, text: string): Promise<VaultMemory>;
  list(expectedVaultId: string, query: string, includeDeleted?: boolean): Promise<VaultMemory[]>;
  rebuild(expectedVaultId: string, includeDeleted?: boolean): Promise<VaultMemory[]>;
  restoreNote(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string): Promise<VaultMemory>;
  remove(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, expectedState: "active" | "missing"): Promise<VaultMemory>;
  correct(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, note: string): Promise<VaultMemory>;
  source(expectedVaultId: string, memoryId: string): Promise<VaultSource>;
  history(expectedVaultId: string, memoryId: string): Promise<VaultRevision[]>;
  readingCapability(expectedVaultId: string): Promise<ReadingCapability>;
  readingOperations(expectedVaultId: string, memoryId: string): Promise<ReadingOperation[]>;
  readPhoto(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string): Promise<ReadingOutcome>;
  recoverReading(expectedVaultId: string, operationId: string): Promise<ReadingOutcome>;
  cancelReading(expectedVaultId: string, operationId: string): Promise<ReadingOperation>;
  correctReading(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, text: string): Promise<VaultMemory>;
  pairingPrepare?(expectedVaultId: string): Promise<PairingStatus>;
  pairingClaim?(expectedVaultId: string, invitationId: string): Promise<PairingStatus>;
  pairingStatus?(expectedVaultId: string): Promise<PairingStatus>;
  pairingDisconnect?(expectedVaultId: string): Promise<PairingStatus>;
  askCapability?(expectedVaultId: string): Promise<AskCapability>;
  organizationCapability?(expectedVaultId: string): Promise<OrganizationCapability>;
  setOrganizationConsent?(expectedVaultId: string, enabled: boolean, expectedConsentEpoch: number): Promise<OrganizationCapability>;
  reconcileOrganizationConsent?(expectedVaultId: string): Promise<OrganizationCapability>;
  organizationOperations?(expectedVaultId: string, memoryId: string): Promise<OrganizationOperation[]>;
  audioOrganizationCapability?(expectedVaultId: string): Promise<AudioOrganizationCapability>;
  setAudioOrganizationConsent?(expectedVaultId: string, enabled: boolean, expectedConsentEpoch: number): Promise<AudioOrganizationCapability>;
  reconcileAudioOrganizationConsent?(expectedVaultId: string): Promise<AudioOrganizationCapability>;
  audioOrganizationOperations?(expectedVaultId: string, memoryId: string): Promise<OrganizationOperation[]>;
  recoverAudioOrganization?(expectedVaultId: string, operationId: string): Promise<OrganizationOperation>;
  recoverOrganization?(expectedVaultId: string, operationId: string): Promise<OrganizationOperation>;
  processPendingOrganization?(expectedVaultId: string): Promise<void>;
  relatedMemory?(expectedVaultId: string, sourceMemoryId: string, targetMemoryId: string): Promise<RelatedMemoryVerification>;
  ask?(expectedVaultId: string, operationId: string, question: string): Promise<AskOutcome>;
  recoverAsk?(expectedVaultId: string, operationId: string): Promise<AskOutcome>;
  setHistoryConsent?(expectedVaultId: string, enableHistory: boolean, expectedVersion: number): Promise<HistoryCapability>;
  askHistory?(expectedVaultId: string, operationId: string, question: string, temporal: AskTemporal): Promise<HistoryAskOutcome>;
  recoverHistoryAsk?(expectedVaultId: string, operationId: string): Promise<HistoryAskOutcome>;
  askHistoryCitation?(expectedVaultId: string, operationId: string, citationId: string): Promise<HistoryCitation>;
  intelligencePairingPrepare?(expectedVaultId: string): Promise<IntelligencePairingStatus>;
  intelligencePairingClaim?(expectedVaultId: string, invitationId: string): Promise<IntelligencePairingStatus>;
  intelligencePairingStatus?(expectedVaultId: string): Promise<IntelligencePairingStatus>;
  intelligencePairingDisconnect?(expectedVaultId: string): Promise<IntelligencePairingStatus>;
}
export class NativeLocalVault implements LocalVault {
  readonly available = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  private call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.available) return Promise.reject(new Error("Open the Monolith desktop app to use a local vault."));
    return invoke<T>(command, args);
  }
  readingCapability(expectedVaultId: string) { return this.call<ReadingCapability>("vault_reading_capability", { expectedVaultId }); }
  readingOperations(expectedVaultId: string, memoryId: string) { return this.call<ReadingOperation[]>("vault_reading_operations", { expectedVaultId, memoryId }); }
  readPhoto(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string) { return this.call<ReadingOutcome>("vault_read_photo", { expectedVaultId, memoryId, expectedRevision, operationId }); }
  recoverReading(expectedVaultId: string, operationId: string) { return this.call<ReadingOutcome>("vault_recover_reading", { expectedVaultId, operationId }); }
  cancelReading(expectedVaultId: string, operationId: string) { return this.call<ReadingOperation>("vault_cancel_reading", { expectedVaultId, operationId }); }
  correctReading(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, text: string) { return this.call<VaultMemory>("vault_correct_reading", { expectedVaultId, memoryId, expectedRevision, operationId, text }); }
  pairingPrepare(expectedVaultId: string) { return this.call<PairingStatus>("vault_pairing_prepare", { expectedVaultId }); }
  pairingClaim(expectedVaultId: string, invitationId: string) { return this.call<PairingStatus>("vault_pairing_claim", { expectedVaultId, invitationId }); }
  pairingStatus(expectedVaultId: string) { return this.call<PairingStatus>("vault_pairing_status", { expectedVaultId }); }
  pairingDisconnect(expectedVaultId: string) { return this.call<PairingStatus>("vault_pairing_disconnect", { expectedVaultId }); }
  askCapability(expectedVaultId: string) { return this.call<AskCapability>("vault_intelligence_capability", { expectedVaultId }); }
  organizationCapability(expectedVaultId: string) { return this.call<OrganizationCapability>("vault_organization_capability", { expectedVaultId }); }
  setOrganizationConsent(expectedVaultId: string, enabled: boolean, expectedConsentEpoch: number) { return this.call<OrganizationCapability>("vault_set_organization_consent", { expectedVaultId, enabled, expectedConsentEpoch }); }
  reconcileOrganizationConsent(expectedVaultId: string) { return this.call<OrganizationCapability>("vault_reconcile_organization_consent", { expectedVaultId }); }
  organizationOperations(expectedVaultId: string, memoryId: string) { return this.call<OrganizationOperation[]>("vault_organization_operations", { expectedVaultId, memoryId }); }
  audioOrganizationCapability(expectedVaultId: string) { return this.call<AudioOrganizationCapability>("vault_audio_organization_capability", { expectedVaultId }); }
  setAudioOrganizationConsent(expectedVaultId: string, enabled: boolean, expectedConsentEpoch: number) { return this.call<AudioOrganizationCapability>("vault_set_audio_organization_consent", { expectedVaultId, enabled, expectedConsentEpoch }); }
  reconcileAudioOrganizationConsent(expectedVaultId: string) { return this.call<AudioOrganizationCapability>("vault_reconcile_audio_organization_consent", { expectedVaultId }); }
  audioOrganizationOperations(expectedVaultId: string, memoryId: string) { return this.call<OrganizationOperation[]>("vault_audio_organization_operations", { expectedVaultId, memoryId }); }
  recoverAudioOrganization(expectedVaultId: string, operationId: string) { return this.call<OrganizationOperation>("vault_recover_audio_organization", { expectedVaultId, operationId }); }
  recoverOrganization(expectedVaultId: string, operationId: string) { return this.call<OrganizationOperation>("vault_recover_organization", { expectedVaultId, operationId }); }
  processPendingOrganization(expectedVaultId: string) { return this.call<void>("vault_organization_process_pending", { expectedVaultId }); }
  relatedMemory(expectedVaultId: string, sourceMemoryId: string, targetMemoryId: string) { return this.call<RelatedMemoryVerification>("vault_related_memory", { expectedVaultId, sourceMemoryId, targetMemoryId }); }
  ask(expectedVaultId: string, operationId: string, question: string) { return this.call<AskOutcome>("vault_ask", { expectedVaultId, operationId, question }); }
  recoverAsk(expectedVaultId: string, operationId: string) { return this.call<AskOutcome>("vault_recover_ask", { expectedVaultId, operationId }); }
  setHistoryConsent(expectedVaultId: string, enableHistory: boolean, expectedVersion: number) { return this.call<HistoryCapability>("vault_set_history_consent", { expectedVaultId, enableHistory, expectedVersion }); }
  askHistory(expectedVaultId: string, operationId: string, question: string, temporal: AskTemporal) { return this.call<HistoryAskOutcome>("vault_ask_history", { expectedVaultId, operationId, question, temporal }); }
  recoverHistoryAsk(expectedVaultId: string, operationId: string) { return this.call<HistoryAskOutcome>("vault_recover_history_ask", { expectedVaultId, operationId }); }
  askHistoryCitation(expectedVaultId: string, operationId: string, citationId: string) { return this.call<HistoryCitation>("vault_ask_history_citation", { expectedVaultId, operationId, citationId }); }
  intelligencePairingPrepare(expectedVaultId: string) { return this.call<IntelligencePairingStatus>("vault_intelligence_pairing_prepare", { expectedVaultId }); }
  intelligencePairingClaim(expectedVaultId: string, invitationId: string) { return this.call<IntelligencePairingStatus>("vault_intelligence_pairing_claim", { expectedVaultId, invitationId }); }
  intelligencePairingStatus(expectedVaultId: string) { return this.call<IntelligencePairingStatus>("vault_intelligence_pairing_status", { expectedVaultId }); }
  intelligencePairingDisconnect(expectedVaultId: string) { return this.call<IntelligencePairingStatus>("vault_intelligence_pairing_disconnect", { expectedVaultId }); }
  status() { return this.call<VaultStatus>("vault_status"); }
  select() { return this.call<VaultStatus | null>("vault_select"); }
  capture(expectedVaultId: string, operationId: string, note: string) { return this.call<VaultMemory | null>("vault_capture", { expectedVaultId, operationId, note }); }
  captureText(expectedVaultId: string, operationId: string, text: string) { return this.call<VaultMemory>("vault_capture_text", { expectedVaultId, operationId, text }); }
  importTextFile(expectedVaultId: string, operationId: string) { return this.call<VaultMemory | null>("vault_import_text_file", { expectedVaultId, operationId }); }
  importWav(expectedVaultId: string, operationId: string) { return this.call<VaultMemory | null>("vault_import_wav", { expectedVaultId, operationId }); }
  audioStart(expectedVaultId: string, operationId: string) { return this.call<AudioOperationStatus>("vault_audio_start", { expectedVaultId, operationId }); }
  audioStop(expectedVaultId: string, operationId: string) { return this.call<AudioOperationStatus>("vault_audio_stop", { expectedVaultId, operationId }); }
  audioStatus(expectedVaultId: string, operationId: string) { return this.call<AudioOperationStatus>("vault_audio_status", { expectedVaultId, operationId }); }
  audioRecover(expectedVaultId: string, operationId: string, action: "save" | "discard") { return this.call<AudioOperationStatus>("vault_audio_recover", { expectedVaultId, operationId, action }); }
  audioCorrect(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, text: string) { return this.call<VaultMemory>("vault_audio_correct", { expectedVaultId, memoryId, expectedRevision, operationId, text }); }
  list(expectedVaultId: string, query: string, includeDeleted?: boolean) { return this.call<VaultMemory[]>("vault_list", { expectedVaultId, query, ...(includeDeleted === undefined ? {} : { includeDeleted }) }); }
  rebuild(expectedVaultId: string, includeDeleted = false) { return this.call<VaultMemory[]>("vault_rebuild", { expectedVaultId, includeDeleted }); }
  restoreNote(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string) { return this.call<VaultMemory>("vault_restore_note", { expectedVaultId, memoryId, expectedRevision, operationId }); }
  remove(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, expectedState: "active" | "missing") { return this.call<VaultMemory>("vault_remove", { expectedVaultId, memoryId, expectedRevision, operationId, expectedState }); }
  correct(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, note: string) { return this.call<VaultMemory>("vault_correct", { expectedVaultId, memoryId, expectedRevision, operationId, note }); }
  source(expectedVaultId: string, memoryId: string) { return this.call<VaultSource>("vault_source", { expectedVaultId, memoryId }); }
  history(expectedVaultId: string, memoryId: string) { return this.call<VaultRevision[]>("vault_history", { expectedVaultId, memoryId }); }
}
