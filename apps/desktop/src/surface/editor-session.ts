import type { VaultMemory } from "../platform/local-vault";
import { noteBody, noteWithBody } from "./vault-context";
export interface EditorIntent {
  operationId: string;
  expectedRevision: number;
  note: string;
  body: string;
}
interface Draft {
  format: "recall-editor-v1";
  body: string;
  baseRevision: number;
  baseNote: string;
  attempt: EditorIntent | null;
  reviewRequired?: boolean;
}
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface EditorSnapshot {
  body: string;
  latestBody: string;
  dirty: boolean;
  saving: boolean;
  paused: boolean;
  message: string;
  error: string;
  revision: number;
  reviewRequired: boolean;
}
/** Local draft journal, not memory authority. Only the revision-safe native writer commits notes. */
export class EditorSession {
  private readonly key: string;
  private memory: VaultMemory;
  private latest: VaultMemory;
  private attempt: EditorIntent | null = null;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: EditorSnapshot;
  constructor(
    identity: string,
    memory: VaultMemory,
    private store: Store,
    private commit: (intent: EditorIntent) => Promise<VaultMemory>,
  ) {
    this.key = `recall.editor.v1:${identity}:${memory.id}`;
    this.memory = memory;
    this.latest = memory;
    this.snapshot = {
      body: noteBody(memory),
      latestBody: noteBody(memory),
      dirty: false,
      saving: false,
      paused: false,
      message: "Saved in library",
      error: "",
      revision: memory.revision,
      reviewRequired: false,
    };
    try {
      const raw = store.getItem(this.key);
      if (raw) {
        const d: unknown = JSON.parse(raw);
        if (!this.valid(d))
          throw Error(
            "Saved editor draft needs recovery; it was not discarded.",
          );
        this.memory = { ...memory, revision: d.baseRevision, note: d.baseNote };
        this.attempt = d.attempt;
        this.snapshot = {
          ...this.snapshot,
          body: d.body,
          dirty: d.body !== noteBody(this.memory),
          paused:
            Boolean(d.attempt) ||
            Boolean(d.reviewRequired) ||
            d.baseRevision !== memory.revision ||
            d.baseNote !== memory.note,
          reviewRequired: Boolean(d.reviewRequired),
          message: d.attempt
            ? "Previous save needs confirmation"
            : d.baseRevision !== memory.revision
              ? "Library changed. Review before saving."
              : "Recovered unsaved draft",
        };
      }
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        paused: true,
        error: String(error),
        message: "Draft recovery needs review",
      };
    }
  }
  private valid(d: unknown): d is Draft {
    if (!d || typeof d !== "object") return false;
    const v = d as Partial<Draft>;
    if (
      v.format !== "recall-editor-v1" ||
      typeof v.body !== "string" ||
      typeof v.baseNote !== "string" ||
      v.body.length > 262144 ||
      v.baseNote.length > 262144 ||
      !Number.isSafeInteger(v.baseRevision) ||
      !v.baseRevision ||
      v.baseRevision < 1
    )
      return false;
    if (v.attempt === null) return true;
    const a = v.attempt;
    return Boolean(
      a &&
      typeof a.operationId === "string" &&
      /^[0-9a-f-]{36}$/i.test(a.operationId) &&
      typeof a.note === "string" &&
      typeof a.body === "string" &&
      a.note.length <= 262144 &&
      Number.isSafeInteger(a.expectedRevision) &&
      a.expectedRevision === v.baseRevision,
    );
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(values: Partial<EditorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...values };
    this.listeners.forEach((fn) => fn());
  }
  private persist() {
    const d: Draft = {
      format: "recall-editor-v1",
      body: this.snapshot.body,
      baseRevision: this.memory.revision,
      baseNote: this.memory.note,
      attempt: this.attempt,
      reviewRequired: this.snapshot.reviewRequired,
    };
    this.store.setItem(this.key, JSON.stringify(d));
  }
  edit(body: string) {
    if (body.length > 262144) {
      this.update({
        error: "Note exceeds 256 KiB. Your existing draft is retained.",
        paused: true,
      });
      return;
    }
    this.update({
      body,
      dirty: body !== noteBody(this.memory),
      message: "Unsaved draft",
    });
    try {
      this.persist();
    } catch (error) {
      this.update({
        paused: true,
        error: `Draft could not be saved on this device: ${String(error)}. Keep this window open.`,
        message: "Autosave paused",
      });
    }
  }
  propose(body: string) {
    this.edit(body);
    this.update({
      paused: true,
      reviewRequired: true,
      message: "Unreviewed draft. Review and explicitly save.",
    });
    try {
      this.persist();
    } catch (error) {
      this.update({ error: String(error) });
    }
  }
  reconcile(memory: VaultMemory) {
    this.latest = memory;
    if (
      memory.revision === this.memory.revision &&
      memory.note === this.memory.note
    )
      return;
    if (this.snapshot.dirty || this.attempt || this.running) {
      this.update({
        paused: true,
        latestBody: noteBody(memory),
        message: "Library changed. Review before saving.",
      });
      return;
    }
    this.memory = memory;
    this.update({
      body: noteBody(memory),
      latestBody: noteBody(memory),
      revision: memory.revision,
    });
  }
  acceptLatest() {
    if (this.running) return;
    this.memory = this.latest;
    this.attempt = null;
    this.store.removeItem(this.key);
    this.update({
      body: noteBody(this.latest),
      latestBody: noteBody(this.latest),
      revision: this.latest.revision,
      dirty: false,
      paused: false,
      reviewRequired: false,
      error: "",
      message: "Loaded latest library version",
    });
  }
  keepDraftAfterReview() {
    if (this.running) return;
    this.memory = this.latest;
    this.attempt = null;
    this.update({
      revision: this.memory.revision,
      dirty: this.snapshot.body !== noteBody(this.memory),
      paused: false,
      reviewRequired: false,
      error: "",
      message: "Draft rebased after your review",
    });
    try {
      this.persist();
    } catch (error) {
      this.update({ paused: true, error: String(error) });
    }
  }
  save(force = false): Promise<void> {
    if (this.running) return this.running;
    if (!force && !this.snapshot.dirty && !this.attempt)
      return Promise.resolve();
    if (this.snapshot.paused && !this.attempt) return Promise.resolve();
    let intent: EditorIntent;
    try {
      intent = this.attempt ?? {
        operationId: crypto.randomUUID(),
        expectedRevision: this.memory.revision,
        note: noteWithBody(this.memory, this.snapshot.body),
        body: this.snapshot.body,
      };
    } catch (error) {
      this.update({
        paused: true,
        error: String(error),
        message: "Note metadata needs review; draft retained",
      });
      return Promise.resolve();
    }
    this.attempt = intent;
    try {
      this.persist();
    } catch (error) {
      this.update({
        paused: true,
        error: String(error),
        message: "Cannot journal save; draft retained",
      });
      return Promise.resolve();
    }
    this.update({ saving: true, error: "", message: "Saving…" });
    const task = (async () => {
      try {
        const saved = await this.commit(intent);
        if (
          saved.id !== this.memory.id ||
          saved.revision <= intent.expectedRevision ||
          saved.state !== "active" ||
          saved.conflict
        )
          throw Error("Native save receipt needs review.");
        this.latest = saved;
        this.memory = saved;
        this.attempt = null;
        if (saved.note !== intent.note) {
          this.update({
            saving: false,
            paused: true,
            latestBody: noteBody(saved),
            revision: saved.revision,
            message: "Previous save recovered; newer content needs review.",
          });
          this.persist();
          return;
        }
        const dirty = this.snapshot.body !== noteBody(saved);
        this.update({
          dirty,
          saving: false,
          paused: false,
          error: "",
          latestBody: noteBody(saved),
          revision: saved.revision,
          message: dirty ? "Newer draft retained" : "Saved in library",
        });
        if (dirty) this.persist();
        else this.store.removeItem(this.key);
      } catch (error) {
        this.update({
          saving: false,
          paused: true,
          error: String(error),
          message: "Save stopped. Draft retained; review or retry.",
        });
      } finally {
        this.running = null;
      }
    })();
    this.running = task;
    return task;
  }
}
