export interface Reading {
  transcription: string;
  uncertainties: string[];
  provider: string;
}

export interface ReadingRequest {
  sha256: string;
  note: string;
}

/**
 * Live Claude is intentionally unwired. This module has no provider client
 * and must not grow a network call. A later build can add one only behind
 * an explicit owner budget and one-photo consent.
 */
export interface Librarian {
  readonly mode: "unavailable" | "synthetic";
  read(input: ReadingRequest): Promise<Reading>;
}

export const unavailableLibrarian: Librarian = {
  mode: "unavailable",
  read() {
    return Promise.reject(new Error("Claude reading is not configured. Recall did not send this photo."));
  },
};
