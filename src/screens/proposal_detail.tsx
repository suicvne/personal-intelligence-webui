// One proposal: what it says, why, the evidence, and approving it (corrected first if need be) or rejecting it.
import { useState } from "react";
import type { ProposalDetail } from "../api/models.ts";
import { Percent } from "../lib/formatting.ts";
import { useAppModel, useTask } from "../state/app_context.tsx";
import { CommandKey, HasCommand, IsMac, IsTypingTarget, useShortcuts } from "../state/shortcuts.ts";
import { KindBadge } from "../ui/badges.tsx";
import { InlineFailure, Spinner } from "../ui/controls.tsx";
import { EvidenceCard } from "../ui/evidence_card.tsx";

/** Fields in a sensible reading order. */
const FieldOrder = ["subject", "predicate", "object", "type", "name", "kind", "description", "statement", "rationale", "title"];

function Capitalized(key: string): string {
  return key.replace(/(^|[\s_])(\w)/g, (_, space: string, letter: string) => (space === "_" ? " " : space) + letter.toUpperCase());
}

function OrderedKeys(fields: Record<string, string>): string[] {
  const Rank = (key: string): number => {
    const index = FieldOrder.indexOf(key);
    return index < 0 ? 99 : index;
  };
  return Object.keys(fields).sort((a, b) => Rank(a) - Rank(b));
}

function Field({ name, value, predicates, onChange }: {
  name: string; value: string; predicates: string[]; onChange: (value: string) => void;
}) {
  const id = `proposal-field-${name}`;
  let control;
  if (name === "predicate") {
    const options = [...new Set([...predicates, value])].sort();
    control = (
      <select id={id} className="field mono" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((predicate) => <option key={predicate} value={predicate}>{predicate}</option>)}
      </select>
    );
  } else if (name === "kind") {
    control = (
      <select id={id} className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="alias">another name</option>
        <option value="former">a former name</option>
        <option value="canonical">the main name now</option>
      </select>
    );
  } else if (name === "description" || name === "statement" || name === "rationale") {
    control = <textarea id={id} className="field" rows={2} value={value} onChange={(event) => onChange(event.target.value)} />;
  } else {
    control = <input id={id} className="field" value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  return (
    <div className="form-row">
      <label htmlFor={id}>{name === "kind" ? "Name is" : Capitalized(name)}</label>
      {control}
    </div>
  );
}

export function ProposalDetailPane({ id, predicates, onDecided }: {
  id: number; predicates: string[]; onDecided: (message: string) => Promise<void>;
}) {
  const model = useAppModel();
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [isWorking, setWorking] = useState(false);
  /** Why the last approve or reject failed, shown next to the buttons. */
  const [failure, setFailure] = useState<string | null>(null);

  useTask(async (signal) => {
    const result = await model.Run((client) => client.Proposal(id), signal);
    if (result) {
      setDetail(result);
      setEdited(result.fields);
    }
  }, [id]);

  const pending = detail?.proposal.status === "pending";

  const Decide = async (decision: "approve" | "reject"): Promise<void> => {
    if (!detail || !pending || isWorking) return;
    const changes = Object.fromEntries(Object.entries(edited).filter(([key, value]) => detail.fields[key] !== value));
    setWorking(true);
    setFailure(null);
    const result = await model.Run((client) => client.Decide(id, decision, {
      note: note === "" ? undefined : note,
      edits: decision === "approve" && Object.keys(changes).length > 0 ? changes : undefined,
    }));
    setWorking(false);
    if (!result) {
      setFailure(model.Snapshot().problem ?? "That didn't work.");
      return;
    }
    let message = `P${result.proposal.id} ${result.proposal.status}: ${result.proposal.summary}`;
    if (result.also_approved.length > 0) message += ` (also approved: ${result.also_approved.map((other) => other.summary).join(", ")})`;
    if (result.created_issue_url) message += ` — created ${result.created_issue_url}`;
    await onDecided(message);
  };

  useShortcuts((event) => {
    if (!pending || !HasCommand(event)) return false;
    if (event.key === "Enter") {
      void Decide("approve");
      return true;
    }
    if (event.key === "Backspace" && !IsTypingTarget(event.target)) {     // in a field it deletes, as usual
      void Decide("reject");
      return true;
    }
    return false;
  });

  if (!detail) return <div className="loading"><Spinner large /></div>;
  const proposal = detail.proposal;
  const keys = OrderedKeys(detail.fields);
  return (
    <div className="detail">
      <div className="detail-inner">
        <div className="stack">
          <div className="row"><KindBadge kind={proposal.kind} /><span className="caption">P{proposal.id}</span></div>
          <h2 className="proposal-summary selectable">{proposal.summary}</h2>
          <p className="caption">
            From {proposal.source} · {proposal.origin}{proposal.confidence !== null ? ` · confidence ${Percent(proposal.confidence)}` : ""}
          </p>
        </div>
        {detail.rationale && <p className="muted selectable">{detail.rationale}</p>}
        {detail.evidence.length > 0 && (
          <div className="stack">
            {detail.evidence.map((evidence, index) => <EvidenceCard key={index} evidence={evidence} />)}
          </div>
        )}
        {pending ? (
          <>
            {keys.length > 0 && (
              <section className="form-group">
                <h3>Correct before approving</h3>
                <div className="field-grid">
                  {keys.map((key) => (
                    <Field key={key} name={key} value={edited[key] ?? ""} predicates={predicates}
                           onChange={(value) => setEdited({ ...edited, [key]: value })} />
                  ))}
                </div>
              </section>
            )}
            <section className="decision">
              <input className="field" value={note} placeholder="Note (why; kept with your decision)" aria-label="Note"
                     onChange={(event) => setNote(event.target.value)}
                     onKeyDown={(event) => {
                       if (event.key === "Enter" && !HasCommand(event.nativeEvent)) event.preventDefault();
                     }} />
              <div className="row wrap">
                <button type="button" className="button primary" disabled={isWorking} onClick={() => void Decide("approve")}>Approve</button>
                <button type="button" className="button" disabled={isWorking} onClick={() => void Decide("reject")}>Reject</button>
                {isWorking && <Spinner />}
                <span className="spacer" />
                <span className="small faint">
                  {IsMac ? "⌘↩ approve · ⌘⌫ reject" : `${CommandKey}Enter approve · ${CommandKey}Backspace reject`}
                </span>
              </div>
              <InlineFailure message={failure} />
            </section>
          </>
        ) : (
          <p className="muted">Already {proposal.status}{detail.decision_note ? `: ${detail.decision_note}` : ""}</p>
        )}
      </div>
    </div>
  );
}
