// Why something is believed: the record it comes from, the quoted passage, and the text around it.
import type { ReactNode } from "react";
import type { EvidenceView } from "../api/models.ts";
import { OpenButton } from "./open_button.tsx";

/** The surrounding text with the quoted passage marked (first match, ignoring case). */
function Highlighted(context: string, excerpt: string | null): ReactNode {
  const text = context.replace(/^\n+|\n+$/g, "");
  if (!excerpt) return text;
  const start = text.toLowerCase().indexOf(excerpt.toLowerCase());
  if (start < 0) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + excerpt.length)}</mark>
      {text.slice(start + excerpt.length)}
    </>
  );
}

export function EvidenceCard({ evidence }: { evidence: EvidenceView }) {
  const where = [evidence.kind, evidence.source ? `in ${evidence.source}` : null].filter(Boolean).join(" ");
  return (
    <div className="evidence subcard">
      <div className="evidence-head">
        {where && <span className="caption nowrap">{where}</span>}
        <strong className="truncate small-strong">{evidence.location ?? evidence.title ?? ""}</strong>
        {evidence.stale && <span className="pill yellow" title="The record changed after this was read">changed since</span>}
        <span className="spacer" />
        <OpenButton uri={evidence.uri} />
      </div>
      {evidence.context
        ? <pre className="evidence-context selectable">{Highlighted(evidence.context, evidence.excerpt)}</pre>
        : evidence.excerpt && <blockquote className="evidence-quote selectable">“{evidence.excerpt}”</blockquote>}
      {evidence.note && <p className="caption">{evidence.note}</p>}
      {evidence.model && <p className="small faint">read by {evidence.model}</p>}
    </div>
  );
}
