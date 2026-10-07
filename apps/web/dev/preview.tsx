// Synthetic development fixture only. Not an application API adapter or production entry.
import { createRoot } from "react-dom/client";
import { sha256Hex, type AskResponse, type RecallApiClient, type ServerCapture } from "@recall/api-client";
import type { BrowserAuth, BrowserSession } from "../src/auth/session";
import { App } from "../src/App";
import "../src/styles.css";
import "./preview.css";

const date = "2026-09-18T12:00:00Z";
const sampleQuestion = "What was that place Maya recommended in Lisbon?";
const canvas = document.createElement("canvas");
canvas.width = 640;
canvas.height = 400;
const drawing = canvas.getContext("2d");
if (!drawing) throw new Error("Synthetic preview requires a canvas context.");
drawing.fillStyle = "#ffffff";
drawing.fillRect(0, 0, 640, 400);
drawing.fillStyle = "#101624";
drawing.font = "24px sans-serif";
drawing.fillText("SYNTHETIC SOURCE", 40, 70);
drawing.font = "20px sans-serif";
drawing.fillText("Maya recommends Café Aurora.", 40, 130);
const sourceBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Synthetic source could not be rendered.")), "image/png"));
const sourceBytes = await sourceBlob.arrayBuffer();
const hash = await sha256Hex(sourceBytes);
const citation: AskResponse["citations"][number] = {
  citation_id: "synthetic-citation", memory_id: "synthetic-memory", memory_revision: 1,
  capture_id: "synthetic-capture", source_id: "synthetic-source", page: 1,
  quote: "Maya recommends Café Aurora.", captured_at: date, epistemic_state: null, kind: "transcription",
};
const capture: ServerCapture = {
  capture_id: "synthetic-capture", client_capture_id: "synthetic-capture", status: "ready",
  source_kind: "handwritten_note", captured_at: date, timezone: "UTC", context_hint: "Travel in Lisbon",
  created_at: date, stored_at: date, version: 1, memory_id: "synthetic-memory", processing: null,
  pages: [{ source_id: "synthetic-source", client_page_id: "synthetic-page", ordinal: 1,
    media_type: "image/png", byte_size: sourceBytes.byteLength, declared_sha256: hash,
    server_sha256: hash, upload_state: "verified", original_filename: "synthetic-source.png" }],
};

const api = {
  me: async () => ({ user_id: "synthetic-user" }),
  registerDevice: async () => ({}),
  listCaptures: async () => ({ items: [capture], next_cursor: null }),
  getAiSettings: async () => ({ enabled: false, ai_configured: false }),
  createCapture: async () => { throw new Error("Synthetic preview: uploads are unavailable. Use the signed-in app to upload originals."); },
  ask: async (question: string): Promise<AskResponse> => {
    if (question.trim().toLowerCase() !== sampleQuestion.toLowerCase()) return {
      question, status: "insufficient_evidence", answer: null, sentences: [], citations: [], sources: [],
      limitations: [`This preview has one synthetic question: ${sampleQuestion}`],
      reason: "No live AI or production data is connected.", index_as_of: null, mode: "sources_only",
    };
    return {
      question, status: "answered", answer: "Maya recommended Café Aurora in your Lisbon note.", sentences: [],
      citations: [citation], sources: [citation], limitations: ["Maya’s last name is not recorded."],
      reason: null, index_as_of: date, mode: "online_grounded",
    };
  },
  fetchSource: async () => ({ bytes: sourceBytes, mediaType: "image/png", serverSha256: hash }),
};

const session: BrowserSession = { userId: "synthetic-user", workspaceId: "synthetic-workspace", email: null };
const listeners = new Set<(next: BrowserSession | null) => void>();
const auth: BrowserAuth = {
  getSession: async () => session,
  onChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  signOut: async () => { for (const listener of listeners) listener(null); },
  requestSignIn: async () => { throw new Error("Synthetic preview: no sign-in email is sent. Reload to return to the preview."); },
};

// A partial service is deliberate: only the existing read-only UI calls are simulated.
createRoot(document.getElementById("root")!).render(<App services={{ auth, api: api as unknown as RecallApiClient }} />);
