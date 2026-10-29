// Ported from the SwiftUI app's FormatsTimestampsAndLinks, plus the web-only helpers.
import { expect, test } from "vitest";
import {
  CalendarDay, Day, DaysUntil, DayTitle, Due, Duration, LastHours, LongDate, Minute, OpenableUri, RelativeAge, Time,
} from "../src/lib/formatting.ts";

const newYork = "America/New_York";

test("formats timestamps and links", () => {
  expect(Day("2026-10-18T16:47:45+00:00", newYork)).toBe("2026-10-18");
  expect(Day("2026-10-23T00:03:00+00:00", newYork)).toBe("2026-10-22");
  expect(Minute("2026-10-23T00:03:00+00:00", newYork)).toBe("2026-10-22 20:03");
  expect(Time("2026-10-23T00:03:00+00:00", newYork)).toBe("20:03");
  expect(Day("2026-10-23", newYork)).toBe("2026-10-23");
  expect(Time("2026-10-23", newYork)).toBe("");
  expect(LastHours("2026-10-24T11:40:00+00:00", "2026-10-25T11:40:00+00:00")).toBe("Last 24 hours");
  expect(LastHours("2026-10-25T10:40:00+00:00", "2026-10-25T11:40:00+00:00")).toBe("Last hour");
  expect(LastHours(null, "2026-10-25T11:40:00+00:00")).toBe("Recent changes");
  const evening = new Date("2026-10-26T03:30:00Z");     // Sunday 23:30 in New York
  expect(DaysUntil("2026-10-26", evening, newYork)).toBe(1);
  expect(Due("2026-10-25", evening, newYork)).toBe("due today");
  expect(Due("2026-10-26", evening, newYork)).toBe("due tomorrow");
  expect(Due("2026-11-01", evening, newYork)).toBe("due in 7 days");
  expect(Due("2026-10-24", evening, newYork)).toBe("a day overdue");
  expect(Due("2026-10-20", evening, newYork)).toBe("5 days overdue");
  expect(Due("someday", evening, newYork)).toBe("due someday");
  expect(CalendarDay(evening, newYork)).toBe("2026-10-25");
  expect(CalendarDay(evening, "UTC")).toBe("2026-10-26");
  expect(RelativeAge(null)).toBe("never");
  expect(OpenableUri("/tmp/note.md")).toEqual({ kind: "file", path: "/tmp/note.md" });
  expect(OpenableUri("http://git.example.com/x/-/issues/3")).toEqual({ kind: "web", url: "http://git.example.com/x/-/issues/3" });
  expect(OpenableUri("javascript:alert(1)")).toBeNull();
});

test("words for ages, days and durations", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  expect(RelativeAge("2026-10-27T11:57:00+00:00", now)).toBe("3 minutes ago");
  expect(RelativeAge("2026-10-27T10:00:00+00:00", now)).toBe("2 hours ago");
  expect(RelativeAge("2026-10-26T11:00:00+00:00", now)).toBe("yesterday");
  expect(DayTitle("2026-10-27", now, "UTC")).toBe("Today");
  expect(DayTitle("2026-10-26", now, "UTC")).toBe("Yesterday");
  expect(DayTitle("2026-10-22", now, "UTC")).toBe("Thursday, October 22");
  expect(DayTitle("2025-10-22", now, "UTC")).toBe("October 22, 2025");
  expect(LongDate("2026-10-30")).toBe("Friday, October 30, 2026");
  expect(Duration(300)).toBe("5 minutes");
  expect(Duration(5400)).toBe("1 hour, 30 minutes");
});
