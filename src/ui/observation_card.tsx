// One observation (Brief, a goal, an entity): what intel noticed, why, the evidence, and Seen / Dismiss /
// Not useful.
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ObservationView } from "../api/models.ts";
import { Percent } from "../lib/formatting.ts";
import { useAppModel } from "../state/app_context.tsx";
import { EvidenceCard } from "./evidence_card.tsx";

export function ObservationCard({ observation, afterResponse }: { observation: ObservationView; afterResponse: () => Promise<void> | void }) {
  const model = useAppModel();
  const [busy, setBusy] = useState(false);
  const Respond = async (action: "ack" | "dismiss", unhelpful = false): Promise<void> => {
    setBusy(true);
    try {
      await model.Run((client) => client.RespondToObservation(observation.id, action, { unhelpful }));
      await afterResponse();
      await model.LoadStatus();
    } finally {
      setBusy(false);
    }
  };
  const meta = [observation.category, `priority ${observation.priority}`, `confidence ${Percent(observation.confidence)}`, observation.reason]
    .filter(Boolean).join(" · ");
  return (
    <article className={`observation card priority-${observation.priority}`}>
      <h3 className="observation-summary">{observation.summary}</h3>
      <p className="selectable">{observation.explanation}</p>
      <p className="caption">{meta}</p>
      {observation.evidence.length > 0 && (
        <details className="disclosure">
          <summary><ChevronRight aria-hidden />Evidence <span className="faint">({observation.evidence.length})</span></summary>
          <div className="stack">
            {observation.evidence.map((evidence, index) => <EvidenceCard key={index} evidence={evidence} />)}
          </div>
        </details>
      )}
      <div className="row wrap">
        <button type="button" className="button small" disabled={busy} onClick={() => void Respond("ack")}
                title="Acknowledge: it only comes back if the situation changes">Seen</button>
        <button type="button" className="button small" disabled={busy} onClick={() => void Respond("dismiss")}
                title="Don't show this situation again">Dismiss</button>
        <button type="button" className="button small ghost" disabled={busy} onClick={() => void Respond("dismiss", true)}
                title="Dismiss, and show fewer observations of this kind">Not useful</button>
      </div>
    </article>
  );
}
