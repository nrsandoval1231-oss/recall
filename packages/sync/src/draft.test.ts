import { describe, expect, it } from "vitest";
import { addPages, movePage, removePage, retakePage, type DraftPage } from "./draft";

const page = (id: string): DraftPage => ({ id, uri: `file:///tmp/${id}.jpg`, originalFilename: null });
const ids = (d: DraftPage[]) => d.map((p) => p.id);

describe("draft pages (1–10, ordered)", () => {
  it("keeps insertion order and never exceeds 10 pages", () => {
    const first = addPages([], Array.from({ length: 8 }, (_, i) => page(`p${i}`)));
    expect(first.rejected).toBe(0);
    const second = addPages(first.draft, Array.from({ length: 5 }, (_, i) => page(`q${i}`)));
    expect(second.draft).toHaveLength(10);
    expect(second.rejected).toBe(3);
    expect(ids(second.draft).slice(8)).toEqual(["q0", "q1"]);
  });

  it("removes a page without disturbing the others", () => {
    expect(ids(removePage([page("a"), page("b"), page("c")], "b"))).toEqual(["a", "c"]);
    expect(ids(removePage([page("a")], "missing"))).toEqual(["a"]);
  });

  it("reorders one step at a time and ignores impossible moves", () => {
    const d = [page("a"), page("b"), page("c")];
    expect(ids(movePage(d, "c", -1))).toEqual(["a", "c", "b"]);
    expect(ids(movePage(d, "a", -1))).toEqual(["a", "b", "c"]);
    expect(ids(movePage(d, "c", 1))).toEqual(["a", "b", "c"]);
    expect(ids(movePage(d, "zzz", 1))).toEqual(["a", "b", "c"]);
  });

  it("retake replaces in place and keeps the position", () => {
    expect(ids(retakePage([page("a"), page("b"), page("c")], "b", page("b2")))).toEqual(["a", "b2", "c"]);
  });
});
