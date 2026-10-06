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
}

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
}
