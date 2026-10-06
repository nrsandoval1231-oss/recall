/** Wire types for the RCL-001 API. Mirrors docs/API-CONTRACT.md; verified against a live server by tests/e2e. */

export type MediaType = "image/jpeg" | "image/png" | "image/heic" | "image/heif";
export type SourceKind = "handwritten_note" | "photo_document";
export type ServerCaptureStatus = "awaiting_upload" | "stored";
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
  /** Always null in RCL-001; memories arrive with RCL-002. */
  memory_id: string | null;
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
  config: { ai_configured: boolean; consent_required: boolean };
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
