// Tasks: tasks written in your notes, and the GitLab issue each is tracked as. Mirrors `intel tasks`.
import { SquarePen } from "lucide-react";
import { useState } from "react";
import type { TaskView } from "../api/models.ts";
import { useAppModel, useAppState, useTask } from "../state/app_context.tsx";
import { SetQuery, useRoute } from "../state/router.ts";
import { Step, useShortcuts } from "../state/shortcuts.ts";
import { Check, Loadable, MessageBar, SearchField } from "../ui/controls.tsx";
import { MenuButton, useContextMenu, type MenuEntry } from "../ui/menu.tsx";
import { useOpener } from "../ui/open_button.tsx";
import { ScreenHeader } from "../ui/shell.tsx";

function TaskRow({ task, selected, onSelect, entries, onOpen }: {
  task: TaskView; selected: boolean; onSelect: () => void; entries: () => MenuEntry[]; onOpen: () => void;
}) {
  const { onContextMenu, menu } = useContextMenu(entries);
  return (
    <tr aria-selected={selected} onClick={onSelect} onDoubleClick={onOpen} onContextMenu={(event) => { onSelect(); onContextMenu(event); }}
        className={task.state === "open" ? undefined : "dimmed"} data-task={task.id}>
      <td className="task-text selectable">{task.text}</td>
      <td className="task-note"><span className="truncate" title={task.location}>{task.location}</span></td>
      <td className={task.tracked_as ? undefined : "muted"}>{task.tracked_as ?? (task.backlog ? "backlog" : "—")}</td>
      <td className="task-state">{task.state}</td>
      <td className="task-actions"><MenuButton label="Task actions" entries={entries()} />{menu}</td>
    </tr>
  );
}

export function TasksScreen() {
  const model = useAppModel();
  const { refreshToken } = useAppState();
  const { query } = useRoute();
  const includeClosed = query.get("all") === "1";
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<number | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const open = useOpener();

  useTask(async (signal) => {
    setLoading(true);
    const result = await model.Run((client) => client.Tasks({ includeClosed }), signal);
    if (result) setTasks(result);
    if (!signal.aborted) setLoading(false);
  }, [refreshToken, includeClosed]);

  const needle = filter.trim().toLowerCase();
  const visible = needle === "" ? tasks
    : tasks.filter((task) => task.text.toLowerCase().includes(needle) || task.location.toLowerCase().includes(needle));

  const Import = async (task: TaskView): Promise<void> => {
    const result = await model.Run((client) => client.ImportTasks(`R${task.record_id}`));
    if (!result) return;
    setMessage(`Proposed ${result.proposed} issues from ${result.note}`
      + (result.unplaced > 0 ? `; ${result.unplaced} have no known GitLab project` : ""));
    await model.LoadStatus();
  };

  const Entries = (task: TaskView): MenuEntry[] => [
    { label: "Open note", onSelect: () => open(task.note_path), disabled: !task.note_path },
    ...(task.issue_url ? [{ label: "Open issue", onSelect: () => open(task.issue_url) }] : []),
    "divider",
    { label: "Propose GitLab issues for this note's open tasks", onSelect: () => void Import(task) },
  ];

  useShortcuts((event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if ((event.key === "j" || event.key === "k") && !(event.target instanceof HTMLInputElement)) {
      const next = Step(visible.map((task) => task.id), selection, event.key === "j" ? 1 : -1);
      setSelection(next);
      document.querySelector(`[data-task="${next}"]`)?.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (event.key === "Enter" && selection !== null && document.activeElement === document.body) {
      const task = visible.find((candidate) => candidate.id === selection);
      if (task) open(task.issue_url ?? task.note_path);
      return true;
    }
    return false;
  });

  return (
    <div className="screen">
      <ScreenHeader title="Tasks">
        <SearchField value={filter} onChange={setFilter} placeholder="Filter by note or text" />
        <Check checked={includeClosed} onChange={(checked) => SetQuery({ all: checked ? "1" : null })}>Show done &amp; removed</Check>
      </ScreenHeader>
      <div className="screen-body">
        <Loadable isLoading={isLoading} isEmpty={visible.length === 0} emptyTitle="No tasks found in your notes" emptyIcon={<SquarePen />}>
          <table className="table">
            <thead>
              <tr><th>Task</th><th>Note</th><th>Tracked as</th><th>State</th><th><span className="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {visible.map((task) => (
                <TaskRow key={task.id} task={task} selected={task.id === selection} onSelect={() => setSelection(task.id)}
                         entries={() => Entries(task)} onOpen={() => open(task.issue_url ?? task.note_path)} />
              ))}
            </tbody>
          </table>
        </Loadable>
      </div>
      <MessageBar message={message} />
    </div>
  );
}
