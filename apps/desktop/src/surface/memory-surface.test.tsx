// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  render as rawRender,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  KnowledgeSearchReply,
  MemoryAnswer,
  LocalVault,
  SourceAnswer,
  VaultMemory,
  VaultStatus,
} from "../platform/local-vault";
import type { Librarian } from "./librarian";
import { MemorySurface } from "./MemorySurface";

function render(ui: Parameters<typeof rawRender>[0]) {
  const result = rawRender(ui);
  fireEvent.click(screen.getByRole("button", { name: "Memories" }));
  return result;
}
beforeAll(() => {
  if (!globalThis.crypto?.randomUUID)
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

const emptyStatus: VaultStatus = {
  root: null,
  vault_id: null,
  vault_identity: null,
};
const chosen: VaultStatus = {
  root: "/vaults/field",
  vault_id: "session-token",
  vault_identity: "11111111-1111-4111-8111-111111111111",
};

function memory(over: Partial<VaultMemory> = {}): VaultMemory {
  return {
    state: "active",
    note_path: "11111111-1111-4111-8111-111111111111.md",
    id: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    note: "North lot laydown yard. Gate code 48?",
    source_name: "north-lot.png",
    source_sha256: "ab".repeat(32),
    captured_at: "2026-08-21T15:00:00Z",
    updated_at: "2026-08-21T15:04:00Z",
    conflict: null,
    ...over,
  };
}

function vault(
  over: Partial<LocalVault> = {},
  memories: VaultMemory[] = [],
): LocalVault {
  return {
    available: true,
    status: vi.fn(async () => chosen),
    select: vi.fn(async () => null),
    openDefault: vi.fn(async () => ({
      ...chosen,
      root: "/home/me/Documents/Recall",
    })),
    capture: vi.fn(async () => null),
    list: vi.fn(async () => memories),
    rebuild: vi.fn(async () => memories),
    restoreNote: vi.fn(),
    remove: vi.fn(async () => memory({ state: "deleted" })),
    correct: vi.fn(async (_vaultId, _id, _rev, _op, note) =>
      memory({ revision: 2, note }),
    ),
    source: vi.fn(async () => ({
      bytes: [137, 80, 78, 71],
      mime_type: "image/png",
      sha256: "ab".repeat(32),
    })),
    history: vi.fn(async () => [
      {
        revision: 1,
        note: "North lot laydown yard. Gate code 48?",
        recorded_at: "2026-08-21T15:04:00Z",
        origin: "human:recall" as const,
        kind: "capture" as const,
      },
    ]),
    ...over,
  };
}

const preview: LocalVault = {
  ...vault(),
  available: false,
  status: async () => emptyStatus,
};

it("requires separate source consent and unchecked cost review for the retained failed organization", async () => {
  const initial = memory({ source_name: "Draft.png", note: "Utility late." });
  const parser = "22222222-2222-4222-8222-222222222222",
    prior = "33333333-3333-4333-8333-333333333333";
  localStorage.setItem(
    `recall.meeting.v1:${chosen.vault_identity}:${initial.id}`,
    JSON.stringify({
      parser,
      organizer: prior,
      publisher: "44444444-4444-4444-8444-444444444444",
      revision: 1,
      published: false,
    }),
  );
  const client = vault(
    {
      parse: vi.fn(async (_scope, id, revision, operation) => ({
        memory_id: id,
        expected_revision: revision,
        operation_id: operation,
        source_sha256: initial.source_sha256,
        state: "parsed",
        message: "Synthetic saved parse",
      })),
      organize: vi.fn(),
      reviewedOrganize: vi.fn(async () => ({})),
      reviewOrganization: vi.fn(async (_scope, _parser, prior) => ({
        prior_operation_id: prior,
        reuse_operation: false,
      })),
      publish: vi.fn(async () => ({
        ...initial,
        revision: 2,
        note: `---\nrecall_id: "${initial.id}"\n---\n\nUtility late.`,
      })),
    },
    [initial],
  );
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(
    await screen.findByRole("button", { name: "Open original: Draft" }),
  );
  const review = screen.getByRole("button", {
    name: "Review and retry organization",
  }) as HTMLButtonElement;
  const acknowledgement = screen.getByLabelText(
    /I reviewed the failed attempt/,
  ) as HTMLInputElement;
  expect(acknowledgement.checked).toBe(false);
  expect(review.disabled).toBe(true);
  await user.click(acknowledgement);
  expect(review.disabled).toBe(true);
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  expect(review.disabled).toBe(false);
  await user.click(review);
  await screen.findByText(
    "Organized in Recall. Uncertainty and original evidence preserved.",
  );
  expect(client.organize).not.toHaveBeenCalled();
  expect(client.reviewedOrganize).toHaveBeenCalledWith(
    "session-token",
    parser,
    prior,
    expect.any(String),
    true,
    true,
  );
  expect(
    screen.queryByRole("button", { name: "Review and retry organization" }),
  ).toBeNull();
});

describe("Memory Surface", () => {
  it("keeps original evidence separate from the decorative workspace asset", () => {
    const cssPath = [
      resolve("src/surface/memory-surface.css"),
      resolve("apps/desktop/src/surface/memory-surface.css"),
    ].find((path) => existsSync(path));
    expect(cssPath).toBeTruthy();
    const css = readFileSync(cssPath ?? "", "utf8");
    expect(css).not.toMatch(/Recall\/Sources|source_sha256/i);
    expect(css).not.toMatch(/memory-surface-reference|\.jpg|\.png|\.webp/i);
  });

  it("uses vault notes instead of the fixture and opens the original", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({}, [page]);
    render(<MemorySurface vault={client} />);
    expect(
      await screen.findByRole("heading", { name: "north-lot" }),
    ).toBeTruthy();
    expect(screen.queryByText("Blake Combs")).toBeNull();
    expect(screen.queryByText(/Synthetic demo/)).toBeNull();
    expect(screen.queryByRole("region", { name: "People" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Locations" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Key Topics" })).toBeNull();
    expect(screen.queryByRole("region", { name: /^Related/ })).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Capture calendar" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Ask MeGraph" }),
      "laydown",
    );
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText(/Markdown notes in your vault/)).toBeTruthy();
    expect(screen.getByText(/Gate code 48\?/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Open original: north-lot" }),
    );
    expect(client.source).toHaveBeenCalledWith("session-token", page.id);
    expect((await screen.findByTestId("integrity")).textContent).toMatch(
      /Hash matches the vault record/,
    );
    expect(screen.getByRole("img", { name: /north-lot.png/ })).toBeTruthy();
  });

  it("imports a photo into the vault and retries the same operation", async () => {
    const user = userEvent.setup();
    const saved = memory({
      id: "22222222-2222-4222-8222-222222222222",
      note: "North lot, confirm the gate",
    });
    const capture = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(saved);
    const client = vault({ capture, status: async () => chosen }, []);
    render(<MemorySurface vault={client} />);
    expect(
      await screen.findByRole("heading", {
        name: "Your memories belong here.",
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Camera ·/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Optional note" }),
      "North lot, confirm the gate",
    );
    await user.click(screen.getByRole("button", { name: "Import photo" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/disk full/);
    await user.click(
      screen.getByRole("button", { name: "Retry the same import" }),
    );
    expect(
      (await screen.findAllByText(/Saved in your library/)).length,
    ).toBeGreaterThan(0);
    expect(document.querySelector(".ms")?.getAttribute("data-mode")).toBe(
      "vault",
    );
    expect(capture).toHaveBeenCalledTimes(2);
    const first = capture.mock.calls[0] as [string, string, string];
    const second = capture.mock.calls[1] as [string, string, string];
    expect(first[0]).toBe("session-token");
    expect(first[1]).toBe(second[1]);
    expect(first[1]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first[2]).toBe("North lot, confirm the gate");
    expect(screen.queryByText("Blake Combs")).toBeNull();
  });

  it("versions a correction without changing the original hash", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({}, [page]);
    render(<MemorySurface vault={client} />);
    await user.click(
      await screen.findByRole("button", { name: "Open original: north-lot" }),
    );
    const field = await screen.findByRole("textbox", {
      name: "Your correction",
    });
    await user.clear(field);
    await user.type(field, "The gate code was not legible.");
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(client.correct).toHaveBeenCalledWith(
      "session-token",
      page.id,
      1,
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      "The gate code was not legible.",
    );
    expect(
      await screen.findByText(/original source is unchanged/),
    ).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText(/Revision 1/)).toBeTruthy();
  });

  it("does not call a reader or the network unless a synthetic reader is injected and consented", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const page = memory();
    render(<MemorySurface vault={vault({}, [page])} />);
    await user.click(
      await screen.findByRole("button", { name: "Open original: north-lot" }),
    );
    expect(screen.getByText(/will not send this photo/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Read this photo" }),
    ).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    cleanup();

    const read = vi.fn(async () => ({
      transcription: "Met w/ Brad?",
      uncertainties: ["Brad is an unresolved first name."],
      provider: "synthetic-fixture",
    }));
    const librarian: Librarian = {
      mode: "synthetic",
      notice: "Synthetic reader. It does not call Claude.",
      read,
    };
    const consented = vault({}, [page]);
    render(<MemorySurface vault={consented} librarian={librarian} />);
    await user.click(
      await screen.findByRole("button", { name: "Open original: north-lot" }),
    );
    const readButton = screen.getByRole("button", {
      name: "Read this photo",
    }) as HTMLButtonElement;
    expect(readButton.disabled).toBe(true);
    await user.click(
      screen.getByRole("checkbox", { name: /synthetic reader/ }),
    );
    await user.click(readButton);
    expect((await screen.findAllByText("Met w/ Brad?")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/unresolved first name/)).toBeTruthy();
    expect(screen.getByText(/Not saved to the vault/)).toBeTruthy();
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        consent: true,
        sha256: page.source_sha256,
        memoryId: page.id,
      }),
    );
    expect(consented.correct).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("saves a consented synthetic reading only when the person saves the note", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({}, [page]);
    const read = vi.fn(async () => ({
      transcription: "Met w/ Brad?",
      uncertainties: ["Brad is an unresolved first name."],
      provider: "synthetic-fixture",
    }));
    render(
      <MemorySurface
        vault={client}
        librarian={{
          mode: "synthetic",
          notice: "Synthetic reader. It does not call Claude.",
          read,
        }}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Open original: north-lot" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /synthetic reader/ }),
    );
    await user.click(screen.getByRole("button", { name: "Read this photo" }));
    expect(await screen.findByText(/Not saved to the vault/)).toBeTruthy();
    expect(client.correct).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(client.correct).toHaveBeenCalledWith(
      "session-token",
      page.id,
      1,
      expect.any(String),
      "Met w/ Brad?",
    );
  });

  it("opens the default vault without a renderer path and can remove a memory", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({ status: async () => emptyStatus }, []);
    client.list = vi.fn(async () => []);
    render(<MemorySurface vault={client} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(
      await screen.findByRole("button", { name: "Use default library" }),
    );
    expect(client.openDefault).toHaveBeenCalledWith();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("/home/me/Documents/Recall")).toBeTruthy();

    cleanup();
    const filled = vault({}, [page]);
    render(<MemorySurface vault={filled} />);
    await user.click(
      await screen.findByRole("button", { name: "Open original: north-lot" }),
    );
    const remove = screen.getByRole("button", {
      name: "Remove from Recall",
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    await user.click(
      screen.getByRole("checkbox", { name: /Remove from Recall/ }),
    );
    await user.click(remove);
    expect(filled.remove).toHaveBeenCalledWith(
      "session-token",
      page.id,
      1,
      expect.any(String),
      "active",
    );
  });

  it("asks the saved note after an unreviewed reading and does not spend without consent", async () => {
    const user = userEvent.setup();
    const page = memory();
    const client = vault({}, [page]);
    const read = vi.fn(async () => {
      throw new Error(
        "The Claude budget for this desktop is spent. Recall did not send this photo. Your note was not changed.",
      );
    });
    const librarian: Librarian = {
      mode: "claude",
      notice:
        "Claude (claude-test) can read this one photo after you agree. It costs money.",
      read,
    };
    render(<MemorySurface vault={client} librarian={librarian} />);
    await user.click(
      await screen.findByRole("button", { name: "Open original: north-lot" }),
    );
    const readButton = screen.getByRole("button", {
      name: "Read this photo with Claude",
    }) as HTMLButtonElement;
    expect(readButton.disabled).toBe(true);
    expect(read).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("checkbox", { name: /Send this one photo to Claude/ }),
    );
    await user.click(readButton);
    expect((await screen.findByRole("alert")).textContent).toMatch(/budget/);
    expect(read).toHaveBeenCalledTimes(1);
    expect(client.correct).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Ask MeGraph" }),
      "laydown",
    );
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText(/Gate code 48\?/)).toBeTruthy();
    expect(client.list).toHaveBeenCalledWith("session-token", "laydown");
  });

  it("refuses a mismatched original hash", async () => {
    const user = userEvent.setup();
    const client = vault(
      {
        source: vi.fn(async () => ({
          bytes: [1],
          mime_type: "image/png",
          sha256: "cd".repeat(32),
        })),
      },
      [memory()],
    );
    render(<MemorySurface vault={client} />);
    await user.click(
      await screen.findByRole("button", { name: "Open original: north-lot" }),
    );
    expect((await screen.findByTestId("integrity")).textContent).toMatch(
      /does not match/,
    );
  });
});

it("saves messy text without provider consent and retrieves original source quotes through native Ask", async () => {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  const text =
    "Brad says maybe 5–10 MW? Utility late. Call Sarah. Crossed out: 8 MW confirmed.";
  const bytes = new TextEncoder().encode(text);
  const sha = Array.from(
    new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const saved = memory({
    note: text,
    source_name: "",
    source_sha256: "",
    note_path: "meeting.md",
  });
  const captureNote = vi.fn(async () => saved);
  const parse = vi.fn();
  const organize = vi.fn();
  const publish = vi.fn();
  const ask = vi.fn(async () => ({
    question: "utility delay",
    message: "Source-backed matches; retrieved quotes.",
    hits: [
      {
        memory_id: saved.id,
        revision: 1,
        note_basename: "meeting.md",
        current_excerpt: text,
        original_excerpt: text,
        match_reason: "Wording match in the current saved note.",
        human_corrected: true,
        original_start_byte: 0,
        original_end_byte: bytes.length,
        source_sha256: sha,
        mime_type: "text/plain",
      },
    ],
  }));
  render(
    <MemorySurface
      vault={vault({
        captureNote,
        parse,
        organize,
        publish,
        ask,
        source: vi.fn(async () => ({
          bytes: Array.from(bytes),
          sha256: sha,
          mime_type: "text/plain",
        })),
      })}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Write ·/ }));
  await user.type(screen.getByLabelText("Your note"), text);
  await user.click(screen.getByRole("button", { name: "Save note" }));
  expect(
    await screen.findByText(
      "Saved locally. Agree before sending this source to Jev and Claude.",
    ),
  ).toBeTruthy();
  expect(captureNote).toHaveBeenCalledWith(
    "session-token",
    expect.any(String),
    text,
  );
  expect(parse).not.toHaveBeenCalled();
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  expect(screen.getByTestId("integrity").textContent).toContain("Hash matches");
  expect(screen.queryByRole("img")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.type(
    screen.getByRole("searchbox"),
    "What happened with that utility delay?",
  );
  await user.click(screen.getByRole("button", { name: "Ask" }));
  expect(
    await screen.findByRole("heading", { name: "Source-backed matches" }),
  ).toBeTruthy();
  expect(ask).toHaveBeenCalledWith(
    "session-token",
    "What happened with that utility delay?",
  );
  expect(
    screen.getByRole("button", { name: "Inspect original evidence" }),
  ).toBeTruthy();
  expect(screen.getByText(`SHA-256: ${sha}`)).toBeTruthy();
  expect(
    screen.getByText("Wording match in the current saved note."),
  ).toBeTruthy();
  expect(screen.getByText(/Includes user corrections/)).toBeTruthy();
  expect(
    screen.getByText(`Original excerpt: bytes 0–${bytes.length}`),
  ).toBeTruthy();
});

it("finishing organization of A never replaces B's correction editor after navigation", async () => {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  const a = memory({ source_name: "A.png", note: "A source" });
  const b = memory({
    id: "22222222-2222-4222-8222-222222222222",
    source_name: "B.png",
    note: "B human draft",
  });
  let finish!: (value: unknown) => void;
  const organize = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const v = vault(
    {
      parse: vi.fn(async (_scope, id, revision, operation) => ({
        memory_id: id,
        expected_revision: revision,
        operation_id: operation,
        source_sha256: a.source_sha256,
        state: "parsed",
        message: "Fixture",
      })),
      organize,
      publish: vi.fn(async () => ({
        ...a,
        revision: 2,
        note: "Published A document",
      })),
    },
    [a, b],
  );
  const user = userEvent.setup();
  render(<MemorySurface vault={v} />);
  await user.click(
    await screen.findByRole("button", { name: "Open original: A" }),
  );
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  await user.click(
    screen.getByRole("button", { name: "Organize this memory" }),
  );
  await screen.findByText("Claude is organizing source-linked memory…");
  await user.click(screen.getByRole("button", { name: "Timeline" }));
  await user.click(
    await screen.findByRole("button", { name: /Aug 21, 2026 · B/ }),
  );
  expect(
    (screen.getByLabelText("Your correction") as HTMLTextAreaElement).value,
  ).toBe("B human draft");
  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(screen.getByRole("status").textContent).toContain(
    "Claude is organizing",
  );
  await user.click(screen.getByRole("button", { name: "Timeline" }));
  await user.click(
    await screen.findByRole("button", { name: /Aug 21, 2026 · B/ }),
  );
  await act(async () => {
    finish({});
  });
  await screen.findByText(
    "Organized in Recall. Uncertainty and original evidence preserved.",
  );
  expect(
    (screen.getByLabelText("Your correction") as HTMLTextAreaElement).value,
  ).toBe("B human draft");
});

it("older Ask responses cannot replace a newer source-backed result", async () => {
  let first!: (value: { question: string; message: string; hits: [] }) => void;
  const ask = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    )
    .mockResolvedValueOnce({
      question: "second",
      message: "Newest result",
      hits: [],
    });
  render(<MemorySurface vault={vault({ ask }, [memory()])} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Search" }));
  const input = await screen.findByRole("searchbox");
  await user.type(input, "first");
  fireEvent.submit(screen.getByRole("search"));
  await user.clear(input);
  await user.type(input, "second");
  fireEvent.submit(screen.getByRole("search"));
  await screen.findByText("Newest result");
  await act(async () => {
    first({ question: "first", message: "Old result", hits: [] });
  });
  expect(screen.getByText("Newest result")).toBeTruthy();
  expect(screen.queryByText("Old result")).toBeNull();
});

it("preserves a newer unsaved draft when organization finishes on the same memory", async () => {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  const a = memory({ source_name: "Draft.png", note: "Original draft" });
  let finish!: (value: unknown) => void;
  const organize = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <MemorySurface
      vault={vault(
        {
          parse: vi.fn(async (_scope, id, revision, operation) => ({
            memory_id: id,
            expected_revision: revision,
            operation_id: operation,
            source_sha256: a.source_sha256,
            state: "parsed",
            message: "Fixture",
          })),
          organize,
          publish: vi.fn(async () => ({
            ...a,
            revision: 2,
            note: "Published machine document",
          })),
        },
        [a],
      )}
    />,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Open original: Draft" }),
  );
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  await user.click(
    screen.getByRole("button", { name: "Organize this memory" }),
  );
  await screen.findByText("Claude is organizing source-linked memory…");
  await user.clear(screen.getByLabelText("Your correction"));
  await user.type(
    screen.getByLabelText("Your correction"),
    "Newer unsaved human draft",
  );
  await act(async () => {
    finish({});
  });
  await screen.findByText(/Your newer unsaved correction draft is preserved/);
  expect(
    (screen.getByLabelText("Your correction") as HTMLTextAreaElement).value,
  ).toBe("Newer unsaved human draft");
});

it("shows saved unresolved people and source agenda in the existing panels", async () => {
  const user = userEvent.setup();
  const id = "11111111-1111-4111-8111-111111111111";
  const saved = memory({
    note: `---\nrecall_id: "${id}"\n---\n## Unresolved entity mentions\n\n- “Sarah” — person candidate; identity unresolved\n## Follow-ups (not confirmed commitments)\n\n- [ ] “Call Sarah” — source bytes 20–30\n## Open questions and uncertainty\n\n-  “Need generators by Dec?” — source bytes 31–55\n`,
  });
  render(<MemorySurface vault={vault({}, [saved])} />);
  await screen.findByRole("button", { name: "Open original: north-lot" });
  await user.click(screen.getByRole("button", { name: "People" }));
  expect(screen.getAllByRole("button", { name: /^Sarah/ })[0]).toBeTruthy();
  expect(
    screen.getAllByText(/person candidate; identity unresolved/)[0],
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Timeline" }));
  await user.click(screen.getByRole("button", { name: /Aug 21, 2026/ }));
  expect(screen.getAllByText(/Call Sarah/).length).toBeGreaterThan(0);
});

it("edits organized note words while preserving native properties in the save payload", async () => {
  const user = userEvent.setup();
  const header = `---\nrecall_id: "11111111-1111-4111-8111-111111111111"\ntitle: "Utility meeting"\nsource_sha256: "original-source-hash"\n---\n\n`;
  const saved = memory({ revision: 2, note: header + "Utility late." });
  const client = vault(
    {
      correct: vi.fn(async (_vault, _id, _rev, _op, note) => ({
        ...saved,
        revision: 3,
        note,
      })),
    },
    [saved],
  );
  render(<MemorySurface vault={client} />);
  await user.click(
    await screen.findByRole("button", {
      name: "Open original: Utility meeting",
    }),
  );
  const editor = await screen.findByRole("textbox", {
    name: "Your correction",
  });
  expect((editor as HTMLTextAreaElement).value).toBe("Utility late.");
  await user.clear(editor);
  await user.type(editor, "Utility is now on time.");
  await user.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Correction saved in the library/);
  expect(client.correct).toHaveBeenCalledWith(
    "session-token",
    saved.id,
    2,
    expect.any(String),
    header + "Utility is now on time.",
  );
  expect((editor as HTMLTextAreaElement).value).toBe("Utility is now on time.");
  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(screen.queryByText(/Correction saved in the library/)).toBeNull();
});

it("replaces failed organization progress with the error rather than a stale checking banner", async () => {
  const initial = memory({ source_name: "Draft.txt", note: "Utility late." });
  const client = vault(
    {
      source: vi.fn(async () => ({
        bytes: Array.from(new TextEncoder().encode(initial.note)),
        mime_type: "text/plain",
        sha256: initial.source_sha256,
      })),
      parse: vi.fn(async (_scope, id, revision, operation) => ({
        memory_id: id,
        expected_revision: revision,
        operation_id: operation,
        source_sha256: initial.source_sha256,
        state: "parsed",
        message: "Synthetic parser",
      })),
      organize: vi.fn(async () => {
        throw new Error("Synthetic provider failure");
      }),
      publish: vi.fn(),
    },
    [initial],
  );
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(
    await screen.findByRole("button", { name: "Open original: Draft" }),
  );
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  await user.click(
    screen.getByRole("button", { name: "Organize this memory" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText(/Claude organization stopped/)).toBeNull();
  expect(screen.queryByText(/Claude is organizing/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(client.publish).not.toHaveBeenCalled();
});

it("organization completion fills body-only editing without duplicating native properties on save", async () => {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  const initial = memory({ source_name: "Draft.png", note: "Original draft" });
  const header = `---\nrecall_id: "${initial.id}"\ntitle: "Utility meeting"\n---\n\n`;
  const published = { ...initial, revision: 2, note: header + "Utility late." };
  let finish!: (value: unknown) => void;
  const client = vault(
    {
      parse: vi.fn(async (_scope, id, revision, operation) => ({
        memory_id: id,
        expected_revision: revision,
        operation_id: operation,
        source_sha256: initial.source_sha256,
        state: "parsed",
        message: "Synthetic fixture",
      })),
      organize: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
      publish: vi.fn(async () => published),
      correct: vi.fn(async (_scope, _id, _rev, _op, note) => ({
        ...published,
        revision: 3,
        note,
      })),
    },
    [initial],
  );
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(
    await screen.findByRole("button", { name: "Open original: Draft" }),
  );
  await user.click(screen.getByLabelText(/Send this source to Jev and Claude/));
  await user.click(
    screen.getByRole("button", { name: "Organize this memory" }),
  );
  await screen.findByText("Claude is organizing source-linked memory…");
  await act(async () => {
    finish({});
  });
  await screen.findByText(
    "Organized in Recall. Uncertainty and original evidence preserved.",
  );
  const editor = screen.getByRole("textbox", {
    name: "Your correction",
  }) as HTMLTextAreaElement;
  expect(editor.value).toBe("Utility late.");
  await user.click(screen.getByRole("button", { name: "Save correction" }));
  expect(client.correct).not.toHaveBeenCalled();
  await user.type(editor, " Confirm date.");
  await user.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Correction saved in the library/);
  expect(client.correct).toHaveBeenCalledWith(
    "session-token",
    initial.id,
    2,
    expect.any(String),
    published.note + " Confirm date.",
  );
});

it.each(["People", "Topics"])(
  "discards a late Ask result after navigating to %s",
  async (label) => {
    let finish!: (value: SourceAnswer) => void;
    const ask = vi.fn(
      () =>
        new Promise<SourceAnswer>((resolve) => {
          finish = resolve;
        }),
    );
    render(<MemorySurface vault={vault({ ask }, [memory()])} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(await screen.findByRole("searchbox"), "utility");
    fireEvent.submit(screen.getByRole("search"));
    await user.click(screen.getByRole("button", { name: label }));
    await act(async () =>
      finish({ question: "utility", message: "Stale source result", hits: [] }),
    );
    expect(screen.queryByText("Stale source result")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Source-backed matches" }),
    ).toBeNull();
  },
);

it("keeps an empty native vault empty even with the canonical preview parameter", async () => {
  history.replaceState(null, "", "/?design=canonical");
  try {
    rawRender(<MemorySurface vault={vault()} />);
    await screen.findByRole("heading", { name: "Your memories belong here." });
    expect(screen.queryByText("Permian Power Expansion")).toBeNull();
    expect(screen.queryByText("Blake Combs")).toBeNull();
    expect(document.querySelector(".ms")?.getAttribute("data-mode")).toBe(
      "vault",
    );
  } finally {
    history.replaceState(null, "", "/");
  }
});

it("launches the canonical empty memory field without synthetic memories", async () => {
  rawRender(<MemorySurface vault={preview} />);
  expect(
    screen.getByRole("heading", { name: "Your memories belong here." }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: /Camera/ })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /Speak/ }).getAttribute("aria-disabled"),
  ).toBe("true");
  expect(screen.getByRole("button", { name: /Write/ })).toBeTruthy();
  expect(screen.getByRole("searchbox", { name: "Ask MeGraph" })).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Your memory field" }).textContent,
  ).toContain("0 memories in your library");
  expect(
    screen
      .getByRole("complementary", { name: "Library context" })
      .querySelectorAll("dd").length,
  ).toBe(3);
  expect(
    [
      ...screen
        .getByRole("complementary", { name: "Library context" })
        .querySelectorAll("dd"),
    ].map((node) => node.textContent),
  ).toEqual(["0", "0", "0"]);
  expect(document.querySelectorAll(".graph-node").length).toBe(0);
  expect(screen.queryByText("Brooks Campus")).toBeNull();
  expect(
    screen.queryByRole("complementary", { name: "Capture calendar" }),
  ).toBeNull();
});

it("keeps failed capture intent scoped to its vault when choosing another vault", async () => {
  const user = userEvent.setup();
  const captureNote = vi
    .fn()
    .mockRejectedValueOnce(new Error("disk unavailable"))
    .mockResolvedValueOnce(memory());
  const second = {
    ...chosen,
    vault_id: "second-session",
    vault_identity: "22222222-2222-4222-8222-222222222222",
  };
  const client = vault({ captureNote, select: vi.fn(async () => second) });
  rawRender(<MemorySurface vault={client} />);
  await user.click(screen.getByRole("button", { name: /Write ·/ }));
  await user.type(screen.getByLabelText("Your note"), "Vault A private draft");
  await user.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByRole("alert");
  const firstId = captureNote.mock.calls[0]![1];
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(
    screen.getByRole("button", { name: "Open existing library" }),
  );
  await user.click(screen.getByRole("button", { name: /Write ·/ }));
  expect(
    (screen.getByLabelText("Your note") as HTMLTextAreaElement).value,
  ).toBe("");
  await user.type(screen.getByLabelText("Your note"), "Vault B draft");
  await user.click(screen.getByRole("button", { name: "Save note" }));
  expect(captureNote.mock.calls[1]).toEqual([
    "second-session",
    expect.any(String),
    "Vault B draft",
  ]);
  expect(captureNote.mock.calls[1]![1]).not.toBe(firstId);
  expect(
    sessionStorage.getItem(
      `recall.desktop.capture.v1:${chosen.vault_identity}`,
    ),
  ).toContain("Vault A private draft");
});

it("Cancel preserves the Write draft and returns keyboard focus to its bubble", async () => {
  const user = userEvent.setup();
  rawRender(<MemorySurface vault={vault()} />);
  const write = screen.getByRole("button", { name: /Write ·/ });
  await user.click(write);
  await user.type(screen.getByLabelText("Your note"), "Unsaved draft?");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await act(
    async () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))),
  );
  expect(document.activeElement).toBe(write);
  await user.click(write);
  expect(
    (screen.getByLabelText("Your note") as HTMLTextAreaElement).value,
  ).toBe("Unsaved draft?");
});

it("restores a pending photo to Camera with the same retry identity", async () => {
  const intent = {
    operationId: "22222222-2222-4222-8222-222222222222",
    note: "Saved camera context",
    kind: "photo",
  };
  sessionStorage.setItem(
    `recall.desktop.capture.v1:${chosen.vault_identity}`,
    JSON.stringify(intent),
  );
  const client = vault({ capture: vi.fn(async () => null) });
  rawRender(<MemorySurface vault={client} />);
  const retry = await screen.findByRole("button", {
    name: "Retry the same import",
  });
  expect(screen.queryByRole("button", { name: "Save note" })).toBeNull();
  fireEvent.click(retry);
  await act(async () => {});
  expect(client.capture).toHaveBeenCalledWith(
    "session-token",
    intent.operationId,
    intent.note,
  );
});

it("restores a pre-capture writing draft after app restart without inventing a saved memory", async () => {
  const user = userEvent.setup();
  const client = vault();
  const view = rawRender(<MemorySurface vault={client} />);
  await user.click(screen.getByRole("button", { name: /Write ·/ }));
  await user.type(
    screen.getByLabelText("Your note"),
    "Unfinished native writing draft?",
  );
  view.unmount();
  rawRender(<MemorySurface vault={client} />);
  await screen.findByText(/Checking this device/).catch(() => {});
  await user.click(screen.getByRole("button", { name: /Write ·/ }));
  expect(
    (screen.getByLabelText("Your note") as HTMLTextAreaElement).value,
  ).toBe("Unfinished native writing draft?");
  expect(client.captureNote).toBeUndefined();
  expect(screen.queryByTestId("integrity")).toBeNull();
});

it("requires reviewed provider disclosure and separate explicit graph consent", async () => {
  const configured = {
    extraction: "provider A",
    embedding: "provider B",
    reranking: "provider C",
  };
  const client = vault({
    knowledgeStatus: vi.fn(async () => ({
      enabled: false,
      include_existing: false,
      generation: 0,
      provider_disclosure:
        "Notes and questions may be sent to these providers.",
      providers: configured,
      answer_enabled: false,
      answer_provider: "provider A",
      service: {
        state: "ready",
        pending: 0,
        indexed: 0,
        failed: 0,
        message: "Ready",
        providers: configured,
      },
    })),
    knowledgeConsent: vi.fn(async () => ({
      version: 1,
      vault_id: chosen.vault_identity!,
      enabled: true,
      include_existing: false,
      generation: 1,
      snapshot_sha256: "",
      existing_fence: [],
      dismissed_facts: [],
    })),
  });
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  await screen.findByText(/Notes and questions may be sent/);
  const enable = screen.getByRole("button", {
    name: "Enable connected knowledge",
  }) as HTMLButtonElement;
  expect(enable.disabled).toBe(true);
  await user.click(screen.getByLabelText(/I understand that graph processing/));
  expect(
    (screen.getByLabelText(/Also process existing notes/) as HTMLInputElement)
      .checked,
  ).toBe(false);
  await user.click(enable);
  expect(client.knowledgeConsent).toHaveBeenCalledWith(
    chosen.vault_id,
    true,
    false,
  );
});

it("requires separate named-provider approval for quoted answers", async () => {
  const providers = {
    extraction: "Anthropic Claude model-x",
    embedding: "embedder",
    reranking: "ranker",
  };
  const status = vi
    .fn()
    .mockResolvedValueOnce({
      enabled: true,
      include_existing: false,
      generation: 1,
      provider_disclosure: "Graph provider disclosure.",
      providers,
      answer_enabled: false,
      answer_provider: providers.extraction,
      service: {
        state: "ready",
        pending: 0,
        indexed: 1,
        failed: 0,
        message: "Ready",
        providers,
      },
    })
    .mockResolvedValue({
      enabled: true,
      include_existing: false,
      generation: 2,
      provider_disclosure: "Graph provider disclosure.",
      providers,
      answer_enabled: true,
      answer_provider: providers.extraction,
      service: {
        state: "ready",
        pending: 0,
        indexed: 1,
        failed: 0,
        message: "Ready",
        providers,
      },
    });
  const answerConsent = vi.fn(async () => ({
    version: 2,
    vault_id: chosen.vault_identity!,
    enabled: true,
    include_existing: false,
    generation: 2,
    snapshot_sha256: "",
    existing_fence: [],
    dismissed_facts: [],
  }));
  const client = vault({
    knowledgeStatus: status,
    knowledgeAnswerConsent: answerConsent,
  });
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  await screen.findByText(/Configured answer model: Anthropic Claude model-x/);
  expect(
    screen.queryByLabelText(/I understand that graph processing/),
  ).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Enable quoted answers",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(
    screen.getByLabelText(
      /I approve sending each asked question and its selected current note excerpts/,
    ),
  );
  await user.click(
    screen.getByRole("button", { name: "Enable quoted answers" }),
  );
  expect(answerConsent).toHaveBeenCalledWith(chosen.vault_id, true);
  expect(
    await screen.findByText(/Enabled for Anthropic Claude model-x/),
  ).toBeTruthy();
});

it("sends quoted answering only after its explicit action and cancels when the question changes", async () => {
  const source = memory({ note: "Utility late. Crossed out: 8 MW confirmed." });
  const providers = {
    extraction: "Anthropic Claude model-x",
    embedding: "embedder",
    reranking: "ranker",
  };
  const sourceAnswer: SourceAnswer = {
    question: "utility",
    message: "Source-backed matches.",
    hits: [
      {
        memory_id: source.id,
        revision: source.revision,
        note_basename: "meeting.md",
        current_excerpt: source.note,
        original_excerpt: "Utility late.",
        source_sha256: source.source_sha256,
        mime_type: "text/plain",
      },
    ],
  };
  let finish!: (result: MemoryAnswer) => void;
  const memoryAnswer = vi.fn(
    (_vaultId: string, _question: string, _requestId: string) =>
      new Promise<MemoryAnswer>((resolve) => {
        finish = resolve;
      }),
  );
  const client = vault(
    {
      ask: vi.fn(async () => sourceAnswer),
      knowledgeStatus: vi.fn(async () => ({
        enabled: true,
        include_existing: false,
        generation: 1,
        provider_disclosure: "Graph disclosure.",
        providers,
        answer_enabled: true,
        answer_provider: providers.extraction,
        service: {
          state: "ready",
          pending: 0,
          indexed: 1,
          failed: 0,
          message: "Ready",
          providers,
        },
      })),
      memoryAnswer,
      memoryAnswerCancel: vi.fn(async () => true),
    },
    [source],
  );
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.type(
    await screen.findByRole("searchbox", { name: "Ask MeGraph" }),
    "utility",
  );
  await user.click(screen.getByRole("button", { name: "Ask" }));
  const answerButton = await screen.findByRole("button", {
    name: "Answer from notes",
  });
  expect(memoryAnswer).not.toHaveBeenCalled();
  await user.click(answerButton);
  await screen.findByText("Selecting exact source quotations…");
  expect(memoryAnswer).toHaveBeenCalledWith(
    chosen.vault_id,
    "utility",
    expect.stringMatching(/^[0-9a-f-]{36}$/i),
  );
  await user.type(
    screen.getByRole("searchbox", { name: "Ask MeGraph" }),
    " changed",
  );
  expect(client.memoryAnswerCancel).toHaveBeenCalledWith(
    chosen.vault_id,
    expect.stringMatching(/^[0-9a-f-]{36}$/i),
  );
  await act(async () =>
    finish({
      sources: sourceAnswer,
      status: "supported",
      message:
        "Selected exact passages from current notes. These quotations are evidence selections, not a verified synthesized answer.",
      selections: [
        {
          source_id: source.id,
          revision: source.revision,
          source_sha256: source.source_sha256,
          note_sha256: source.source_sha256,
          quote: "Utility late.",
        },
      ],
      answer_provider: providers.extraction,
    }),
  );
  expect(
    screen.queryByText(/Selected exact passages from current notes/),
  ).toBeNull();
});

it("reloads native state after a failed disable and reports remote removal as unconfirmed", async () => {
  const providers = {
    extraction: "provider A",
    embedding: "provider B",
    reranking: "provider C",
  };
  const status = vi.fn(async () => ({
    enabled: true,
    include_existing: true,
    generation: 4,
    provider_disclosure:
      "Notes and questions may be sent to configured providers.",
    providers,
    answer_enabled: false,
    answer_provider: "provider A",
    service: {
      state: "ready",
      pending: 0,
      indexed: 2,
      failed: 0,
      message: "Ready",
      providers,
    },
  }));
  const client = vault({
    knowledgeStatus: status,
    knowledgeConsent: vi.fn(async () => {
      throw new Error(
        "Connected knowledge is locally disabled; remote purge is unconfirmed and will retry when the service reconnects.",
      );
    }),
  });
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  await user.click(
    await screen.findByRole("button", { name: "Disable connected knowledge" }),
  );
  expect(
    await screen.findByText(/Locally disabled; remote purge is unconfirmed/),
  ).toBeTruthy();
  expect(
    await screen.findByText(
      /Connected knowledge is locally disabled; remote purge is unconfirmed/,
    ),
  ).toBeTruthy();
  expect(status.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it("reports accepted asynchronous removal as pending rather than completed", async () => {
  const providers = {
    extraction: "provider A",
    embedding: "provider B",
    reranking: "provider C",
  };
  const ready = {
    enabled: true,
    include_existing: true,
    generation: 4,
    provider_disclosure:
      "Notes and questions may be sent to configured providers.",
    providers,
    answer_enabled: false,
    answer_provider: "provider A",
    service: {
      state: "ready",
      pending: 0,
      indexed: 2,
      failed: 0,
      message: "Ready",
      providers,
    },
  };
  const purging = {
    enabled: false,
    include_existing: false,
    generation: 5,
    provider_disclosure:
      "Notes and questions may be sent to configured providers.",
    providers,
    answer_enabled: false,
    answer_provider: "provider A",
    service: {
      state: "purging",
      pending: 1,
      indexed: 0,
      failed: 0,
      message: "Removal is pending",
      providers,
    },
  };
  const status = vi
    .fn()
    .mockResolvedValueOnce(ready)
    .mockResolvedValue(purging);
  const client = vault({
    knowledgeStatus: status,
    knowledgeConsent: vi.fn(async () => ({
      version: 1,
      vault_id: chosen.vault_identity!,
      enabled: false,
      include_existing: false,
      generation: 5,
      snapshot_sha256: "",
      existing_fence: [],
      dismissed_facts: [],
    })),
  });
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  await user.click(
    await screen.findByRole("button", { name: "Disable connected knowledge" }),
  );
  expect(await screen.findByText(/remote removal was requested/i)).toBeTruthy();
  expect(
    await screen.findByText("Removal is pending", { exact: false }),
  ).toBeTruthy();
  expect(screen.queryByText(/service confirmed the purge/i)).toBeNull();
});

it("does not offer graph consent when configured providers are unavailable", async () => {
  const client = vault({
    knowledgeStatus: vi.fn(async () => ({
      enabled: false,
      include_existing: false,
      generation: 0,
      provider_disclosure: "Review providers before enabling.",
      providers: null,
      answer_enabled: false,
      answer_provider: null,
      service: {
        state: "unavailable",
        pending: 0,
        indexed: 0,
        failed: 0,
        message: "Local graph service is not configured.",
      },
    })),
    knowledgeConsent: vi.fn(),
  });
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  await screen.findByText(/Providers are unavailable or not configured/);
  expect(
    (
      screen.getByRole("button", {
        name: "Enable connected knowledge",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(client.knowledgeConsent).not.toHaveBeenCalled();
});

it("explicitly rebuilds enabled connected knowledge and reports the native result", async () => {
  const providers = {
    extraction: "extractor",
    embedding: "embedder",
    reranking: "ranker",
  };
  const rebuild = vi.fn(async () => ({
    state: "queued",
    pending: 3,
    indexed: 4,
    failed: 0,
    message: "Rebuild queued",
    providers,
  }));
  const client = vault({
    knowledgeStatus: vi.fn(async () => ({
      enabled: true,
      include_existing: false,
      generation: 1,
      provider_disclosure:
        "Notes and questions may be sent to configured providers.",
      providers,
      answer_enabled: false,
      answer_provider: "extractor",
      service: {
        state: "ready",
        pending: 0,
        indexed: 4,
        failed: 0,
        message: "Ready",
        providers,
      },
    })),
    knowledgeConsent: vi.fn(async () => ({
      version: 1,
      vault_id: chosen.vault_identity!,
      enabled: true,
      include_existing: false,
      generation: 1,
      snapshot_sha256: "",
      existing_fence: [],
      dismissed_facts: [],
    })),
    knowledgeRebuild: rebuild,
  });
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  expect(
    await screen.findByRole("button", { name: "Rebuild connected knowledge" }),
  ).toBeTruthy();
  expect(
    screen.getByText(
      /Rebuild reprocesses only notes already allowed by your current consent/,
    ),
  ).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Rebuild connected knowledge" }),
  );
  expect(rebuild).toHaveBeenCalledWith(chosen.vault_id);
  await screen.findAllByText(/Rebuild queued/);
});

it("refreshes a processing graph once it finishes indexing without revisiting the view", async () => {
  const relationship = {
    id: "fact-1",
    source_id: memory().id,
    revision: 1,
    source_sha256: memory().source_sha256,
    note_sha256: memory().source_sha256,
    source_name: "north-lot.png",
    note_path: memory().note_path,
    quote: "North lot is the laydown yard.",
    subject_id: "entity-yard",
    subject: "North lot",
    subject_type: "Location",
    predicate: "WORKS_ON",
    object_id: "entity-project",
    object: "East project",
    object_type: "Project",
    fact: "North lot works on East project",
    valid_at: null,
    invalid_at: null,
    extracted_at: "2026-08-21T15:04:00Z",
    inferred: true,
    uncertainty: "",
    related_source_ids: [memory().id],
    supports: [
      {
        source_id: memory().id,
        revision: 1,
        source_sha256: memory().source_sha256,
        note_sha256: memory().source_sha256,
        quote: "North lot is the laydown yard.",
      },
    ],
  };
  const search = vi
    .fn()
    .mockResolvedValueOnce({
      status: {
        state: "processing",
        pending: 1,
        indexed: 0,
        failed: 0,
        message: "Indexing",
      },
      relationships: [],
    })
    .mockResolvedValue({
      status: {
        state: "ready",
        pending: 0,
        indexed: 1,
        failed: 0,
        message: "Ready",
      },
      relationships: [relationship],
    });
  const user = userEvent.setup();
  render(
    <MemorySurface vault={vault({ knowledgeSearch: search }, [memory()])} />,
  );
  await user.click(await screen.findByRole("button", { name: "Home" }));
  await user.click(screen.getByRole("button", { name: "Memories" }));
  expect(await screen.findByText(/1 pending/)).toBeTruthy();
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2), {
    timeout: 5000,
  });
  expect(
    await screen.findByRole("button", {
      name: /North lot Works on East project/,
    }),
  ).toBeTruthy();
  expect(screen.getByText(/1 indexed/)).toBeTruthy();
});

it("discards a late relationship response after switching vaults", async () => {
  let finish!: (reply: KnowledgeSearchReply) => void;
  const nextVault = {
    ...chosen,
    root: "/other/vault",
    vault_id: "other-session",
    vault_identity: "22222222-2222-4222-8222-222222222222",
  };
  const client = vault(
    {
      openDefault: vi.fn(async () => nextVault),
      knowledgeSearch: vi.fn(
        (_vaultId: string, _query: string) =>
          new Promise<KnowledgeSearchReply>((resolve) => {
            finish = resolve;
          }),
      ),
    },
    [memory()],
  );
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await user.click(await screen.findByRole("button", { name: "Home" }));
  await user.click(screen.getByRole("button", { name: "Memories" }));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: "Use default library" }));
  await waitFor(() => expect(client.openDefault).toHaveBeenCalled());
  await act(async () =>
    finish({
      status: {
        state: "ready",
        pending: 0,
        indexed: 1,
        failed: 0,
        message: "Stale response",
      },
      relationships: [],
    }),
  );
  expect(screen.queryByText("Stale response")).toBeNull();
  expect(screen.queryByText("Checking connected knowledge…")).toBeNull();
});

it("shows native-verified quotations for text captures with the legacy no-attachment hash", async () => {
  const source = memory({
    source_name: "",
    source_sha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    note: "Synthetic utility delivery remains uncertain.",
  });
  const originalHash = "b".repeat(64);
  const providers = {
    extraction: "synthetic-provider",
    embedding: "local",
    reranking: "local",
  };
  const sources: SourceAnswer = {
    question: "utility",
    message: "Source-backed matches.",
    hits: [
      {
        memory_id: source.id,
        revision: source.revision,
        note_basename: "synthetic.md",
        current_excerpt: source.note,
        original_excerpt: source.note,
        source_sha256: originalHash,
        mime_type: "text/plain",
      },
    ],
  };
  const client = vault(
    {
      ask: vi.fn(async () => sources),
      knowledgeStatus: vi.fn(async () => ({
        enabled: true,
        include_existing: false,
        generation: 1,
        provider_disclosure: "Synthetic test only",
        providers,
        answer_enabled: true,
        answer_provider: providers.extraction,
        service: {
          state: "ready",
          pending: 0,
          indexed: 1,
          failed: 0,
          message: "Ready",
          providers,
        },
      })),
      memoryAnswer: vi.fn(async () => ({
        sources,
        status: "supported",
        message: "Synthetic source selection.",
        selections: [
          {
            source_id: source.id,
            revision: source.revision,
            source_sha256: originalHash,
            note_sha256: "c".repeat(64),
            quote: source.note,
          },
        ],
        answer_provider: providers.extraction,
      })),
    },
    [source],
  );
  const user = userEvent.setup();
  render(<MemorySurface vault={client} />);
  await waitFor(() => expect(client.list).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.type(
    screen.getByRole("searchbox", { name: "Ask MeGraph" }),
    "utility",
  );
  await user.click(screen.getByRole("button", { name: "Ask" }));
  await user.click(
    await screen.findByRole("button", { name: "Answer from notes" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Selected source quotations" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", {
      name: "Inspect supporting note and original",
    }),
  ).toBeTruthy();
});


it("shows pending search truthfully and preserves the question after failure", async () => {
  let fail!: (error: Error) => void;
  const ask = vi.fn(() => new Promise<SourceAnswer>((_resolve, reject) => { fail = reject; }));
  const user = userEvent.setup();
  render(<MemorySurface vault={vault({ ask })} />);
  await screen.findByRole("button", {name: "Search"});
  await user.type(screen.getByRole("searchbox"), "utility delay");
  await user.click(screen.getByRole("button", {name: "Ask"}));
  expect(await screen.findByText("Searching…", {exact: true})).toBeTruthy();
  expect(screen.queryByText("Type a question to search the notes.")).toBeNull();
  await act(async () => fail(new Error("Synthetic retrieval unavailable")));
  expect(await screen.findByText("Search could not finish. Your question is still here; try again.")).toBeTruthy();
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("utility delay");
});
