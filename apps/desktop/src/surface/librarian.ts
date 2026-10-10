export interface Reading {
  transcription: string;
  uncertainties: string[];
  provider: string;
  model?: string;
  status?: "unreviewed";
  sourceSha256?: string;
}

export interface ReadingRequest {
  sha256: string;
  note: string;
  consent: boolean;
  operationId: string;
  vaultId?: string;
  memoryId?: string;
}

/**
 * Live Claude stays off until the desktop process has a key, model, prices,
 * and budgets. This module does not embed a key. A synthetic reader is for tests.
 * The published note changes only when a person saves a correction.
 */
export interface Librarian {
  readonly mode: "unavailable" | "synthetic" | "claude";
  readonly notice: string;
  inspect?(): Promise<Librarian>;
  read(input: ReadingRequest): Promise<Reading>;
}

export const unavailableLibrarian: Librarian = {
  mode: "unavailable",
  notice: "Claude reading is off. Recall will not send this photo anywhere.",
  read() {
    return Promise.reject(new Error("Claude reading is not configured. Recall did not send this photo."));
  },
};
