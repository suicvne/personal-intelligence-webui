// Pick another entity: type to narrow the list, click one.
import { useState } from "react";
import type { EntitySummary } from "../api/models.ts";
import { useAppModel, useTask } from "../state/app_context.tsx";

export function EntityChooser({ excluding = [], excludingTypes = [], selection, onSelect, label = "Find by name" }: {
  excluding?: number[];
  excludingTypes?: string[];
  selection: EntitySummary | null;
  onSelect: (entity: EntitySummary) => void;
  label?: string;
}) {
  const model = useAppModel();
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [filter, setFilter] = useState("");
  useTask(async (signal) => {
    const all = (await model.Run((client) => client.Entities(), signal)) ?? [];
    setEntities([...all].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
  }, []);
  const needle = filter.trim().toLowerCase();
  const visible = entities.filter((entity) =>
    !excluding.includes(entity.id) && !excludingTypes.includes(entity.type)
    && (needle === "" || [entity.name, ...entity.other_names].some((name) => name.toLowerCase().includes(needle))));
  return (
    <div className="chooser">
      <input className="field" value={filter} placeholder="Find by name" aria-label={label}
             onChange={(event) => setFilter(event.target.value)}
             onKeyDown={(event) => {
               if (event.key === "Enter") {
                 event.preventDefault();
                 if (visible.length === 1) onSelect(visible[0]!);
               }
             }} />
      <div className="chooser-list" role="listbox" aria-label="Entities">
        {visible.map((entity) => (
          <button key={entity.id} type="button" role="option" aria-selected={selection?.id === entity.id}
                  onClick={() => onSelect(entity)}>
            <span className="truncate">{entity.name}</span>
            <span className="caption">{entity.type}</span>
          </button>
        ))}
        {visible.length === 0 && <p className="caption chooser-empty">{entities.length === 0 ? "Loading…" : "Nothing matches"}</p>}
      </div>
    </div>
  );
}
