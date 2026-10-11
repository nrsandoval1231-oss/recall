import { describe, expect, it } from "vitest";
import { fixtureDocuments } from "./brooks-fixture";
import { KEYWORD_LABEL, keywordSearch, keywordTerms } from "./keyword";

describe("keyword search", () => {
  const docs = fixtureDocuments();

  it("matches every term and keeps uncertain notebook wording", () => {
    const answer = keywordSearch("What do you know about Brooks Campus?", docs);
    expect(answer.kind).toBe("matches");
    if (answer.kind !== "matches") return;
    expect(answer.hits.some((hit) => hit.title === "Brooks Campus")).toBe(true);
    expect(answer.hits.some((hit) => hit.title === "Meeting Notes")).toBe(true);
    const notes = answer.hits.find((hit) => hit.id === "meeting-notes");
    expect(notes?.excerpt).toMatch(/Potential 300MW \(phased\)|Met w\/ Brad/);
    expect(KEYWORD_LABEL).toMatch(/Not a Claude answer/);
  });

  it("abstains when the words are not in the notes", () => {
    const answer = keywordSearch("xylophone quantum", docs);
    expect(answer).toEqual({
      kind: "abstain",
      message: "Nothing in the notes matches that. This is keyword search on this device, not a Claude answer.",
    });
  });

  it("does not treat an unresolved first name as a fuller identity", () => {
    const answer = keywordSearch("Sarah Mitchell", docs);
    expect(answer.kind).toBe("matches");
    if (answer.kind !== "matches") return;
    expect(answer.hits.map((hit) => hit.excerpt).join(" ")).toMatch(/not a verified fact|Illustration role only/i);
  });

  it("requires every word", () => {
    expect(keywordSearch("Pecos permit", docs).kind).toBe("abstain");
    expect(keywordSearch("   ", docs).kind).toBe("abstain");
  });

  it("drops question words and keeps a citation with the excerpt", () => {
    expect(keywordTerms("What do you know about the gate?")).toEqual(["gate"]);
    const answer = keywordSearch("What do you know about the gate?", [
      {
        id: "lot",
        title: "north-lot",
        text: "North lot laydown yard. Gate code 48?",
        citation: "Aug 21, 2026 · Recall/Memories/lot.md · north-lot.png",
      },
    ]);
    expect(answer.kind).toBe("matches");
    if (answer.kind !== "matches") return;
    expect(answer.hits[0]?.excerpt).toMatch(/Gate code 48\?/);
    expect(answer.hits[0]?.citation).toMatch(/Recall\/Memories\/lot\.md/);
  });
});
