import { describe, expect, it, vi } from "vitest";
import { NetworkError, type AskResponse, type Citation } from "@recall/api-client";
import { askWithPolicy, citationTarget } from "./askviewmodel";

const citation: Citation = { citation_id: "c1", capture_id: "cap-1", memory_id: "mem-1", memory_revision: 1, source_id: "src-1", quote: "The key is here.", captured_at: "2026-10-06T00:00:00Z", page: 1, epistemic_state: "reported", kind: "statement" };
const answered: AskResponse = { question: "where?", status: "answered", answer: "Here.", sentences: [{ text: "Here.", citation_ids: ["c1"] }], citations: [citation], sources: [citation], limitations: [], reason: null, index_as_of: null, mode: "online_grounded" };

describe("mobile Ask behavior", () => {
  it("returns grounded answers and preserves citation navigation", async () => {
    const api = { ask: vi.fn(async () => answered) };
    const result = await askWithPolicy(api, " where? ");
    expect(result.response?.citations[0]?.source_id).toBe("src-1");
    expect(citationTarget(citation, [{ serverId: "cap-1", memoryId: "mem-1" }])).toEqual({ serverId: "cap-1", sourceId: "src-1" });
    expect(api.ask).toHaveBeenCalledWith("where?");
  });

  it("keeps unsupported answers as abstentions", async () => {
    const api = { ask: vi.fn(async () => ({ ...answered, status: "insufficient_evidence" as const, answer: null, citations: [], sources: [citation], reason: "not enough evidence" })) };
    const result = await askWithPolicy(api, "who was there?");
    expect(result.response?.status).toBe("insufficient_evidence");
    expect(result.response?.answer).toBeNull();
  });

  it("states that offline failures produce no fresh synthesis", async () => {
    const result = await askWithPolicy({ ask: vi.fn(async () => { throw new NetworkError("offline"); }) }, "what changed?");
    expect(result.error).toMatch(/offline/i);
    expect(result.error).toMatch(/did not generate a fresh answer/i);
  });
});
