import { invoke } from "@tauri-apps/api/core";
export interface VaultStatus { root: string | null; vault_id: string | null; vault_identity: string | null }
export type VaultMemoryState = "active" | "missing" | "deleted" | "conflict";
export interface VaultMemory { state: VaultMemoryState; note_path: string | null; id: string; revision: number; note: string; source_name: string; source_sha256: string; captured_at: string; updated_at: string; conflict: string | null }
export interface VaultSource { bytes: number[]; mime_type: string; sha256: string }
export interface VaultRevision { revision: number; note: string; recorded_at: string; origin: "human:recall" | "human:obsidian" | "model:claude"; kind: "capture" | "correct" | "external" | "restore" | "remove" | "organize" }
export interface ParserJob { operation_id: string; memory_id: string; expected_revision: number; source_sha256: string; state: string; message: string }
export interface OrganizationReviewStatus { prior_operation_id: string; reuse_operation: boolean }
export interface ProviderDisclosure { extraction: string; embedding: string; reranking: string }
export interface KnowledgeServiceStatus { state: string; pending: number; indexed: number; failed: number; message: string; providers?: ProviderDisclosure | null }
export interface KnowledgeStatus { enabled: boolean; include_existing: boolean; generation: number; service: KnowledgeServiceStatus; provider_disclosure: string; providers: ProviderDisclosure | null }
export interface RelationshipSupport { source_id: string; revision: number; source_sha256: string; note_sha256: string; quote: string }
export interface KnowledgeRelationship {
  id: string; source_id: string; revision: number; source_sha256: string; note_sha256: string; source_name: string; note_path: string; quote: string;
  subject_id: string; subject: string; subject_type: string; predicate: string; object_id: string; object: string; object_type: string; fact: string;
  valid_at: string | null; invalid_at: string | null; extracted_at: string; inferred: boolean; uncertainty: string; related_source_ids: string[]; supports: RelationshipSupport[];
}
export interface KnowledgeSearchReply { status: KnowledgeServiceStatus; relationships: KnowledgeRelationship[] }
export interface KnowledgeControl { version: number; vault_id: string; enabled: boolean; include_existing: boolean; generation: number; snapshot_sha256: string; existing_fence: string[]; dismissed_facts: string[] }
export interface SourceAnswer { question: string; message: string; hits: { memory_id: string; revision: number; note_basename: string; current_excerpt: string; original_excerpt: string; source_sha256: string; mime_type: string }[]; knowledge_status?: KnowledgeServiceStatus | null; graph_relationships?: KnowledgeRelationship[] }
export interface LocalVault {
  readonly available: boolean;
  captureNote?(expectedVaultId: string, operationId: string, note: string): Promise<VaultMemory>;
  parse?(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, consent: boolean): Promise<ParserJob>;
  organize?(expectedVaultId: string, parserOperationId: string, operationId: string, consent: boolean): Promise<unknown>;
  reviewedOrganize?(expectedVaultId: string, parserOperationId: string, priorOperationId: string, operationId: string, consent: boolean, acknowledgeUncertainty: boolean): Promise<unknown>;
  reviewOrganization?(expectedVaultId: string, parserOperationId: string, priorOperationId: string, reviewedFrom?: string): Promise<OrganizationReviewStatus>;
  publish?(expectedVaultId: string, parserOperationId: string, organizationOperationId: string, operationId: string): Promise<VaultMemory>;
  ask?(expectedVaultId: string, question: string): Promise<SourceAnswer>;
  status(): Promise<VaultStatus>;
  select(): Promise<VaultStatus | null>;
  openDefault(): Promise<VaultStatus>;
  capture(expectedVaultId: string, operationId: string, note: string): Promise<VaultMemory | null>;
  list(expectedVaultId: string, query: string, includeDeleted?: boolean): Promise<VaultMemory[]>;
  rebuild(expectedVaultId: string, includeDeleted?: boolean): Promise<VaultMemory[]>;
  restoreNote(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string): Promise<VaultMemory>;
  remove(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, expectedState: "active" | "missing"): Promise<VaultMemory>;
  correct(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, note: string): Promise<VaultMemory>;
  source(expectedVaultId: string, memoryId: string): Promise<VaultSource>;
  history(expectedVaultId: string, memoryId: string): Promise<VaultRevision[]>;
  knowledgeStatus?(expectedVaultId: string): Promise<KnowledgeStatus>;
  knowledgeConsent?(expectedVaultId: string, enabled: boolean, includeExisting: boolean): Promise<KnowledgeControl>;
  knowledgeSearch?(expectedVaultId: string, query: string, includeHistory?: boolean): Promise<KnowledgeSearchReply>;
  knowledgeDismiss?(expectedVaultId: string, factId: string): Promise<KnowledgeControl>;
  knowledgeRebuild?(expectedVaultId: string): Promise<KnowledgeServiceStatus>;
}
export class NativeLocalVault implements LocalVault {
  readonly available = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  private call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.available) return Promise.reject(new Error("Open the Recall desktop app to use a local vault."));
    return invoke<T>(command, args);
  }
  status() { return this.call<VaultStatus>("vault_status"); }
  select() { return this.call<VaultStatus | null>("vault_select"); }
  openDefault() { return this.call<VaultStatus>("vault_open_default"); }
  capture(expectedVaultId: string, operationId: string, note: string) { return this.call<VaultMemory | null>("vault_capture", { expectedVaultId, operationId, note }); }
  captureNote(expectedVaultId: string, operationId: string, note: string) { return this.call<VaultMemory>("vault_capture_note", { expectedVaultId, operationId, note }); }
  parse(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, consent: boolean) { return this.call<ParserJob>("processing_parse", { expectedVaultId, memoryId, expectedRevision, operationId, consent }); }
  organize(expectedVaultId: string, parserOperationId: string, operationId: string, consent: boolean) { return this.call<unknown>("meeting_organize", { expectedVaultId, parserOperationId, operationId, consent }); }
  reviewedOrganize(expectedVaultId: string, parserOperationId: string, priorOperationId: string, operationId: string, consent: boolean, acknowledgeUncertainty: boolean) { return this.call<unknown>("meeting_organize_reviewed", { expectedVaultId, parserOperationId, priorOperationId, operationId, consent, acknowledgeUncertainty }); }
  reviewOrganization(expectedVaultId: string, parserOperationId: string, priorOperationId: string, reviewedFrom?: string) { return this.call<OrganizationReviewStatus>("meeting_review_status", { expectedVaultId, parserOperationId, priorOperationId, ...(reviewedFrom ? { reviewedFrom } : {}) }); }
  publish(expectedVaultId: string, parserOperationId: string, organizationOperationId: string, operationId: string) { return this.call<VaultMemory>("meeting_publish", { expectedVaultId, parserOperationId, organizationOperationId, operationId }); }
  ask(expectedVaultId: string, question: string) { return this.call<SourceAnswer>("memory_ask", { expectedVaultId, question }); }
  list(expectedVaultId: string, query: string, includeDeleted?: boolean) { return this.call<VaultMemory[]>("vault_list", { expectedVaultId, query, ...(includeDeleted === undefined ? {} : { includeDeleted }) }); }
  rebuild(expectedVaultId: string, includeDeleted = false) { return this.call<VaultMemory[]>("vault_rebuild", { expectedVaultId, includeDeleted }); }
  restoreNote(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string) { return this.call<VaultMemory>("vault_restore_note", { expectedVaultId, memoryId, expectedRevision, operationId }); }
  remove(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, expectedState: "active" | "missing") { return this.call<VaultMemory>("vault_remove", { expectedVaultId, memoryId, expectedRevision, operationId, expectedState }); }
  correct(expectedVaultId: string, memoryId: string, expectedRevision: number, operationId: string, note: string) { return this.call<VaultMemory>("vault_correct", { expectedVaultId, memoryId, expectedRevision, operationId, note }); }
  source(expectedVaultId: string, memoryId: string) { return this.call<VaultSource>("vault_source", { expectedVaultId, memoryId }); }
  history(expectedVaultId: string, memoryId: string) { return this.call<VaultRevision[]>("vault_history", { expectedVaultId, memoryId }); }
  knowledgeStatus(expectedVaultId: string) { return this.call<KnowledgeStatus>("knowledge_status", { expectedVaultId }); }
  knowledgeConsent(expectedVaultId: string, enabled: boolean, includeExisting: boolean) { return this.call<KnowledgeControl>("knowledge_consent", { expectedVaultId, enabled, includeExisting }); }
  knowledgeSearch(expectedVaultId: string, query: string, includeHistory = false) { return this.call<KnowledgeSearchReply>("knowledge_search", { expectedVaultId, query, includeHistory }); }
  knowledgeDismiss(expectedVaultId: string, factId: string) { return this.call<KnowledgeControl>("knowledge_dismiss", { expectedVaultId, factId }); }
  knowledgeRebuild(expectedVaultId: string) { return this.call<KnowledgeServiceStatus>("knowledge_rebuild", { expectedVaultId }); }
}
