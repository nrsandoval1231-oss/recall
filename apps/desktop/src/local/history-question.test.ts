import { describe, expect, it } from "vitest";
import { resolveHistoryQuestion, temporalForLocalDay } from "./history-question";

describe("historical Ask question routing", () => {
  const now = new Date("2026-10-09T18:00:00Z");
  it("routes only anchored full dates and preserves current topical questions", () => {
    expect(resolveHistoryQuestion("What did I know on October 1, 2026?", "", now, "America/Chicago")).toMatchObject({ kind: "history", temporal: { mode: "as_of", display_date: "2026-10-01", end_exclusive_utc: "2026-10-02T05:00:00Z" } });
    expect(resolveHistoryQuestion("What changed since 2026-10-01?", "", now, "America/Chicago")).toMatchObject({ kind: "history", temporal: { mode: "compare_to_current" } });
    expect(resolveHistoryQuestion("What happened on October 1, 2026?", "", now, "America/Chicago").kind).toBe("current");
    expect(resolveHistoryQuestion("What is my latest note from 2024?", "", now, "America/Chicago").kind).toBe("current");
  });
  it("clarifies missing, slash, yearless, invalid, competing and timezone-ambiguous dates", () => {
    for (const q of ["What did I know?", "What did I know then?", "What changed after the storm?", "As of 10/01/2026", "What did I know on October 1?", "As of 2026-02-30", "As of 2026-10-01 and October 2, 2026", "As of October 1, 2026 EST", "As of 2026-10-01T12:00Z"]) {
      expect(resolveHistoryQuestion(q, "", now, "America/Chicago").kind, q).toBe("clarify");
    }
  });
  it("retains the original anchor when a follow-up supplies its date", () => {
    expect(resolveHistoryQuestion("What had I recorded by then?", "October 1, 2026", now, "America/Chicago")).toMatchObject({ kind: "history", temporal: { display_date: "2026-10-01" } });
    expect(resolveHistoryQuestion("What did I know on 10/01/2026?", "October 1, 2026", now, "America/Chicago")).toMatchObject({ kind: "history", temporal: { display_date: "2026-10-01" } });
    expect(resolveHistoryQuestion("As of 2026-02-30", "October 1, 2026", now, "America/Chicago")).toMatchObject({ kind: "history", temporal: { display_date: "2026-10-01" } });
    expect(resolveHistoryQuestion("As of yesterday", "", now, "Not/AZone").kind).toBe("clarify");
  });
  it("computes local midnight across 23 and 25 hour DST days", () => {
    const spring = temporalForLocalDay("2026-03-08", "America/Chicago", "as_of");
    const fall = temporalForLocalDay("2026-11-01", "America/Chicago", "as_of");
    expect(Date.parse(spring!.end_exclusive_utc) - Date.parse(spring!.start_utc)).toBe(23 * 3_600_000);
    expect(Date.parse(fall!.end_exclusive_utc) - Date.parse(fall!.start_utc)).toBe(25 * 3_600_000);
    expect(temporalForLocalDay("2026-02-30", "America/Chicago", "as_of")).toBeNull();
    expect(temporalForLocalDay("2026-10-01", "Not/AZone", "as_of")).toBeNull();
  });
});
