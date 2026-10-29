// Brief: what deserves attention now, what changed, and what is waiting on you. Mirrors `intel brief`.
// Viewing it doesn't mark anything as seen; "Seen" (ack) and "Dismiss" do.
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import type { BriefView } from "../api/models.ts";
import { LastHours, Minute } from "../lib/formatting.ts";
import { useAppModel, useAppState, useTask } from "../state/app_context.tsx";
import { EmptyState, Spinner } from "../ui/controls.tsx";
import { ObservationCard } from "../ui/observation_card.tsx";
import { ScreenHeader } from "../ui/shell.tsx";

function Lines({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="section">
      <h3>{title}</h3>
      <ul className="plain-lines">
        {lines.map((line, index) => <li key={index} className="selectable">{line}</li>)}
      </ul>
    </section>
  );
}

function Waiting({ brief }: { brief: BriefView }) {
  const parts = [
    brief.pending_proposals > 0 ? `${brief.pending_proposals} proposals to review` : null,
    brief.ambiguous_mentions > 0 ? `${brief.ambiguous_mentions} ambiguous references` : null,
    brief.failed_work > 0 ? `${brief.failed_work} failed reasoning items` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return <p className="waiting">Waiting on you: {parts.join(" · ")}</p>;
}

export function BriefScreen() {
  const model = useAppModel();
  const { refreshToken, lastSyncLines } = useAppState();
  const [brief, setBrief] = useState<BriefView | null>(null);
  const [isLoading, setLoading] = useState(false);

  const Load = async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    const result = await model.Run((client) => client.Brief(), signal);
    if (result) setBrief(result);
    if (!signal?.aborted) setLoading(false);
  };
  useTask(Load, [refreshToken]);

  return (
    <div className="screen">
      <ScreenHeader title="Brief" />
      <div className="screen-body">
        <div className="reading">
          {brief ? (
            <>
              <h2 className="brief-window" title={`Changes since ${Minute(brief.window_start)}`}>
                {LastHours(brief.window_start, brief.created_at)}
              </h2>
              {brief.observations.length === 0 ? (
                <EmptyState icon={<CircleCheck />} title="Nothing needs your attention"
                            message="Observations only appear when the evidence supports one." />
              ) : (
                <div className="stack observations">
                  {brief.observations.map((observation) => (
                    <ObservationCard key={observation.id} observation={observation} afterResponse={() => Load()} />
                  ))}
                </div>
              )}
              <Lines title="Source activity" lines={brief.activity} />
              <Lines title="Knowledge changes" lines={brief.knowledge_changes} />
              <Waiting brief={brief} />
              <Lines title="Last sync" lines={lastSyncLines} />
            </>
          ) : isLoading && <div className="loading"><Spinner large /></div>}
        </div>
      </div>
    </div>
  );
}
