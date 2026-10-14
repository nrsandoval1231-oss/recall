import { describe, expect, it } from "vitest";
import { EditorSession } from "./editor-session";
import type { VaultMemory } from "../platform/local-vault";
const memory: VaultMemory = {
  id: "memory-a",
  revision: 1,
  state: "active",
  note: "Original?",
  note_path: "a.md",
  source_name: "",
  source_sha256: "",
  conflict: null,
  captured_at: "2026-10-13",
  updated_at: "2026-10-13",
};
const storage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
};
describe("native editor session", () => {
  it("recovers an unsaved draft after restart without replacing the original", () => {
    const store = storage();
    const s = new EditorSession("library-a", memory, store, async () => memory);
    s.edit("Human draft?");
    const reopened = new EditorSession(
      "library-a",
      memory,
      store,
      async () => memory,
    );
    expect(reopened.getSnapshot().body).toBe("Human draft?");
    expect(memory.note).toBe("Original?");
    expect(
      new EditorSession(
        "library-b",
        memory,
        store,
        async () => memory,
      ).getSnapshot().body,
    ).toBe("Original?");
  });
  it("serializes saves and preserves text typed while a save is in flight", async () => {
    let finish!: (m: VaultMemory) => void;
    const intents: {
      operationId: string;
      note: string;
      expectedRevision: number;
    }[] = [];
    const s = new EditorSession("a", memory, storage(), (intent) => {
      intents.push(intent);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    s.edit("First edit");
    const saving = s.save();
    s.edit("Second edit");
    s.save();
    expect(intents).toHaveLength(1);
    finish({ ...memory, revision: 2, note: "First edit" });
    await saving;
    expect(s.getSnapshot().body).toBe("Second edit");
    expect(s.getSnapshot().dirty).toBe(true);
  });
  it("retries an uncertain native save with its exact persisted operation", async () => {
    const store = storage();
    let prior: unknown;
    const s = new EditorSession("a", memory, store, async (intent) => {
      prior = intent;
      throw Error("Disconnected after write");
    });
    s.edit("Keep this");
    await s.save();
    const retry = new EditorSession("a", memory, store, async (intent) => {
      expect(intent).toEqual(prior);
      return { ...memory, revision: 2, note: "Keep this" };
    });
    expect(retry.getSnapshot().paused).toBe(true);
    await retry.save();
    expect(retry.getSnapshot().dirty).toBe(false);
  });
  it("holds a draft when an external revision arrives until the user reviews it", () => {
    const s = new EditorSession("a", memory, storage(), async () => memory);
    s.edit("My draft");
    s.reconcile({ ...memory, revision: 2, note: "Edited elsewhere" });
    expect(s.getSnapshot().body).toBe("My draft");
    expect(s.getSnapshot().paused).toBe(true);
    s.acceptLatest();
    expect(s.getSnapshot().body).toBe("Edited elsewhere");
    expect(s.getSnapshot().dirty).toBe(false);
  });
  it("never overwrites newer content returned when recovering an old save receipt", async () => {
    const s = new EditorSession("a", memory, storage(), async () => ({
      ...memory,
      revision: 3,
      note: "Another human edit",
    }));
    s.edit("My saved draft");
    await s.save();
    expect(s.getSnapshot().paused).toBe(true);
    expect(s.getSnapshot().body).toBe("My saved draft");
    expect(s.getSnapshot().latestBody).toBe("Another human edit");
  });
});

it("keeps a machine proposal paused after restart until explicit human review", async () => {
  const store = storage();
  let calls = 0;
  const commit = async () => {
    calls++;
    return memory;
  };
  const s = new EditorSession("a", memory, store, commit);
  s.propose("Machine transcription?");
  await s.save();
  const reopened = new EditorSession("a", memory, store, commit);
  expect(reopened.getSnapshot().reviewRequired).toBe(true);
  expect(reopened.getSnapshot().paused).toBe(true);
  await reopened.save();
  expect(calls).toBe(0);
});

it("preserves a corrupt recovery journal before accepting any replacement draft", () => {
  const map = new Map<string, string>();
  const key = "recall.editor.v1:a:memory-a";
  map.set(key, "{broken original draft");
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  const session = new EditorSession("a", memory, store, async () => memory);
  expect(session.getSnapshot().paused).toBe(true);
  session.edit("New draft");
  expect(
    [...map.entries()].some(
      ([k, v]) =>
        k.startsWith(`${key}:recovery:`) && v === "{broken original draft",
    ),
  ).toBe(true);
  expect(session.getSnapshot().paused).toBe(true);
});

it("explicitly records a reviewed proposal even when its text matches, then skips clean saves", async () => {
  const intents: unknown[] = [];
  const s = new EditorSession("a", memory, storage(), async (intent) => {
    intents.push(intent);
    return { ...memory, revision: 2, note: intent.note };
  });
  s.propose(memory.note);
  await s.save();
  expect(intents).toHaveLength(0);
  s.keepDraftAfterReview();
  await s.save(true);
  expect(intents).toHaveLength(1);
  await s.save();
  expect(intents).toHaveLength(1);
});

it("saves a conflicting draft only after review against the latest revision", async () => {
  const intents: { expectedRevision: number; note: string }[] = [];
  const s = new EditorSession("a", memory, storage(), async (intent) => {
    intents.push(intent);
    return { ...memory, revision: 3, note: intent.note };
  });
  s.edit("My correction");
  s.reconcile({ ...memory, revision: 2, note: "External correction" });
  await s.save();
  expect(intents).toHaveLength(0);
  s.keepDraftAfterReview();
  await s.save();
  expect(intents).toEqual([expect.objectContaining({ expectedRevision: 2, note: "My correction" })]);
  await s.save();
  expect(intents).toHaveLength(1);
});
