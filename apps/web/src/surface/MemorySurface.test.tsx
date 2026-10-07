// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemorySurface, type SurfaceApi } from "./MemorySurface";
import type {
  AskResponse,
  MemoryDetail,
  EntityDetail,
} from "@recall/api-client";

const person = {
  entity_id: "person",
  name: "Mara Chen",
  kind: "person" as const,
  version: 1,
  created_at: "2026-07-01Z",
  updated_at: "2026-09-01Z",
};
const memory: MemoryDetail = {
  memory_id: "memory",
  capture_id: "capture",
  revision: 2,
  status: "ready",
  summary: "Startup expected in January 2027.",
  context_hint: "Campus visit",
  captured_at: "2026-07-01T10:00:00Z",
  page_count: 1,
  model_id: "synthetic",
  created_at: "2026-07-01T10:00:00Z",
  revised_at: "2026-09-01T10:00:00Z",
  timezone: "UTC",
  processor_version: "1",
  interpretation: {
    summary: "Startup expected in January 2027.",
    summary_evidence: [{ page_id: "source", quote: "January 2027" }],
    pages: [
      {
        page_id: "source",
        ordinal: 1,
        transcription: "January 2027",
        legibility: "clear",
      },
    ],
    mentions: [],
    statements: [],
    action_suggestions: [],
    uncertainties: [],
  },
  validation_notes: [],
  labels: {
    transcription: "Machine reading",
    action_suggestions: "Suggestions",
  },
  entities: [person],
  claims: [
    {
      claim_id: "claim",
      memory_id: "memory",
      text: "Startup expected in January 2027.",
      kind: "claim",
      epistemic_state: "reported",
      temporal_text: null,
      version: 1,
      evidence: [{ page_id: "source", quote: "January 2027" }],
    },
  ],
};
const citation = {
  citation_id: "c1",
  memory_id: "memory",
  memory_revision: 2,
  capture_id: "capture",
  source_id: "source",
  page: 1,
  quote: "January 2027",
  captured_at: memory.captured_at,
  epistemic_state: "reported" as const,
  kind: "statement" as const,
};
const answer: AskResponse = {
  question: "Campus?",
  status: "answered",
  answer: "Campus startup is expected in January 2027.",
  sentences: [
    {
      text: "Campus startup is expected in January 2027.",
      citation_ids: ["c1"],
    },
  ],
  citations: [citation],
  sources: [citation],
  limitations: [],
  reason: null,
  index_as_of: null,
  mode: "online_grounded",
};
function api(overrides: Partial<SurfaceApi> = {}): SurfaceApi {
  return {
    ask: vi.fn(async () => answer),
    getMemory: vi.fn(async () => memory),
    getEntity: vi.fn(
      async () =>
        ({ ...person, memories: [memory], timeline: [] }) as EntityDetail,
    ),
    fetchSource: vi.fn(async () => ({
      bytes: new TextEncoder().encode("abc").buffer,
      serverSha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      mediaType: "image/png",
    })),
    correctMemory: vi.fn(async () => ({
      ...memory,
      revision: 3,
      interpretation: { ...memory.interpretation, summary: "March 2027" },
    })),
    ...overrides,
  };
}
async function ask(question = "Campus?") {
  fireEvent.change(screen.getByLabelText("What do you need to remember?"), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask Recall" }));
  await screen.findByText(answer.answer!);
}
async function focusMemory() {
  await ask();
  fireEvent.click(screen.getByRole("button", { name: /Focus memory/ }));
  await screen.findByText("Campus visit");
}
beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  URL.createObjectURL = vi.fn(() => "blob:verified");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps home sparse and reconstructs Ask around grounded support", async () => {
  render(<MemorySurface api={api()} captures={[]} />);
  expect(
    screen.getByRole("heading", { name: /What do you need/ }),
  ).toBeTruthy();
  expect(screen.queryByText("Campus visit")).toBeNull();
  await ask();
  expect(
    screen.getByRole("region", { name: "Supporting memories" }),
  ).toBeTruthy();
});
it("focuses a memory and a person, then restores prior compositions", async () => {
  render(<MemorySurface api={api()} captures={[]} />);
  await focusMemory();
  fireEvent.click(screen.getByRole("button", { name: "Focus Mara Chen" }));
  await screen.findByRole("heading", { name: "Mara Chen" });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByText("Campus visit");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByText(answer.answer!);
});
it("rejects stale Ask after navigating home", async () => {
  let release!: (value: AskResponse) => void;
  render(
    <MemorySurface
      api={api({
        ask: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      })}
      captures={[]}
    />,
  );
  fireEvent.change(screen.getByLabelText("What do you need to remember?"), {
    target: { value: "Campus?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask Recall" }));
  fireEvent.click(screen.getByRole("button", { name: "Recall home" }));
  await act(async () => release(answer));
  expect(screen.queryByText(answer.answer!)).toBeNull();
});
it("downloads evidence only on inspection and rejects corrupt bytes", async () => {
  const client = api({
    fetchSource: vi.fn(async () => ({
      bytes: new TextEncoder().encode("corrupt").buffer,
      mediaType: "image/png",
      serverSha256: "wrong",
    })),
  });
  render(<MemorySurface api={client} captures={[]} />);
  await focusMemory();
  expect(client.fetchSource).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect original · page 1" }),
  );
  expect(
    await screen.findByText("Original failed integrity verification."),
  ).toBeTruthy();
  expect(screen.queryByAltText("Original evidence · page 1")).toBeNull();
});
it("raises verified evidence and restores the interpretation on Back", async () => {
  render(<MemorySurface api={api()} captures={[]} />);
  await focusMemory();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect original · page 1" }),
  );
  expect(await screen.findByAltText("Original evidence · page 1")).toBeTruthy();
  expect(screen.getByText("Verified original")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByText("Campus visit")).toBeTruthy();
});
it("uses as_of without loading current memory or identity into historical focus", async () => {
  const client = api();
  render(<MemorySurface api={client} captures={[]} />);
  await ask();
  fireEvent.change(screen.getByLabelText("What I knew by"), {
    target: { value: "2026-07-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Recall then" }));
  await waitFor(() =>
    expect(client.ask).toHaveBeenLastCalledWith("Campus?", {
      as_of: "2026-07-01T23:59:59.999Z",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Focus memory/ }));
  await screen.findByText("Historical evidence");
  expect(client.getMemory).not.toHaveBeenCalled();
  expect(client.getEntity).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Correct/ })).toBeNull();
});
it("previews human statement correction and writes with revision precondition", async () => {
  const client = api();
  render(<MemorySurface api={client} captures={[]} />);
  await focusMemory();
  fireEvent.click(screen.getByRole("button", { name: "Correct statement" }));
  fireEvent.change(screen.getByLabelText("What should Recall understand?"), {
    target: { value: "Startup moved to March 2027." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review affected scope" }),
  );
  expect(screen.getByText(/Original evidence stays unchanged/)).toBeTruthy();
  expect(client.correctMemory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  await waitFor(() =>
    expect(client.correctMemory).toHaveBeenCalledWith(
      "memory",
      expect.objectContaining({
        target: "claim",
        claim_id: "claim",
        text: "Startup moved to March 2027.",
      }),
      expect.any(String),
      2,
    ),
  );
  expect(await screen.findByText(/Correction saved/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.queryByText(answer.answer!)).toBeNull();
  expect(screen.getByText(/Understanding changed/)).toBeTruthy();
});
it("honors reduced motion as an explicit surface state", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const { container } = render(<MemorySurface api={api()} captures={[]} />);
  expect(container.querySelector('[data-reduced-motion="true"]')).toBeTruthy();
});
it("retains the verified artifact underneath understanding after evidence Back", async () => {
  render(<MemorySurface api={api()} captures={[]} />);
  await focusMemory();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect original · page 1" }),
  );
  await screen.findByText("Verified original");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(
    await screen.findByAltText("Verified source beneath understanding"),
  ).toBeTruthy();
});
it("natural historical Ask never refocuses through today's memory", async () => {
  const client = api({
    ask: vi.fn(async () => ({ ...answer, temporal_mode: "original" as const })),
  });
  render(<MemorySurface api={client} captures={[]} />);
  await ask();
  expect(screen.getByText("Historical understanding")).toBeTruthy();
  expect(screen.queryByText("Now", { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Focus memory/ }));
  expect(await screen.findByText("Historical evidence")).toBeTruthy();
  expect(client.getMemory).not.toHaveBeenCalled();
});
it("restores expanded supporting context on Back", async () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    ...citation,
    citation_id: `c${i}`,
    source_id: `source-${i}`,
    quote: `Memory ${i}`,
  }));
  render(
    <MemorySurface
      api={api({
        ask: vi.fn(async () => ({ ...answer, citations: many, sources: many })),
      })}
      captures={[]}
    />,
  );
  await ask();
  fireEvent.click(
    screen.getByRole("button", { name: "Explore more supporting memories" }),
  );
  screen.getByRole("button", { name: /Focus memory · Memory 5/ }).focus();
  fireEvent.click(
    screen.getByRole("button", { name: /Focus memory · Memory 5/ }),
  );
  await screen.findByText("Campus visit");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("button", { name: /Focus memory · Memory 5/ }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /Focus memory · Memory 5/ }),
  );
});
it("does not restore denied evidence or prior private understanding", async () => {
  const { ApiError } = await import("@recall/api-client");
  const denied = vi.fn();
  const client = api({
    fetchSource: vi.fn(async () => {
      throw new ApiError(
        "FORBIDDEN",
        "Source access denied.",
        403,
        false,
        null,
      );
    }),
  });
  render(<MemorySurface api={client} captures={[]} onAccessDenied={denied} />);
  await focusMemory();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect original · page 1" }),
  );
  await waitFor(() => expect(denied).toHaveBeenCalled());
  expect(screen.queryByText("Campus visit")).toBeNull();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
});
it("ignores an evidence response after Back and releases verified URLs on session exit", async () => {
  let release!: (value: Awaited<ReturnType<SurfaceApi["fetchSource"]>>) => void;
  const client = api({
    fetchSource: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const { unmount } = render(<MemorySurface api={client} captures={[]} />);
  await focusMemory();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect original · page 1" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await act(async () =>
    release({
      bytes: new TextEncoder().encode("abc").buffer,
      mediaType: "image/png",
      serverSha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    }),
  );
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  unmount();
});
it("shows a correction conflict without replacing newer knowledge", async () => {
  const { ApiError } = await import("@recall/api-client");
  render(
    <MemorySurface
      api={api({
        correctMemory: async () => {
          throw new ApiError("VERSION_CONFLICT", "Changed", 409, false, null);
        },
      })}
      captures={[]}
    />,
  );
  await focusMemory();
  fireEvent.click(screen.getByRole("button", { name: "Correct statement" }));
  fireEvent.change(screen.getByLabelText("What should Recall understand?"), {
    target: { value: "March 2027" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review affected scope" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  expect(await screen.findByText(/This memory changed while/)).toBeTruthy();
  expect(screen.queryByText(/Correction saved/)).toBeNull();
});

it("summary remains correctable alongside statements and correction restores keyboard focus", async () => {
  render(<MemorySurface api={api()} captures={[]} />);
  await focusMemory();
  const opening = screen.getByRole("button", { name: "Correct understanding" });
  opening.focus();
  fireEvent.click(opening);
  const input = screen.getByLabelText("What should Recall understand?");
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, {
    target: { value: "The updated project summary." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review affected scope" }),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Confirm correction" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Correct understanding" }),
  );
});
