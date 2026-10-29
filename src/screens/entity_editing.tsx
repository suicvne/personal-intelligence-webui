// Adding and correcting entities: like `intel entity add|rename|alias|status|describe|merge` and
// `intel relationship add`. Each sheet sends one correction; intel remembers it over anything it inferred.
import { useState } from "react";
import type { EntityDetail, EntitySummary, PredicateView } from "../api/models.ts";
import { SplitList, Trimmed } from "../lib/text.ts";
import { useAppModel, useTask } from "../state/app_context.tsx";
import { Segmented, Switch } from "../ui/controls.tsx";
import { EditForm, FormRow } from "../ui/edit_form.tsx";
import { EntityChooser } from "../ui/entity_chooser.tsx";

/** The types an entity can be added as here (decisions, goals and tasks come from their own commands and notes). */
export const AddableEntityTypes = ["project", "component", "repository", "concept", "person", "location"];

export function AddEntitySheet({ type: initialType, onClose, onAdded }: {
  type: string; onClose: () => void; onAdded: (entity: EntityDetail) => Promise<void>;
}) {
  const model = useAppModel();
  const [type, setType] = useState(AddableEntityTypes.includes(initialType) ? initialType : "project");
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [description, setDescription] = useState("");
  const [isWorking, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const Save = async (): Promise<void> => {
    setWorking(true);
    setFailure(null);
    const result = await model.Submit((client) => client.AddEntity(type, Trimmed(name), {
      aliases: SplitList(aliases), description: Trimmed(description) === "" ? undefined : Trimmed(description),
    }), setFailure);
    setWorking(false);
    if (!result) return;
    onClose();
    await onAdded(result);
  };

  return (
    <EditForm title="Add an entity" action="Add" footnote="Notes, commits and issues that mention its names are linked to it."
              canSave={Trimmed(name) !== ""} isWorking={isWorking} failure={failure} onSave={() => void Save()} onClose={onClose}>
      <FormRow label="Type" htmlFor="entity-type">
        <select id="entity-type" className="field" value={type} onChange={(event) => setType(event.target.value)}>
          {AddableEntityTypes.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </FormRow>
      <FormRow label="Name" htmlFor="entity-name">
        <input id="entity-name" className="field" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
      </FormRow>
      <FormRow label="Other names" htmlFor="entity-aliases">
        <input id="entity-aliases" className="field" value={aliases} placeholder="comma-separated (optional)"
               onChange={(event) => setAliases(event.target.value)} />
      </FormRow>
      <FormRow label="Description" htmlFor="entity-description">
        <textarea id="entity-description" className="field" rows={3} value={description} placeholder="optional"
                  onChange={(event) => setDescription(event.target.value)} />
      </FormRow>
    </EditForm>
  );
}

/** The corrections the entity pane offers. */
export type EntityEdit = "rename" | "addName" | "status" | "description" | "relationship" | "merge";

const Statuses = ["active", "paused", "done", "archived"].map((status) => ({ value: status, label: status }));

function StatusMeaning(status: string): string {
  switch (status) {
    case "paused": return "Paused: on hold on purpose. The brief won't remind you it's inactive.";
    case "done": return "Done: finished. The brief won't remind you it's inactive.";
    case "archived": return "Archived: no longer relevant. The brief won't remind you it's inactive.";
    default: return "Active: being worked on. The brief reminds you when it goes quiet.";
  }
}

export function EntityEditSheet({ edit, entity, onClose, onSaved }: {
  edit: EntityEdit; entity: EntityDetail; onClose: () => void; onSaved: (message: string) => Promise<void>;
}) {
  const model = useAppModel();
  const name = entity.entity.name;
  const [text, setText] = useState(edit === "rename" ? name : edit === "description" ? entity.description ?? "" : "");
  const [nameKind, setNameKind] = useState<"alias" | "former">("alias");
  const [status, setStatus] = useState(entity.entity.status);
  const [note, setNote] = useState("");
  const [predicates, setPredicates] = useState<PredicateView[]>([]);
  const [predicate, setPredicate] = useState("PART_OF");
  const [other, setOther] = useState<EntitySummary | null>(null);
  const [reversed, setReversed] = useState(false);
  const [isWorking, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useTask(async (signal) => {
    if (edit === "relationship") setPredicates((await model.Run((client) => client.Predicates(), signal)) ?? []);
  }, []);

  const Save = async (): Promise<void> => {
    const id = entity.entity.id;
    const why = Trimmed(note) === "" ? undefined : Trimmed(note);
    const value = Trimmed(text);
    setWorking(true);
    setFailure(null);
    const message = await model.Submit(async (client): Promise<string | null> => {
      switch (edit) {
        case "rename":
          await client.RenameEntity(id, value, why);
          return `Renamed ${name} to ${value}`;
        case "addName":
          await client.AddEntityName(id, value, nameKind, why);
          return `'${value}' now refers to ${name}`;
        case "status":
          await client.SetEntityStatus(id, status, why);
          return `${name} is ${status}`;
        case "description":
          await client.DescribeEntity(id, value);
          return value === "" ? `Removed the description of ${name}` : `Described ${name}`;
        case "relationship": {
          if (!other) return null;
          const [subject, object] = reversed ? [String(other.id), String(id)] : [String(id), String(other.id)];
          const added = await client.AddRelationship(subject, predicate, object, why);
          return `${added.subject} ${added.predicate} ${added.object}`;
        }
        case "merge":
          if (!other) return null;
          await client.MergeEntity(id, String(other.id), why);
          return `Merged '${other.name}' into ${name}`;
      }
    }, setFailure);
    setWorking(false);
    if (!message) return;
    onClose();
    await onSaved(message);
  };

  const common = { isWorking, failure, onSave: () => void Save(), onClose };
  const NoteField = ({ prompt = "why (optional; kept with the correction)" }: { prompt?: string }) => (
    <FormRow label="Note" htmlFor="edit-note">
      <input id="edit-note" className="field" value={note} placeholder={prompt} onChange={(event) => setNote(event.target.value)} />
    </FormRow>
  );
  const TextField = ({ label }: { label: string }) => (
    <FormRow label={label} htmlFor="edit-text">
      <input id="edit-text" className="field" value={text} autoFocus onChange={(event) => setText(event.target.value)} />
    </FormRow>
  );

  switch (edit) {
    case "rename":
      return (
        <EditForm title={`Rename ${name}`} action="Rename" {...common}
                  footnote={`'${name}' stays a former name, so what mentions it still links here.`}
                  canSave={Trimmed(text) !== "" && Trimmed(text) !== name}>
          {TextField({ label: "New name" })}
          {NoteField({})}
        </EditForm>
      );
    case "addName":
      return (
        <EditForm title={`Add a name for ${name}`} action="Add" {...common}
                  footnote={`What mentions this name links to ${name} from now on.`} canSave={Trimmed(text) !== ""}>
          {TextField({ label: "Name" })}
          <FormRow label="It is" htmlFor="edit-kind">
            <select id="edit-kind" className="field" value={nameKind} onChange={(event) => setNameKind(event.target.value as "alias" | "former")}>
              <option value="alias">another name</option>
              <option value="former">a name it used to have</option>
            </select>
          </FormRow>
          {NoteField({})}
        </EditForm>
      );
    case "status":
      return (
        <EditForm title={`Status of ${name}`} action="Save" {...common} footnote={StatusMeaning(status)}
                  canSave={status !== entity.entity.status || Trimmed(note) !== ""}>
          <FormRow label="Status"><div><Segmented label="Status" value={status} options={Statuses} onChange={setStatus} /></div></FormRow>
          {NoteField({ prompt: "why (optional; shown with the status)" })}
        </EditForm>
      );
    case "description":
      return (
        <EditForm title={`Describe ${name}`} action="Save" {...common}
                  footnote="Answers and the brief use it. Leave it empty to remove it."
                  canSave={Trimmed(text) !== (entity.description ?? "")}>
          <FormRow label="Description" htmlFor="edit-description">
            <textarea id="edit-description" className="field" rows={5} value={text} autoFocus onChange={(event) => setText(event.target.value)} />
          </FormRow>
        </EditForm>
      );
    case "relationship": {
      const options = predicates.length === 0 ? [{ name: predicate, meaning: "" }] : predicates;
      const meaning = predicates.find((candidate) => candidate.name === predicate)?.meaning;
      const [subject, object] = other ? (reversed ? [other.name, name] : [name, other.name]) : ["", ""];
      return (
        <EditForm title={`Relate ${name} to…`} action="Add" {...common} width={540} canSave={other !== null}
                  footnote={other ? `${subject} ${predicate} ${object}, confirmed.` : `Pick what ${name} is related to.`}>
          <FormRow label="Predicate" htmlFor="edit-predicate" hint={meaning || undefined}>
            <select id="edit-predicate" className="field mono" value={predicate} onChange={(event) => setPredicate(event.target.value)}>
              {options.map((option) => <option key={option.name} value={option.name}>{option.name}</option>)}
            </select>
          </FormRow>
          <FormRow label="Other">
            {other && <p className="chosen">{other.name} <span className="caption">{other.type}</span></p>}
            <EntityChooser excluding={[entity.entity.id]} selection={other} onSelect={setOther} />
          </FormRow>
          <Switch checked={reversed} onChange={setReversed}>{name} is the object</Switch>
          {NoteField({})}
        </EditForm>
      );
    }
    case "merge":
      return (
        <EditForm title={`Merge into ${name}`} action="Merge" destructive {...common} width={540} canSave={other !== null}
                  footnote={other
                    ? `'${other.name}' becomes another name of ${name}, and its links, relationships and activity move here. This can't be undone here.`
                    : `Pick the entity that is the same thing as ${name}.`}>
          <FormRow label="The same as">
            {other && <p className="chosen">{other.name} <span className="caption">{other.type}</span></p>}
            <EntityChooser excluding={[entity.entity.id]} selection={other} onSelect={setOther} />
          </FormRow>
          {NoteField({})}
        </EditForm>
      );
  }
}
