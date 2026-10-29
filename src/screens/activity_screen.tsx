// Activity: what changed recently, in your sources and in what intel knows, newest first. Mirrors
// `intel events`, without the bookkeeping events (a repository first seen), as in the brief.
// Runs of similar changes fold into one row ("12 new commits in cascade"); expand it to see them.
import {
  Calendar, ChevronRight, Circle, CircleCheck, CirclePlus, CircleX, Clock3, FilePlus, FileText, Flag, GitCommitHorizontal,
  GitMerge, Link, Pencil, Ticket, Trash2, Undo2, type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import type { EventView } from "../api/models.ts";
import { Days, Newest, Oldest, Origin, RunTitle, type ActivityRun } from "../lib/activity_feed.ts";
import { DayTitle, OpenableUri, Time } from "../lib/formatting.ts";
import { useAppModel, useAppState, useTask } from "../state/app_context.tsx";
import { SetQuery, useRoute } from "../state/router.ts";
import { Loadable, SearchField, Segmented } from "../ui/controls.tsx";
import { useContextMenu } from "../ui/menu.tsx";
import { OpenButton, useOpener } from "../ui/open_button.tsx";
import { ScreenHeader } from "../ui/shell.tsx";

const Layers = [
  { value: "", label: "Everything" },
  { value: "source", label: "Sources" },
  { value: "semantic", label: "Knowledge" },
];

function Symbol(type: string): LucideIcon {
  if (type.endsWith(".renamed")) return Pencil;
  switch (type) {
    case "commit.added": return GitCommitHorizontal;
    case "document.created": return FilePlus;
    case "document.modified": return FileText;
    case "document.deleted": return Trash2;
    case "issue.created": case "issue.modified": return Ticket;
    case "issue.state_changed": return CircleCheck;
    case "issue.rescheduled": return Calendar;
    case "entity.created": return CirclePlus;
    case "entity.merged": return GitMerge;
    case "entity.status_changed": return Flag;
    case "relationship.added": return Link;
    case "relationship.rejected": return CircleX;
    case "decision.superseded": return Undo2;
    default: return Circle;
  }
}

/** "14:02 · cascade" or "14:02 · project Crawler · by the model". */
function Detail(event: EventView): string {
  const place = event.layer === "source"
    ? event.source
    : event.entity && !event.summary.includes(event.entity)      // only when the summary doesn't already name it
      ? (event.entity_type ? `${event.entity_type} ${event.entity}` : event.entity)
      : null;
  return [Time(event.at), place, Origin(event.origin)].filter((part) => part).join(" · ");
}

function EventRow({ event }: { event: EventView }) {
  const model = useAppModel();
  const open = useOpener();
  const Icon = Symbol(event.type);
  const { onContextMenu, menu } = useContextMenu(() => [
    ...(OpenableUri(event.uri) ? [{ label: "Open", onSelect: () => open(event.uri) }] : []),
    {
      label: "Copy",
      onSelect: () => void navigator.clipboard?.writeText(event.summary).then(() => model.Notice("Copied")),
    },
  ]);
  return (
    <li className="event-row" onContextMenu={onContextMenu}>
      <Icon className="event-icon" aria-hidden />
      <div className="row-main">
        <span className="clamp-2 selectable">{event.summary}</span>
        <span className="caption truncate">{Detail(event)}</span>
      </div>
      <OpenButton uri={event.uri} />
      {menu}
    </li>
  );
}

/** "22:40–23:18", or one time when they all happened in the same minute. */
function Span(run: ActivityRun): string {
  const newest = Time(Newest(run).at);
  const oldest = Time(Oldest(run).at);
  return newest === oldest ? newest : `${oldest}–${newest}`;
}

function RunRow({ run }: { run: ActivityRun }) {
  const Icon = Symbol(Newest(run).type);
  return (
    <li>
      <details className="run">
        <summary className="event-row">
          <ChevronRight className="disclosure-chevron" aria-hidden />
          <Icon className="event-icon" aria-hidden />
          <div className="row-main">
            <span>{RunTitle(run)}</span>
            <span className="caption">{Span(run)}</span>
          </div>
        </summary>
        <ul className="run-events">
          {run.events.map((event) => <EventRow key={event.id} event={event} />)}
        </ul>
      </details>
    </li>
  );
}

export function ActivityScreen() {
  const model = useAppModel();
  const { refreshToken } = useAppState();
  const { query } = useRoute();
  const layer = query.get("layer") ?? "";
  const [events, setEvents] = useState<EventView[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [isLoading, setLoading] = useState(false);
  /** Counts loads of the first page, so a page of earlier activity that arrives after one is dropped. */
  const generation = useRef(0);

  useTask(async (signal) => {
    generation.current += 1;
    setLoading(true);
    const page = await model.Run((client) => client.Events({ layer: layer || null }), signal);
    if (page) {
      setEvents(page.events);
      setNextBefore(page.next_before);
    }
    if (!signal.aborted) setLoading(false);
  }, [refreshToken, layer]);

  const LoadMore = async (): Promise<void> => {
    if (nextBefore === null || isLoading) return;
    const started = generation.current;
    setLoading(true);
    const page = await model.Run((client) => client.Events({ before: nextBefore, layer: layer || null }));
    setLoading(false);
    if (!page || started !== generation.current) return;      // reloaded meanwhile (refresh, or another layer)
    setEvents((current) => {
      const known = new Set(current.map((event) => event.id));
      return [...current, ...page.events.filter((event) => !known.has(event.id))];
    });
    setNextBefore(page.next_before);
  };

  // Only what is loaded is searched; "Show earlier activity" loads more.
  const needle = filter.trim().toLowerCase();
  const visible = needle === "" ? events : events.filter((event) =>
    [event.summary, event.source, event.entity].some((value) => value?.toLowerCase().includes(needle)));

  return (
    <div className="screen">
      <ScreenHeader title="Activity">
        <SearchField value={filter} onChange={setFilter} placeholder="Filter by text, source or entity" />
        <span title="Changes in your sources (commits, notes, issues), in what intel knows, or both">
          <Segmented label="Show" value={layer} options={Layers} onChange={(value) => SetQuery({ layer: value || null })} />
        </span>
      </ScreenHeader>
      <div className="screen-body">
        <Loadable isLoading={isLoading} isEmpty={visible.length === 0} emptyIcon={<Clock3 />}
                  emptyTitle={needle === "" ? "No recorded activity" : "Nothing loaded matches"}>
          <div className="feed">
            {Days(visible).map((day) => (
              <section key={day.day} className="feed-day" aria-label={DayTitle(day.day)}>
                <h2 className="feed-day-title">{DayTitle(day.day)}</h2>
                <ul className="feed-list">
                  {day.runs.map((run) => run.events.length === 1
                    ? <EventRow key={run.id} event={run.events[0]!} />
                    : <RunRow key={run.id} run={run} />)}
                </ul>
              </section>
            ))}
            {nextBefore !== null && (
              <div className="feed-more">
                <button type="button" className="button" disabled={isLoading} onClick={() => void LoadMore()}>
                  {isLoading ? "Loading…" : "Show earlier activity"}
                </button>
              </div>
            )}
          </div>
        </Loadable>
      </div>
    </div>
  );
}
