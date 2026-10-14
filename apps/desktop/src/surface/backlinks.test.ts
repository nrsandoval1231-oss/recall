import { describe, expect, it } from "vitest";
import { relatedTo, type NoteRef } from "./backlinks";

const notes: NoteRef[] = [
  { id: "lot", title: "north-lot", text: "North lot laydown yard. Gate code 48?" },
  { id: "sketch", title: "sketch", text: "See [[north-lot]] before Friday." },
  { id: "walk", title: "walk", text: "The north-lot walk is still tentative." },
  { id: "pump", title: "pump house", text: "Valve note. No connection." },
];

describe("backlinks", () => {
  it("splits explicit links from title mentions", () => {
    const related = relatedTo("lot", notes);
    expect(related.linked.map((item) => item.id)).toEqual(["sketch"]);
    expect(related.linked[0]?.excerpt).toMatch(/links to this note/i);
    expect(related.mentioned.map((item) => item.id)).toEqual(["walk"]);
    expect(related.mentioned[0]?.excerpt).toMatch(/names this title/i);
    expect(related.linked.concat(related.mentioned).map((item) => item.id)).not.toContain("pump");
  });

  it("treats an outgoing wikilink and a markdown memory link as linked", () => {
    const fromLot = relatedTo("sketch", notes);
    expect(fromLot.linked.map((item) => item.id)).toEqual(["lot"]);
    expect(fromLot.linked[0]?.excerpt).toMatch(/this note links/i);
    const markdown: NoteRef[] = [
      { id: "a", title: "alpha", text: "See [the page](../Memories/b.md)." },
      { id: "b", title: "beta", text: "Just a page." },
    ];
    expect(relatedTo("a", markdown).linked.map((item) => item.id)).toEqual(["b"]);
  });

  it("does not count a source-photo link or a wikilink as a plain mention", () => {
    const photo: NoteRef[] = [
      { id: "a", title: "alpha", text: "[Original photo](../Sources/a.png)" },
      { id: "b", title: "beta", text: "See [[alpha]] only." },
    ];
    expect(relatedTo("a", photo).linked.map((item) => item.id)).toEqual(["b"]);
    expect(relatedTo("a", photo).mentioned).toEqual([]);
  });

  it("returns empty groups when nothing connects", () => {
    expect(relatedTo("pump", notes)).toEqual({ linked: [], mentioned: [] });
    expect(relatedTo("missing", notes)).toEqual({ linked: [], mentioned: [] });
  });
});

it.each(['https://vendor.example/b.md', '//vendor.example/b.md', 'mailto:b.md'])('does not label external URL %s as a local relationship', href => {
  expect(relatedTo('a', [{ id: 'a', title: 'alpha', text: `[manual](${href})` }, { id: 'b', title: 'beta', text: 'Local note' }]).linked).toEqual([]);
});
it('resolves local Markdown headings', () => {
  expect(relatedTo('a', [{ id: 'a', title: 'alpha', text: '[note](../Memories/b.md#details)' }, { id: 'b', title: 'beta', text: 'Local note' }]).linked.map(n => n.id)).toEqual(['b']);
});
