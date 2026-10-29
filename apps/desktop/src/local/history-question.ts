import type { AskTemporal } from "../platform/local-vault";

export type HistoryQuestion =
  | { kind: "current" }
  | { kind: "clarify"; reason: string }
  | { kind: "history"; temporal: AskTemporal };

const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const isoDate = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const monthDate = new RegExp(`\\b(${monthNames.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b`, "i");
const timezoneAbbreviation = /\b(?:UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|CET|CEST|BST)\b/i;
const timeQualifier = /\b(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|T\d{2}:\d{2}(?::\d{2})?Z?)\b|\bZ\b/i;

function localDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (name: string) => parts.find(part => part.type === name)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}
function validDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}
function dateText(parts: { year: number; month: number; day: number }) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
function parseDate(text: string, now: Date, timezone: string): { date: string | null; invalid: boolean } {
  const iso = text.match(isoDate);
  const month = text.match(monthDate);
  let year: number, monthNumber: number, day: number;
  if (iso) { year = Number(iso[1]); monthNumber = Number(iso[2]); day = Number(iso[3]); }
  else if (month) { year = Number(month[3]); monthNumber = monthNames.indexOf(month[1]!.toLowerCase()) + 1; day = Number(month[2]); }
  else if (/\btoday\b|\byesterday\b/i.test(text)) {
    try {
      const nowParts = localDateParts(now, timezone);
      const local = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day) - (/\byesterday\b/i.test(text) ? 86_400_000 : 0));
      return { date: dateText({ year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() }), invalid: false };
    } catch { return { date: null, invalid: false }; }
  } else return { date: null, invalid: false };
  return validDate(year, monthNumber, day) ? { date: dateText({ year, month: monthNumber, day }), invalid: false } : { date: null, invalid: true };
}

function localMidnightUtc(date: string, timezone: string): number | null {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
      const get = (name: string) => Number(parts.find(part => part.type === name)?.value);
      const rendered = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
      const next = guess + target - rendered;
      if (next === guess) break;
      guess = next;
    }
    const check = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const values = Object.fromEntries(check.map(part => [part.type, part.value]));
    if (`${values.year}-${values.month}-${values.day}` !== date || values.hour !== "00" || values.minute !== "00" || values.second !== "00") return null;
    return guess;
  } catch { return null; }
}

export function temporalForLocalDay(date: string, timezone: string, mode: AskTemporal["mode"]): AskTemporal | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (!validDate(year!, month!, day!)) return null;
  const start = localMidnightUtc(date, timezone);
  const nextDay = new Date(Date.UTC(year!, month! - 1, day! + 1));
  const end = localMidnightUtc(dateText({ year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() }), timezone);
  if (start === null || end === null || end <= start || end - start < 23 * 3_600_000 || end - start > 25 * 3_600_000) return null;
  return { mode, start_utc: new Date(start).toISOString().replace(".000Z", "Z"), end_exclusive_utc: new Date(end).toISOString().replace(".000Z", "Z"), display_date: date, display_timezone: timezone };
}

const historyAnchor = /\b(as of|what did i know on|what had i recorded by|what changed since)\b/i;
const incompleteHistoricalIntent = /\b(as of|what did i know|what had i recorded|what changed since)\b/i;
const unanchoredHistory = /\b(then|before|after|during|when|since|at that time|around that time|back then|used to|previously)\b/i;
const latest = /\b(latest|now|current|currently|today's current)\b/i;

export function resolveHistoryQuestion(original: string, followup = "", now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): HistoryQuestion {
  const combined = followup.trim() ? `${original} ${followup.trim()}` : original;
  if (latest.test(original) && !historyAnchor.test(original)) return { kind: "current" };
  const anchor = combined.match(historyAnchor);
  const followupOnlyHistory = !anchor && Boolean(followup.trim()) && (unanchoredHistory.test(original) || incompleteHistoricalIntent.test(original));
  if (!anchor && !followupOnlyHistory) return unanchoredHistory.test(original) || incompleteHistoricalIntent.test(original) ? { kind: "clarify", reason: "Which full calendar date should Monolith use?" } : { kind: "current" };
  const tail = followup.trim() ? followup.trim() : combined.slice((anchor!.index ?? 0) + anchor![0].length);
  const parsed = parseDate(tail, now, timezone);
  const dateScope = followup.trim() ? tail : combined;
  const dateHits = [...dateScope.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}\b|\btoday\b|\byesterday\b/gi)];
  const slash = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(tail);
  if (timezoneAbbreviation.test(tail) || timeQualifier.test(tail) || slash || dateHits.length > 1 || parsed.invalid) return { kind: "clarify", reason: "Please give one valid full date in your local timezone." };
  if (!parsed.date) return { kind: "clarify", reason: "Which full calendar date should Monolith use? You can type it here in ordinary language." };
  const timezoneValue = timezone.trim();
  if (!timezoneValue || /\s/.test(timezoneValue)) return { kind: "clarify", reason: "Monolith could not confirm this device’s timezone. Please check it before asking about a date." };
  try { new Intl.DateTimeFormat("en", { timeZone: timezoneValue }).format(now); }
  catch { return { kind: "clarify", reason: "Monolith could not confirm this device’s timezone. Please check it before asking about a date." }; }
  const temporal = temporalForLocalDay(parsed.date, timezoneValue, !followupOnlyHistory && /what changed since/i.test(anchor![0]) ? "compare_to_current" : "as_of");
  return temporal ? { kind: "history", temporal } : { kind: "clarify", reason: "Monolith could not resolve that local calendar day. Please clarify the date or timezone." };
}
