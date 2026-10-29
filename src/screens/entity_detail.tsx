// One entity: its names, identifiers, what files state about it, relationships, recent activity and
// observations, with corrections in the Edit menu and on each name and relationship.
import { Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { EntityDetail, RelationshipView } from "../api/models.ts";
import { Day } from "../lib/formatting.ts";
import { useAppModel, useTask } from "../state/app_context.tsx";
import { MessageBar, Spinner } from "../ui/controls.tsx";
import { MenuButton, type MenuEntry } from "../ui/menu.tsx";
import { ObservationCard } from "../ui/observation_card.tsx";
import { EntityEditSheet, type EntityEdit } from "./entity_editing.tsx";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      <div className="rows">{children}</div>
    </section>
  );
}

function Row({ text, detail, actions, struck = false }: { text: string; detail: string; actions?: MenuEntry[]; struck?: boolean }) {
  return (
    <div className="item">
      <span className={`item-main${struck ? " struck" : ""}`}>{text}</span>
      <span className="item-detail truncate" title={detail}>{detail}</span>
      {actions && actions.length > 0 ? <MenuButton label={`Actions for ${text}`} entries={actions} /> : actions && <span className="menu-placeholder" />}
    </div>
  );
}

export function EntityDetailPane({ id, onChanged }: { id: number; onChanged: () => Promise<void> }) {
  const model = useAppModel();
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [editing, setEditing] = useState<EntityEdit | null>(null);
  /** What the last correction did. */
  const [message, setMessage] = useState<string | null>(null);

  const Load = async (signal?: AbortSignal): Promise<void> => {
    const result = await model.Run((client) => client.Entity(id), signal);
    if (result) setDetail(result);
  };
  useTask((signal) => Load(signal), [id]);

  const Changed = async (done: string): Promise<void> => {
    setMessage(done);
    await Load();
    await onChanged();
  };

  const RemoveName = async (name: string): Promise<void> => {
    if (await model.Run((client) => client.RemoveEntityName(id, name))) await Changed(`Removed '${name}'`);
  };

  const Decide = async (relationship: RelationshipView, action: "confirm" | "reject" | "end"): Promise<void> => {
    const result = await model.Run((client) => client.DecideRelationship(relationship.id, action));
    if (!result) return;
    const done = { confirm: "Confirmed", reject: "Rejected", end: "Ended" }[action];
    await Changed(`${done}: ${result.subject} ${result.predicate} ${result.object}`);
  };

  if (!detail) return <div className="loading"><Spinner large /></div>;
  const entity = detail.entity;
  const identifiers = Object.entries(detail.identifiers).sort(([a], [b]) => (a < b ? -1 : 1));
  return (
    <>
      <div className="detail">
        <div className="detail-inner">
          <div className="stack">
            <div className="detail-title">
              <h2>{entity.name}</h2>
              <MenuButton label="Correct what intel knows about it" className="button small" icon={<><Pencil aria-hidden />Edit</>} entries={[
                { label: "Rename…", onSelect: () => setEditing("rename") },
                { label: "Add a Name…", onSelect: () => setEditing("addName") },
                { label: "Set Status…", onSelect: () => setEditing("status") },
                { label: "Edit Description…", onSelect: () => setEditing("description") },
                "divider",
                { label: "Add a Relationship…", onSelect: () => setEditing("relationship") },
                "divider",
                { label: "Merge Another Entity Into This…", onSelect: () => setEditing("merge") },
              ]} />
            </div>
            <p className="muted">{entity.type} · {entity.status}{detail.status_note ? ` — ${detail.status_note}` : ""}</p>
            {detail.description && <p className="selectable">{detail.description}</p>}
            {detail.decision && <p className="selectable">Decision: {detail.decision}</p>}
            {detail.goal && <p className="selectable">Goal: {detail.goal}</p>}
          </div>
          <Block title="Names">
            {detail.names.map((name) => (
              <Row key={`${name.kind}:${name.name}`} text={name.name}
                   detail={`${name.kind} · ${name.origin}${name.until ? ` · until ${Day(name.until)}` : ""}`}
                   actions={name.kind === "canonical" ? [] : [{ label: `Remove '${name.name}'`, onSelect: () => void RemoveName(name.name) }]} />
            ))}
          </Block>
          {identifiers.length > 0 && (
            <Block title="Source identifiers">
              {identifiers.map(([key, value]) => <Row key={key} text={value} detail={key} />)}
            </Block>
          )}
          {detail.properties.length > 0 && (
            <Block title="Stated in files">
              {detail.properties.map((property, index) => (
                <Row key={index} text={`${property.key ?? ""} = ${property.value ?? ""}`} detail={property.where ?? ""} />
              ))}
            </Block>
          )}
          {detail.relationships.length > 0 && (
            <Block title="Relationships">
              {detail.relationships.map((relationship) => (
                <Row key={relationship.id} struck={relationship.status === "rejected"}
                     text={`${relationship.subject} ${relationship.predicate} ${relationship.object}`}
                     detail={`${relationship.status} · ${relationship.origin}`}
                     actions={[
                       ...(relationship.status !== "confirmed" ? [{ label: "Confirm", onSelect: () => void Decide(relationship, "confirm") }] : []),
                       ...(relationship.status !== "rejected" ? [
                         { label: "Reject (not true; don't propose it again)", onSelect: () => void Decide(relationship, "reject") },
                         { label: "End (no longer true; kept as history)", onSelect: () => void Decide(relationship, "end") },
                       ] : []),
                     ]} />
              ))}
            </Block>
          )}
          {detail.activity.length > 0 && (
            <Block title="Latest recorded activity">
              {detail.activity.map((item, index) => (
                <Row key={index} text={item.title ?? item.kind} detail={`${Day(item.at)} · ${item.kind} · ${item.source}`} />
              ))}
            </Block>
          )}
          {detail.observations.map((observation) => (
            <ObservationCard key={observation.id} observation={observation} afterResponse={() => Load()} />
          ))}
        </div>
      </div>
      <MessageBar message={message} />
      {editing && <EntityEditSheet edit={editing} entity={detail} onClose={() => setEditing(null)} onSaved={Changed} />}
    </>
  );
}
