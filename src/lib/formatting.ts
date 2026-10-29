// Small display helpers shared by the screens (the SwiftUI app's Formatting). Each takes an optional
// time zone (an IANA name; none: the browser's) so tests can pin one.

const formatters = new Map<string, Intl.DateTimeFormat>();

function Formatter(timeZone: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone ?? ""}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
    formatters.set(key, formatter);
  }
  return formatter;
}

interface LocalParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function Parts(date: Date, timeZone?: string): LocalParts {
  const parts = Formatter(timeZone, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const Get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return { year: Get("year"), month: Get("month"), day: Get("day"), hour: Get("hour"), minute: Get("minute") };
}

/** An ISO-8601 timestamp with a time of day ("2026-10-18T16:47:45+00:00"); null for a plain date or junk. */
export function ParseTimestamp(timestamp: string | null | undefined): Date | null {
  if (!timestamp || timestamp.length <= 10 || !timestamp.includes("T")) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function Local(timestamp: string | null | undefined, width: number, Format: (parts: LocalParts) => string,
               timeZone?: string): string {
  if (!timestamp) return "";
  const date = ParseTimestamp(timestamp);
  if (!date) return timestamp.slice(0, width);     // a plain date is shown as it is
  return Format(Parts(date, timeZone));
}

/** "2026-10-18": the local calendar day of a timestamp from the API (which is in UTC). */
export function Day(timestamp: string | null | undefined, timeZone?: string): string {
  return Local(timestamp, 10, (p) => `${p.year}-${p.month}-${p.day}`, timeZone);
}

/** "2026-10-18 20:03" in local time. */
export function Minute(timestamp: string | null | undefined, timeZone?: string): string {
  return Local(timestamp, 16, (p) => `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`, timeZone);
}

/** "20:03": the local time of day of a timestamp; "" for a plain date. */
export function Time(timestamp: string | null | undefined, timeZone?: string): string {
  return Local(timestamp, 0, (p) => `${p.hour}:${p.minute}`, timeZone);
}

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto", style: "long" });

const RelativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400], ["month", 30 * 86_400], ["week", 7 * 86_400], ["day", 86_400],
  ["hour", 3_600], ["minute", 60], ["second", 1],
];

/** "3 minutes ago" for a timestamp from the API; "never" when missing. */
export function RelativeAge(timestamp: string | null | undefined, now: Date = new Date()): string {
  const date = ParseTimestamp(timestamp);
  if (!date) return "never";
  const seconds = (date.getTime() - now.getTime()) / 1000;
  for (const [unit, size] of RelativeUnits) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return relative.format(Math.trunc(seconds / size), unit);
    }
  }
  return "now";
}

/** "Last 24 hours": the span a brief covers, from its window start to when it was made. */
export function LastHours(start: string | null | undefined, end: string): string {
  const from = ParseTimestamp(start);
  const to = ParseTimestamp(end);
  if (!from || !to) return "Recent changes";
  const hours = Math.max(1, Math.round((to.getTime() - from.getTime()) / 3_600_000));
  return hours === 1 ? "Last hour" : `Last ${hours} hours`;
}

/** "2026-10-30": the local calendar day of a moment. */
export function CalendarDay(date: Date, timeZone?: string): string {
  const p = Parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Days since 1970 of a "2026-10-30" calendar day; null when it isn't one. */
function DayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.slice(0, 10));
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : Math.round(time / 86_400_000);
}

/** Whole local days from today to a calendar day ("2026-10-30"); negative once it has passed. */
export function DaysUntil(day: string, now: Date = new Date(), timeZone?: string): number | null {
  const target = DayNumber(day);
  const today = DayNumber(CalendarDay(now, timeZone));
  return target === null || today === null ? null : target - today;
}

/** "due today", "due tomorrow", "due in 5 days", "2 days overdue": a target date from today. */
export function Due(day: string, now: Date = new Date(), timeZone?: string): string {
  const days = DaysUntil(day, now, timeZone);
  if (days === null) return `due ${day}`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days >= 2) return `due in ${days} days`;
  if (days === -1) return "a day overdue";
  return `${-days} days overdue`;
}

/** A calendar day ("2026-10-30") as a Date at noon UTC, for formatting it without shifting the day. */
function CalendarDate(day: string): Date | null {
  const number = DayNumber(day);
  return number === null ? null : new Date(number * 86_400_000 + 12 * 3_600_000);
}

/** "Friday, October 30, 2026" for a calendar day; the day as it is when it isn't one. */
export function LongDate(day: string): string {
  const date = CalendarDate(day);
  if (!date) return day;
  return Formatter("UTC", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
}

/** An activity day's heading: "Today", "Yesterday", "Wednesday, October 22", or "October 22, 2025". */
export function DayTitle(day: string, now: Date = new Date(), timeZone?: string): string {
  const days = DaysUntil(day, now, timeZone);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  const date = CalendarDate(day);
  if (!date) return day;
  const sameYear = day.slice(0, 4) === CalendarDay(now, timeZone).slice(0, 4);
  return sameYear
    ? Formatter("UTC", { weekday: "long", month: "long", day: "numeric" }).format(date)
    : Formatter("UTC", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

/** "5 minutes", "1 hour, 30 minutes": a duration in words. */
export function Duration(totalSeconds: number): string {
  const units: [string, number][] = [["day", 86_400], ["hour", 3_600], ["minute", 60], ["second", 1]];
  let left = Math.max(0, Math.round(totalSeconds));
  const parts: string[] = [];
  for (const [name, size] of units) {
    const count = Math.floor(left / size);
    left -= count * size;
    if (count > 0) parts.push(`${count} ${name}${count === 1 ? "" : "s"}`);
  }
  return parts.length === 0 ? "0 seconds" : parts.join(", ");
}

export type Openable = { kind: "file"; path: string } | { kind: "web"; url: string };

/** What a record's `uri` opens: a local file (through the companion) or a web page. Nothing else is opened. */
export function OpenableUri(uri: string | null | undefined): Openable | null {
  if (!uri) return null;
  if (uri.startsWith("/")) return { kind: "file", path: uri };
  try {
    const url = new URL(uri);
    return url.protocol === "http:" || url.protocol === "https:" ? { kind: "web", url: url.href } : null;
  } catch {
    return null;
  }
}

export function Percent(confidence: number): string {
  return confidence.toFixed(2);
}
