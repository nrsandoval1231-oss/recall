import { invoke } from "@tauri-apps/api/core";
import { unavailableLibrarian, type Librarian, type Reading, type ReadingRequest } from "./librarian";

interface LibrarianStatus {
  ready: boolean;
  reason: string;
  model: string | null;
}

interface StoredReading {
  status: "unreviewed";
  transcription: string;
  uncertainties: string[];
  provider: string;
  model: string;
  source_sha256: string;
}

function tauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function readWithClaude(input: ReadingRequest): Promise<Reading> {
  if (!input.consent) throw new Error("Consent is required. Recall did not send this photo.");
  if (!input.vaultId || !input.memoryId) {
    throw new Error("Open a saved photo before asking Claude to read it. Recall did not send this photo.");
  }
  const stored = await invoke<StoredReading>("librarian_read", {
    expectedVaultId: input.vaultId,
    memoryId: input.memoryId,
    operationId: input.operationId,
    consent: true,
  });
  if (stored.status !== "unreviewed") {
    throw new Error("Claude returned a reading without the unreviewed mark. Your note was not changed.");
  }
  if (stored.source_sha256.toLowerCase() !== input.sha256.toLowerCase()) {
    throw new Error("The stored reading does not match this photo. Your note was not changed.");
  }
  return {
    transcription: stored.transcription,
    uncertainties: stored.uncertainties,
    provider: stored.provider,
    model: stored.model,
    status: "unreviewed",
    sourceSha256: stored.source_sha256,
  };
}

/** The desktop process decides whether Claude is configured. The webview never sees the key. */
export function desktopLibrarian(): Librarian {
  if (!tauriAvailable()) return unavailableLibrarian;
  return {
    mode: "unavailable",
    notice: "Checking whether Claude reading is configured. Recall has not sent this photo.",
    async inspect() {
      const status = await invoke<LibrarianStatus>("librarian_status");
      if (!status.ready || !status.model) {
        return { ...unavailableLibrarian, notice: status.reason || unavailableLibrarian.notice };
      }
      const model = status.model;
      return {
        mode: "claude",
        notice: `Claude (${model}) can read this one photo after you agree. It costs money. The result is an unreviewed proposal, not your note.`,
        read: readWithClaude,
      };
    },
    read() {
      return Promise.reject(new Error("Claude reading is still being checked. Recall did not send this photo."));
    },
  };
}
