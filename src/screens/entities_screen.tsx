// Entities: what intel knows about your projects, repositories, components and more.
// Mirrors `intel entity list|show`, and adding and correcting them (entity_editing.tsx): `intel entity
// add|rename|alias|status|describe|merge` and `intel relationship add|confirm|reject|end`.
import { CircleDashed, Hand, Plus } from "lucide-react";
import { useState } from "react";
import type { EntitySummary } from "../api/models.ts";
import { useAppModel, useAppState, useTask } from "../state/app_context.tsx";
import { Navigate, RoutePath, Select, SetQuery, useRoute } from "../state/router.ts";
import { IsTypingTarget, Step, useShortcuts } from "../state/shortcuts.ts";
import { Check, EmptyState, Loadable, SearchField } from "../ui/controls.tsx";
import { ScreenHeader } from "../ui/shell.tsx";
import { SplitView } from "../ui/split_view.tsx";
import { EntityDetailPane } from "./entity_detail.tsx";
import { AddEntitySheet } from "./entity_editing.tsx";

const Types = ["project", "component", "repository", "decision", "goal", "task", "concept", "person", "location"];

export function EntitiesScreen() {
  const model = useAppModel();
  const { refreshToken } = useAppState();
  const { id: selection, query } = useRoute();
  const typeParameter = query.get("type");
  const type = typeParameter === "all" ? "" : typeParameter ?? "project";        // "": everything
  const showArchived = query.get("archived") === "1";
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [filter, setFilter] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const Load = async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    const result = await model.Run((client) => client.Entities(type || null), signal);
    if (result) setEntities(result);
    if (!signal?.aborted) setLoading(false);
  };
  useTask((signal) => Load(signal), [refreshToken, type]);

  const needle = filter.trim().toLowerCase();
  const visible = entities.filter((entity) =>
    (showArchived || entity.status !== "archived")
    && (needle === "" || [entity.name, ...entity.other_names].some((name) => name.toLowerCase().includes(needle))));

  useShortcuts((event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || IsTypingTarget(event.target)) return false;
    if (event.key !== "j" && event.key !== "k") return false;
    const next = Step(visible.map((entity) => entity.id), selection, event.key === "j" ? 1 : -1);
    if (next !== null) {
      Select(next, { replace: true });
      document.querySelector(`[data-entity="${next}"]`)?.scrollIntoView({ block: "nearest" });
    }
    return true;
  });

  const list = (
    <Loadable isLoading={isLoading} isEmpty={visible.length === 0} emptyTitle="None" emptyIcon={<CircleDashed />}>
      <div className="list" role="listbox" aria-label="Entities">
        {visible.map((entity) => {
          const detail = [entity.status === "active" ? null : entity.status, ...entity.other_names.slice(0, 3)].filter(Boolean).join(" · ");
          return (
            <button key={entity.id} type="button" role="option" className="list-row" aria-selected={entity.id === selection}
                    data-entity={entity.id} onClick={() => Select(entity.id)}>
              <span className="row-main">
                <span className="row-title">{entity.name}</span>
                {detail && <span className="row-detail truncate">{detail}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </Loadable>
  );

  return (
    <div className="screen">
      <ScreenHeader title="Entities">
        <SearchField value={filter} onChange={setFilter} placeholder="Filter by name" />
        <select className="field type-picker" value={type === "" ? "all" : type} aria-label="Type" title="Which kind of entity to list"
                onChange={(event) => SetQuery({ type: event.target.value === "project" ? null : event.target.value })}>
          {Types.map((option) => <option key={option} value={option}>{option}</option>)}
          <hr />
          <option value="all">everything</option>
        </select>
        <Check checked={showArchived} onChange={(checked) => SetQuery({ archived: checked ? "1" : null })}>Show archived</Check>
        <button type="button" className="button small" onClick={() => setAdding(true)}
                title="Add a project, component, repository, concept, person or location"><Plus aria-hidden />Add Entity</button>
      </ScreenHeader>
      <SplitView listLabel="Entities" hasSelection={selection !== null} onBack={() => Select(null)} list={list}
                 detail={selection !== null
                   ? <EntityDetailPane key={selection} id={selection} onChanged={() => Load()} />
                   : <EmptyState icon={<Hand />} title="Select something" />} />
      {adding && (
        <AddEntitySheet type={type} onClose={() => setAdding(false)} onAdded={async (added) => {
          setFilter("");
          const query = new URLSearchParams(window.location.search);
          if (type !== "" && added.entity.type !== type) {
            if (added.entity.type === "project") query.delete("type");
            else query.set("type", added.entity.type);              // reloads the list
          } else {
            await Load();
          }
          Navigate(RoutePath("entities", added.entity.id, query));
        }} />
      )}
    </div>
  );
}
