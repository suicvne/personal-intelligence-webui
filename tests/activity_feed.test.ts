// How the Activity screen groups the feed: by local day, with runs of similar changes folded
// (ported from the SwiftUI app's activity_feed_tests.swift).
import { describe, expect, test } from "vitest";
import type { EventView } from "../src/api/models.ts";
import { Days, Newest, Oldest, Origin, RunTitle } from "../src/lib/activity_feed.ts";

const utc = "UTC";

function Commit(id: number, at: string, source = "cascade"): EventView {
  return { id, layer: "source", type: "commit.added", summary: `New commit: ${id}`, at, source, record_id: id, uri: null,
           entity_id: null, entity: null, entity_type: null, origin: null };
}

function Change(id: number, at: string, origin = "llm"): EventView {
  return { id, layer: "semantic", type: id % 2 === 0 ? "entity.created" : "relationship.added", summary: `Change ${id}`,
           at, source: null, record_id: null, uri: null, entity_id: 1, entity: "Cascade", entity_type: "project", origin };
}

describe("ActivityFeed", () => {
  test("groups by local day, newest first", () => {
    const days = Days([Commit(3, "2026-10-23T01:00:00+00:00"), Commit(2, "2026-10-22T23:00:00+00:00", "intel"),
                       Commit(1, "2026-10-21T10:00:00+00:00")], utc);
    expect(days.map((day) => day.day)).toEqual(["2026-10-23", "2026-10-22", "2026-10-21"]);
    // 01:00 UTC on the 23rd is still the 22nd in New York
    expect(Days([Commit(3, "2026-10-23T01:00:00+00:00"), Commit(2, "2026-10-22T23:00:00+00:00")],
                "America/New_York").map((day) => day.day)).toEqual(["2026-10-22"]);
  });

  test("folds runs of commits in one source", () => {
    const events = [Commit(6, "2026-10-22T23:00:00+00:00"), Commit(5, "2026-10-22T21:00:00+00:00"),
                    Commit(4, "2026-10-22T12:00:00+00:00"), Commit(3, "2026-10-22T11:00:00+00:00", "intel"),
                    Commit(2, "2026-10-22T10:00:00+00:00", "intel")];
    const runs = Days(events, utc)[0]!.runs;
    expect(runs.map((run) => run.events.length)).toEqual([3, 1, 1]);   // two in a row is too few to fold
    expect(RunTitle(runs[0]!)).toBe("3 new commits in cascade");
    expect(Newest(runs[0]!).id).toBe(6);
    expect(Oldest(runs[0]!).id).toBe(4);
  });

  test("folds bursts of knowledge changes by the same hand", () => {
    const events = [Change(9, "2026-10-22T23:08:30+00:00"), Change(8, "2026-10-22T23:08:00+00:00"),
                    Change(7, "2026-10-22T23:05:00+00:00"), Change(6, "2026-10-22T23:01:00+00:00"),
                    Change(5, "2026-10-22T22:00:00+00:00"),                 // an hour earlier: not the same burst
                    Change(4, "2026-10-22T21:59:00+00:00", "user")];
    const runs = Days(events, utc)[0]!.runs;
    expect(runs.map((run) => run.events.length)).toEqual([4, 1, 1]);
    expect(RunTitle(runs[0]!)).toBe("4 knowledge changes by the model");
    expect(Origin("user")).toBe("by you");
    expect(Origin(null)).toBeNull();
  });

  test("never folds across layers or days", () => {
    const events = [Commit(5, "2026-10-22T00:30:00+00:00"), Commit(4, "2026-10-22T00:20:00+00:00"),
                    Commit(3, "2026-10-21T23:50:00+00:00"), Change(2, "2026-10-21T23:49:00+00:00"),
                    Commit(1, "2026-10-21T23:48:00+00:00")];
    expect(Days(events, utc).map((day) => day.runs.map((run) => run.events.length))).toEqual([[1, 1], [1, 1, 1]]);
  });
});
