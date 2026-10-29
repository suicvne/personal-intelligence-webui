// Goals: what you're aiming for, by priority, with target dates and what each one prioritizes.
// Mirrors `intel goal list|add|state`, plus changing a goal's priority, target date and what it prioritizes.
// The brief reminds you as a target date nears, and says when recent work goes elsewhere than a goal's.
import { CircleCheck, Hand, Plus, Target } from "lucide-react";
import { useState } from "react";
import type { GoalView } from "../api/models.ts";
import { Due, LongDate, RelativeAge } from "../lib/formatting.ts";
import { useAppModel, useAppState, useTask } from "../state/app_context.tsx";
import { Select, SetQuery, useRoute } from "../state/router.ts";
import { IsTypingTarget, Step, useShortcuts } from "../state/shortcuts.ts";
import { DueClass, PriorityBadge, PriorityWordsFor } from "../ui/badges.tsx";
import { Check, EmptyState, Loadable, MessageBar, Spinner } from "../ui/controls.tsx";
import { ObservationCard } from "../ui/observation_card.tsx";
import { ScreenHeader } from "../ui/shell.tsx";
import { SplitView } from "../ui/split_view.tsx";
import { GoalSheet } from "./goal_sheet.tsx";

function IsActive(goal: GoalView): boolean {
  return goal.state === "active";
}

function GoalRow({ goal, selected }: { goal: GoalView; selected: boolean }) {
  const active = IsActive(goal);
  const names = goal.prioritizes.map((target) => target.name).join(", ");
  return (
    <button type="button" role="option" className={`list-row${active ? "" : " dimmed"}`} aria-selected={selected}
            data-goal={goal.id} onClick={() => Select(goal.id)}>
      <PriorityBadge priority={goal.priority} />
      <span className="row-main">
        <span className="clamp-2">{goal.statement}</span>
        <span className="row-detail truncate">
          {!active ? goal.state : goal.target_date ? <span className={DueClass(goal.target_date)}>{Due(goal.target_date)}</span> : null}
          {names && `${active && goal.target_date === null ? "" : " · "}${names}`}
        </span>
      </span>
    </button>
  );
}

function GoalDetailPane({ goal, onChanged }: { goal: GoalView; onChanged: (goal: GoalView, message: string | null) => Promise<void> }) {
  const model = useAppModel();
  const [editing, setEditing] = useState(false);
  const [isWorking, setWorking] = useState(false);
  const active = IsActive(goal);
  const summary = `${PriorityWordsFor(goal.priority)} · ${goal.state}${goal.target_date === null ? " · no target date" : ""}`;

  const SetState = async (state: string): Promise<void> => {
    setWorking(true);
    const updated = await model.Run((client) => client.SetGoalState(goal.id, state));
    setWorking(false);
    if (!updated) return;
    const done = ({ achieved: "Achieved", abandoned: "Abandoned", active: "Reactivated" } as Record<string, string>)[state] ?? state;
    await onChanged(updated, `${done}: ${updated.statement}`);
  };

  return (
    <div className="detail">
      <div className="detail-inner">
        <div className="stack">
          <div className="detail-title"><PriorityBadge priority={goal.priority} /><h2>{goal.statement}</h2></div>
          <p className="muted">{summary}</p>
          {goal.target_date && (
            <p className={active ? DueClass(goal.target_date) : "muted"}>
              Target {LongDate(goal.target_date)}{active ? `: ${Due(goal.target_date)}` : ""}
            </p>
          )}
        </div>
        <div className="row wrap">
          {active ? (
            <>
              <button type="button" className="button primary" disabled={isWorking} onClick={() => void SetState("achieved")}
                      title="Mark it achieved: its reminders end"><CircleCheck aria-hidden />Achieved</button>
              <button type="button" className="button" disabled={isWorking} onClick={() => void SetState("abandoned")}
                      title="You're no longer after it; its reminders end (you can reactivate it)">Abandon</button>
            </>
          ) : (
            <button type="button" className="button" disabled={isWorking} onClick={() => void SetState("active")}>Reactivate</button>
          )}
          <button type="button" className="button" disabled={isWorking} onClick={() => setEditing(true)}
                  title="Change its priority, target date and what it prioritizes">Edit…</button>
          {isWorking && <Spinner />}
        </div>
        <section className="section">
          <h3>Prioritizes</h3>
          {goal.prioritizes.length === 0 ? (
            <p className="muted">Nothing yet. A goal that prioritizes a project lets the brief say when your work goes elsewhere.</p>
          ) : (
            <div className="rows">
              {goal.prioritizes.map((target) => (
                <div key={target.id} className="item">
                  <span className="item-main">{target.name} <span className="caption">{target.type}</span></span>
                  <span className="item-detail">
                    {target.last_activity_at ? `last activity ${RelativeAge(target.last_activity_at)}` : "no recorded activity"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        {goal.observations.map((observation) => (
          <ObservationCard key={observation.id} observation={observation} afterResponse={() => onChanged(goal, null)} />
        ))}
      </div>
      {editing && (
        <GoalSheet goal={goal} onClose={() => setEditing(false)}
                   onSaved={(updated) => onChanged(updated, `Changed "${updated.statement}"`)} />
      )}
    </div>
  );
}

export function GoalsScreen() {
  const model = useAppModel();
  const { refreshToken } = useAppState();
  const { id: selection, query } = useRoute();
  const includeClosed = query.get("all") === "1";
  const [goals, setGoals] = useState<GoalView[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const Load = async (signal?: AbortSignal): Promise<GoalView[] | null> => {
    setLoading(true);
    const result = await model.Run((client) => client.Goals(includeClosed), signal);
    if (!signal?.aborted) setLoading(false);
    if (result) setGoals(result);
    return result;
  };
  useTask((signal) => Load(signal), [refreshToken, includeClosed]);

  const ordered = includeClosed ? [...goals.filter(IsActive), ...goals.filter((goal) => !IsActive(goal))] : goals;
  const selected = goals.find((goal) => goal.id === selection) ?? null;

  useShortcuts((event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || IsTypingTarget(event.target)) return false;
    if (event.key !== "j" && event.key !== "k") return false;
    const next = Step(ordered.map((goal) => goal.id), selection, event.key === "j" ? 1 : -1);
    if (next !== null) {
      Select(next, { replace: true });
      document.querySelector(`[data-goal="${next}"]`)?.scrollIntoView({ block: "nearest" });
    }
    return true;
  });

  const Changed = async (updated: GoalView, done: string | null): Promise<void> => {
    if (done) setMessage(done);
    const result = await Load();
    Select(result?.some((goal) => goal.id === updated.id) ? updated.id : null, { replace: true });
    await model.LoadStatus();        // the brief's reminders may have changed
  };

  const Rows = (list: GoalView[]) => list.map((goal) => <GoalRow key={goal.id} goal={goal} selected={goal.id === selection} />);
  const list = (
    <>
      <Loadable isLoading={isLoading} isEmpty={goals.length === 0} emptyIcon={<Target />}
                emptyTitle={includeClosed ? "No goals yet" : "No active goals"}>
        <div className="list" role="listbox" aria-label="Goals">
          {includeClosed ? (
            <>
              <div className="list-section">Active</div>
              {Rows(goals.filter(IsActive))}
              <div className="list-section">Achieved and abandoned</div>
              {Rows(goals.filter((goal) => !IsActive(goal)))}
            </>
          ) : Rows(goals)}
        </div>
      </Loadable>
      <MessageBar message={message} />
    </>
  );

  return (
    <div className="screen">
      <ScreenHeader title="Goals">
        <Check checked={includeClosed} onChange={(checked) => SetQuery({ all: checked ? "1" : null })}>Show achieved &amp; abandoned</Check>
        <button type="button" className="button small" onClick={() => setAdding(true)}
                title="Add a goal: what it prioritizes, how much, and by when"><Plus aria-hidden />Add Goal</button>
      </ScreenHeader>
      <SplitView listLabel="Goals" hasSelection={selection !== null} onBack={() => Select(null)} list={list}
                 detail={selected
                   ? <GoalDetailPane key={selected.id} goal={selected} onChanged={Changed} />
                   : selection !== null && isLoading ? <div className="loading"><Spinner large /></div>
                   : <EmptyState icon={<Hand />} title="Select a goal"
                                 message="The brief reminds you as a goal's target date nears, and says when your work goes elsewhere." />} />
      {adding && (
        <GoalSheet goal={null} onClose={() => setAdding(false)} onSaved={async (added) => {
          setMessage(`Added "${added.statement}"`);
          await Load();
          Select(added.id, { replace: true });
          await model.LoadStatus();
        }} />
      )}
    </div>
  );
}
