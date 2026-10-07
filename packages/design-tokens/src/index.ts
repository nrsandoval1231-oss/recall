/**
 * Platform-neutral tokens and user-facing language shared by mobile (React Native) and
 * desktop (DOM). PROVISIONAL: no final palette, logo, or brand system has been approved
 * (see docs/UX-SPEC.md). Values here are deliberately plain and accessible, not a brand.
 */

export const color = {
  ink: "#16181d",
  inkMuted: "#4a5060",
  paper: "#ffffff",
  surface: "#f4f5f7",
  border: "#c9cdd6",
  accent: "#1f4fd8",
  accentText: "#ffffff",
  success: "#146c3a",
  warning: "#8a5a00",
  danger: "#a31d1d",
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 22 } as const;
export const font = { body: 17, small: 14, title: 28, heading: 22 } as const;
/** Minimum interactive target (points / px). Large capture targets are a UX requirement. */
export const minTarget = 48;

/** The only states a user ever sees for a capture. Words, never color alone. */
export type CaptureStatusKey =
  | "saved_locally"
  | "uploading"
  | "uploaded"
  | "failed"
  | "incomplete"
  // RCL-002 (only when AI processing is on)
  | "queued"
  | "processing"
  | "ready"
  | "needs_review"
  | "processing_failed"
  | "paused";

export interface StatusPresentation {
  label: string;
  /** Non-color indicator (accessible glyph). */
  glyph: string;
  tone: "neutral" | "progress" | "success" | "danger" | "warning";
  detail: string;
}

export const statusPresentation: Record<CaptureStatusKey, StatusPresentation> = {
  saved_locally: {
    label: "Saved on this device",
    glyph: "●",
    tone: "neutral",
    detail: "Safe on this phone. Not uploaded yet.",
  },
  uploading: { label: "Uploading", glyph: "↑", tone: "progress", detail: "Sending the original pages." },
  uploaded: {
    label: "Uploaded",
    glyph: "✓",
    tone: "success",
    detail: "Original pages are stored and verified.",
  },
  failed: {
    label: "Failed — retry available",
    glyph: "!",
    tone: "danger",
    detail: "Still saved on this device. Tap to retry.",
  },
  incomplete: {
    label: "Upload incomplete",
    glyph: "…",
    tone: "warning",
    detail: "Some pages have not arrived yet.",
  },
  queued: { label: "Uploaded · waiting to be read", glyph: "✓", tone: "success", detail: "The original is stored. Reading will start soon." },
  processing: { label: "Reading…", glyph: "◐", tone: "progress", detail: "The original is stored. Recall is reading it." },
  ready: { label: "Ready", glyph: "✓", tone: "success", detail: "Read and searchable. Open it to check the original." },
  needs_review: {
    label: "Ready · check details",
    glyph: "?",
    tone: "warning",
    detail: "Some parts were unclear or couldn't be confirmed against the page.",
  },
  paused: {
    label: "Uploaded · reading paused",
    glyph: "‖",
    tone: "warning",
    detail: "The original is stored and viewable. Reading is paused (AI reading is off or the spending limit was reached).",
  },
  processing_failed: {
    label: "Couldn't read · original is safe",
    glyph: "!",
    tone: "danger",
    detail: "The original is stored and viewable. Reading it failed.",
  },
};

/** Map a server capture (status + processing) to the one status the user sees. */
export function serverStatusKey(status: string, processing: { state: string; blocked_reason?: string | null } | null): CaptureStatusKey {
  // Say *why* nothing is happening instead of an endless "waiting" or "reading".
  if (processing?.blocked_reason === "budget_exhausted" && (status === "stored" || status === "processing")) return "paused";
  if (processing?.state === "cancelled" && status === "stored") return "paused";
  switch (status) {
    case "awaiting_upload":
      return "incomplete";
    case "processing":
      return "processing";
    case "ready":
      return "ready";
    case "needs_review":
      return "needs_review";
    case "failed":
      return "processing_failed";
    default: // stored
      return processing && (processing.state === "queued" || processing.state === "retrying") ? "queued" : "uploaded";
  }
}

export const toneColor: Record<StatusPresentation["tone"], string> = {
  neutral: color.inkMuted,
  progress: color.accent,
  success: color.success,
  danger: color.danger,
  warning: color.warning,
};

export const copy = {
  appName: "Recall",
  tagline: "Capture something you don't want to lose.",
  scan: "Scan",
  save: "Save",
  retake: "Retake",
  remove: "Remove",
  recent: "Recent",
  emptyRecent: "Nothing captured yet.",
  contextHint: "Add a note (optional)",
  untitled: "Notebook pages",
  pagesLabel: (n: number) => (n === 1 ? "1 page" : `${n} pages`),
  askPlaceholder: "What are you trying to remember?",
  ask: "Ask",
  settings: "Settings",
  aiToggle: "Read my captures with AI",
  insufficient: "I couldn't find anything in your captures that answers this.",
  ambiguous: "More than one thing in your captures could match. Here's what I found:",
  unavailable: "Answers are off right now. These are the closest matches in your captures:",
  signIn: "Sign in",
  signInCredentialLabel: "Code or sign-in link",
  signInLinkHint: "Right-click the Sign in button in the email, choose Copy link address, and paste it here without opening it.",
  requestSignInLink: "Email me a sign-in link",
  useExistingSignInCredential: "I already have a sign-in link or code",
  signInRateLimit: "Email delivery is temporarily limited. Use a sign-in link or code you already received, or try again later.",
  signOut: "Sign out",
} as const;

/** WCAG relative luminance contrast ratio between two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
      number,
      number,
      number,
    ];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
