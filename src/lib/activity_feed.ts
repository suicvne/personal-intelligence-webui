// How the Activity screen lays out the feed: events by local day, with runs of similar changes folded
// into one row ("12 new commits in cascade", "25 knowledge changes by the model").
import type { EventView } from "../api/models.ts";
import { Day, ParseTimestamp } from "./formatting.ts";

/** Consecutive events that are the same kind of change in the same place; usually just one. */
export interface ActivityRun {
  id: number;
  events: EventView[];      // newest first
}

export interface ActivityDay {
  day: string;              // "2026-10-22", in local time
  runs: ActivityRun[];
}

/** Runs shorter than this are shown event by event. */
export const FoldsAt = 3;
/** Knowledge changes fold together when the same hand made them this close together. */
export const BurstGapSeconds = 5 * 60;

const SourceChanges: Record<string, string> = {
  "commit.added": "new commits",
  "document.created": "new documents",
  "document.modified": "documents changed",
  "document.deleted": "documents removed",
  "issue.created": "new issues",
  "issue.modified": "issues updated",
  "issue.state_changed": "issue state changes",
  "issue.rescheduled": "issues rescheduled",
};

/** Who made a knowledge change, as words: "by you", "by the model", …; null when unknown. */
export function Origin(origin: string | null | undefined): string | null {
  switch (origin) {
    case "user": return "by you";
    case "llm": return "by the model";
    case "rule": return "by intel's rules";
    case "source": return "from your sources";
    default: return null;
  }
}

export function Newest(run: ActivityRun): EventView {
  return run.events[0]!;
}

export function Oldest(run: ActivityRun): EventView {
  return run.events[run.events.length - 1]!;
}

/** "12 new commits in cascade", "25 knowledge changes by the model". */
export function RunTitle(run: ActivityRun): string {
  const event = Newest(run);
  const count = run.events.length;
  if (event.layer === "source") {
    const what = SourceChanges[event.type] ?? `${event.type} events`;
    return `${count} ${what}` + (event.source ? ` in ${event.source}` : "");
  }
  const origin = Origin(event.origin);
  return `${count} knowledge changes` + (origin ? ` ${origin}` : "");
}

function Continues(previous: EventView, event: EventView): boolean {
  if (previous.layer !== event.layer) return false;
  if (event.layer === "source") return previous.source === event.source && previous.type === event.type;
  if (previous.origin !== event.origin) return false;
  const newer = ParseTimestamp(previous.at);
  const older = ParseTimestamp(event.at);
  if (!newer || !older) return false;
  return (newer.getTime() - older.getTime()) / 1000 <= BurstGapSeconds;
}

/** One day's events as runs: changes in one source, or knowledge changes by the same hand in a burst. */
export function Runs(events: EventView[]): ActivityRun[] {
  const groups: EventView[][] = [];
  for (const event of events) {
    const group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    if (group && previous && Continues(previous, event)) group.push(event);
    else groups.push([event]);
  }
  return groups.flatMap((group) => group.length >= FoldsAt
    ? [{ id: group[0]!.id, events: group }]
    : group.map((event) => ({ id: event.id, events: [event] })));
}

/** The events (newest first, as the API sends them) by local day, similar neighbours folded into runs. */
export function Days(events: EventView[], timeZone?: string): ActivityDay[] {
  const days: ActivityDay[] = [];
  let day = "";
  let dayEvents: EventView[] = [];
  const FinishDay = (): void => {
    if (dayEvents.length > 0) days.push({ day, runs: Runs(dayEvents) });
    dayEvents = [];
  };
  for (const event of events) {
    const eventDay = Day(event.at, timeZone);
    if (eventDay !== day) {
      FinishDay();
      day = eventDay;
    }
    dayEvents.push(event);
  }
  FinishDay();
  return days;
}
