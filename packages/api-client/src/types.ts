/** Wire types for the RCL-001 API. Mirrors docs/API-CONTRACT.md; verified against a live server by tests/e2e. */

export type MediaType = "image/jpeg" | "image/png" | "image/heic" | "image/heif";
export type SourceKind = "handwritten_note" | "photo_document";
/** awaiting_upload -> stored; then, only with AI consent: processing -> ready | needs_review | failed. */
export type ServerCaptureStatus = "awaiting_upload" | "stored" | "processing" | "ready" | "needs_review" | "failed";
export type PageUploadState = "pending" | "received" | "verified";
export type DevicePlatform = "ios" | "android" | "windows" | "macos" | "linux" | "web";

/** The durable capture envelope: packages/contracts/capture.schema.json (schema_version 1.0). */
export interface CaptureManifest {
  schema_version: "1.0";
  client_capture_id: string;
  device_id: string;
  captured_at: string;
  timezone: string;
  source_kind: SourceKind;
  context_hint: string | null;
  pages: ManifestPage[];
}

export interface ManifestPage {
  client_page_id: string;
  ordinal: number;
  media_type: MediaType;
  byte_size: number;
  sha256: string;
  original_filename: string | null;
}

export interface ServerPage {
  source_id: string;
  client_page_id: string;
  ordinal: number;
  media_type: MediaType;
  byte_size: number;
  declared_sha256: string;
  /** Authoritative: computed by the server from the received bytes. null until received. */
  server_sha256: string | null;
  upload_state: PageUploadState;
  original_filename: string | null;
}

export interface ServerCapture {
  capture_id: string;
  client_capture_id: string;
  status: ServerCaptureStatus;
  source_kind: SourceKind;
  captured_at: string;
  timezone: string;
  context_hint: string | null;
  created_at: string;
  stored_at: string | null;
  version: number;
  /** Set once the capture has been interpreted into a memory (RCL-002). */
  memory_id: string | null;
  /** null when no processing was requested (e.g. AI off). */
  processing: ProcessingView | null;
  pages: ServerPage[];
  upload?: { authorization_endpoint: string; accepted_media_types: MediaType[]; max_page_bytes: number };
}

export interface Me {
  user_id: string;
  email: string | null;
  workspaces: { id: string; name: string; role: string }[];
  active_workspace_id: string;
  capabilities: {
    capture: boolean;
    ai_processing: boolean;
    accepted_media_types: MediaType[];
    max_pages_per_capture: number;
    max_page_bytes: number;
    max_capture_bytes: number;
  };
  config: { ai_configured: boolean; ai_enabled: boolean; consent_required: boolean };
}

export interface Device {
  device_id: string;
  platform: DevicePlatform;
  name: string | null;
  app_version: string | null;
  registered_at: string;
}

export interface UploadAuthorization {
  source_id: string;
  method: "PUT";
  /** Relative to the API base URL. A capability bound to one source, one user, with a short TTL. */
  url: string;
  expires_at: string;
  required_headers: Record<string, string>;
  max_bytes: number;
}

export interface CaptureList {
  items: ServerCapture[];
  next_cursor: string | null;
}

export interface ExpectedPage {
  source_id: string;
  sha256: string;
}

export interface ProcessingView {
  state: "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  max_attempts: number;
  blocked_reason: "budget_exhausted" | "not_configured" | null;
  last_error_code: string | null;
  retry_available: boolean;
}

export interface AiSettings {
  ai_configured: boolean;
  provider: string | null;
  policy_version: string;
  enabled: boolean;
  consent_outdated: boolean;
  decided_at: string | null;
  version: number;
  explanation: string;
}

export type EpistemicState = "reported" | "uncertain" | "question" | "confirmed_by_user" | "superseded" | "retracted";

export interface Evidence {
  page_id: string;
  quote: string;
}

export interface MemorySummary {
  memory_id: string;
  capture_id: string;
  revision: number;
  status: ServerCaptureStatus;
  summary: string | null;
  context_hint: string | null;
  captured_at: string;
  page_count: number;
  model_id: string;
  created_at: string;
}

export interface MemoryDetail extends MemorySummary {
  timezone: string;
  processor_version: string;
  revised_at: string;
  interpretation: {
    summary: string | null;
    summary_evidence: Evidence[];
    pages: { page_id: string; ordinal: number; transcription: string; legibility: "clear" | "mixed" | "unreadable" }[];
    mentions: { local_id: string; kind: string; raw_text: string; evidence: Evidence[] }[];
    statements: { local_id: string; kind: string; text: string; value_text: string | null; epistemic_state: EpistemicState; temporal_text: string | null; attribution_text: string | null; evidence: Evidence[] }[];
    action_suggestions: { local_id: string; kind: "action" | "commitment"; text: string; due_text: string | null; evidence: Evidence[] }[];
    uncertainties: { kind: string; description: string; evidence: Evidence[] }[];
  };
  validation_notes: { code: string; detail: string }[];
  labels: { transcription: string; action_suggestions: string };
  /** RCL-003 additions are optional while older server revisions remain readable. */
  entities?: EntitySummary[];
  mentions?: { mention_id: string; text: string; kind: string; entity_id: string | null; resolution: "accepted" | "rejected" | "unresolved"; evidence: Evidence[]; version: number }[];
  claims?: Claim[];
  actions?: Action[];
  relationships?: Relationship[];
  history?: MemoryHistory[];
}
export interface WorkspaceDeletionPreview { workspace_id: string; version: string; captures: number; originals: number; memories: number }
export interface DeletionResult { id: string; deleted: boolean; replayed: boolean }

export type EntityKind = "person" | "organization" | "place" | "thing" | "event" | "project" | "topic";

export interface EntitySummary {
  entity_id: string;
  kind: EntityKind;
  name: string;
  canonical_name?: string;
  aliases?: string[];
  mention_count?: number;
  memory_count?: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface EntityDetail extends EntitySummary {
  mentions?: { mention_id: string; memory_id: string; raw_text: string; status?: "candidate" | "accepted" | "rejected" | "unresolved"; evidence: Evidence[] }[];
  timeline?: { claim_id: string; memory_id: string; text: string; epistemic_state: EpistemicState; origin: string; recorded_at: string; valid_from: string | null; valid_to: string | null }[];
  memories?: MemorySummary[];
  relationships?: Relationship[];
}
export interface IdentityPreview { source_entity_id: string; target_entity_id: string; accepted_mentions: number }
export interface IdentityResult { operation_id: string; operation: "merge" | "split"; moved_mentions: number; replayed: boolean }

export interface Claim {
  claim_id: string;
  memory_id: string;
  text: string;
  kind: string;
  epistemic_state: EpistemicState;
  temporal_text: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  supersedes_claim_id?: string | null;
  evidence: Evidence[];
  version: number;
}

export interface Relationship {
  from_name?: string;
  to_name?: string;
  relationship_id: string;
  from_entity_id: string;
  to_entity_id: string;
  type: string;
  status: "candidate" | "accepted" | "rejected";
  version?: number;
  evidence?: Evidence[];
}

/** `open` is the server's persisted accepted state; the UI presents it as accepted. */
export type ActionStatus = "suggested" | "open" | "accepted" | "done" | "cancelled";
export interface Action {
  action_id: string;
  memory_id: string;
  kind: "action" | "commitment";
  text: string;
  due_text: string | null;
  status: ActionStatus;
  version: number;
  evidence: Evidence[];
  created_at: string;
  updated_at: string;
}

export interface MemoryHistory {
  revision: number;
  origin: "model" | "user";
  summary: string | null;
  changed_at: string;
  reason: string | null;
}

export interface CorrectionInput {
  target: "summary" | "transcription" | "claim" | "mention_identity" | "relationship";
  claim_id?: string;
  page_id?: string;
  mention_id?: string;
  entity_id?: string;
  from_entity_id?: string;
  to_entity_id?: string;
  relation_type?: string;
  supersedes_claim_id?: string | null;
  text?: string;
  epistemic_state?: EpistemicState;
  resolution?: "accepted" | "rejected";
  valid_from?: string | null;
  valid_to?: string | null;
  reason?: string;
}

export interface SyncRecord { kind: string; id: string; version: number; data: unknown; deleted?: boolean; }
export interface SyncChange extends SyncRecord { sequence: number; }
export interface SyncChanges { events: SyncChange[]; next_cursor: string | null; has_more: boolean; }
export interface SyncSnapshot { workspace_id: string; cursor: string; records: SyncRecord[]; sources?: { source_id: string; sha256: string; byte_size: number }[]; }
export interface SyncOperation { operation_id: string; kind: "memory.correction" | "action.update"; target_id: string; expected_version: number; payload: unknown; }
export interface SyncPushResult { operation_id: string; status: "applied" | "already_applied" | "conflict" | "rejected" | "retryable_failure"; version?: number; data?: unknown; message?: string; }

export interface Citation {
  citation_id: string;
  memory_id: string;
  memory_revision: number;
  capture_id: string;
  source_id: string | null;
  page: number | null;
  quote: string;
  captured_at: string;
  epistemic_state: EpistemicState | null;
  kind: "summary" | "transcription" | "statement" | "context";
}

export interface SearchResult {
  chunk_id: string;
  memory_id: string;
  memory_revision: number;
  capture_id: string;
  source_id: string | null;
  page: number | null;
  kind: Citation["kind"];
  epistemic_state: EpistemicState | null;
  captured_at: string;
  excerpt: string;
  rank: number;
}

/** The four statuses are NOT interchangeable success states; render each differently. */
export type AskStatus = "answered" | "insufficient_evidence" | "ambiguous" | "unavailable";

export interface AskResponse {
  question: string;
  status: AskStatus;
  answer: string | null;
  sentences: { text: string; citation_ids: string[] }[];
  citations: Citation[];
  limitations: string[];
  sources: Citation[];
  reason: string | null;
  index_as_of: string | null;
  mode: "online_grounded" | "sources_only";
  temporal_mode?: "current" | "original" | "previous" | "changed" | "history" | "before" | "after" | "all";
}
