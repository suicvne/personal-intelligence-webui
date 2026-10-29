// Approving or rejecting every proposal from one place at once, after seeing how many and of what kinds.
import { useState } from "react";
import type { ProposalView } from "../api/models.ts";
import { useAppModel, useTask } from "../state/app_context.tsx";
import { Spinner } from "../ui/controls.tsx";
import { Sheet } from "../ui/sheet.tsx";

export interface GroupDecision {
  group: string;
  decision: "approve" | "reject";
  count: number;
}

function KindCounts(proposals: ProposalView[]): string {
  const counts = new Map<string, number>();
  for (const proposal of proposals) counts.set(proposal.kind, (counts.get(proposal.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${count} ${kind}`).sort().join(", ");
}

export function GroupDecisionSheet({ decision, onClose, onDone }: {
  decision: GroupDecision; onClose: () => void; onDone: (message: string) => Promise<void>;
}) {
  const model = useAppModel();
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<ProposalView[] | null>(null);
  const [working, setWorking] = useState(false);
  const verb = decision.decision === "approve" ? "Approve" : "Reject";

  useTask(async (signal) => {
    setPreview(await model.Run((client) => client.PreviewGroup(decision.group), signal));
  }, []);

  const Decide = async (): Promise<void> => {
    if (!preview || preview.length === 0 || working) return;
    setWorking(true);
    const result = await model.Run((client) => client.DecideGroup(decision.group, decision.decision, {
      note: note === "" ? undefined : note,
    }));
    setWorking(false);
    if (result) await onDone(`${result.decision === "approve" ? "Approved" : "Rejected"} ${result.decided} from ${decision.group}`);
    onClose();
  };

  return (
    <Sheet title={`${verb} every proposal from ${decision.group}?`} width={480} onClose={onClose} onSubmit={() => void Decide()}
           footer={<>
             {working && <Spinner />}
             <button type="button" className="button" onClick={onClose}>Cancel</button>
             <button type="submit" className={`button primary${decision.decision === "reject" ? " danger" : ""}`}
                     disabled={working || !preview || preview.length === 0}>{verb}</button>
           </>}>
      {preview ? <p className="muted">{preview.length} proposals: {KindCounts(preview)}</p> : <Spinner />}
      <input className="field" value={note} autoFocus onChange={(event) => setNote(event.target.value)}
             placeholder={decision.decision === "reject" ? "Why? (remembered with the rejection)" : "Note (optional)"}
             aria-label="Note" />
    </Sheet>
  );
}
