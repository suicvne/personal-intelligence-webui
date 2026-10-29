// Adding a goal, or changing a goal's priority, target date and what it prioritizes.
import { CircleMinus } from "lucide-react";
import { useState } from "react";
import type { GoalView } from "../api/models.ts";
import { CalendarDay } from "../lib/formatting.ts";
import { Trimmed } from "../lib/text.ts";
import { useAppModel } from "../state/app_context.tsx";
import { Segmented, Switch } from "../ui/controls.tsx";
import { EditForm, FormRow } from "../ui/edit_form.tsx";
import { EntityChooser } from "../ui/entity_chooser.tsx";

interface Target {
  id: number;
  name: string;
  type: string;
}

const Priorities = [{ value: "1", label: "1 · highest" }, { value: "2", label: "2" }, { value: "3", label: "3 · lowest" }];

function InTwoWeeks(): string {
  return CalendarDay(new Date(Date.now() + 14 * 86_400_000));
}

export function GoalSheet({ goal, onClose, onSaved }: { goal: GoalView | null; onClose: () => void; onSaved: (goal: GoalView) => Promise<void> }) {
  const model = useAppModel();
  const [statement, setStatement] = useState("");
  const [priority, setPriority] = useState(String(goal?.priority ?? 2));
  const [hasTargetDate, setHasTargetDate] = useState(goal?.target_date != null);
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? InTwoWeeks());
  const [targets, setTargets] = useState<Target[]>(goal?.prioritizes.map(({ id, name, type }) => ({ id, name, type })) ?? []);
  const [isWorking, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const Save = async (): Promise<void> => {
    const day = hasTargetDate && targetDate !== "" ? targetDate : null;
    const prioritizes = targets.map((target) => String(target.id));
    setWorking(true);
    setFailure(null);
    const result = await model.Submit((client) => goal
      ? client.UpdateGoal(goal.id, Number(priority), day, prioritizes)
      : client.AddGoal(Trimmed(statement), prioritizes, Number(priority), day), setFailure);
    setWorking(false);
    if (!result) return;
    onClose();
    await onSaved(result);
  };

  return (
    <EditForm title={goal ? "Change this goal" : "Add a goal"} action={goal ? "Save" : "Add"} width={540}
              footnote="The brief reminds you as the target date nears, and says when your recent work goes to something else than what the goal prioritizes."
              canSave={goal !== null || Trimmed(statement) !== ""} isWorking={isWorking} failure={failure}
              onSave={() => void Save()} onClose={onClose}>
      <FormRow label="Goal" htmlFor="goal-statement">
        {goal
          ? <p className="selectable">{goal.statement}</p>
          : <textarea id="goal-statement" className="field" rows={2} value={statement} autoFocus placeholder="e.g. Ship the Crawler demo"
                      onChange={(event) => setStatement(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }} />}
      </FormRow>
      <FormRow label="Priority">
        <div><Segmented label="Priority" value={priority} options={Priorities} onChange={setPriority} /></div>
      </FormRow>
      <div className="row wrap">
        <Switch checked={hasTargetDate} onChange={setHasTargetDate}>Has a target date</Switch>
        {hasTargetDate && (
          <input type="date" className="field date-field" value={targetDate} aria-label="Target date"
                 onChange={(event) => setTargetDate(event.target.value)} />
        )}
      </div>
      <FormRow label="Prioritizes">
        {targets.length > 0 && (
          <div className="rows">
            {targets.map((target) => (
              <div key={target.id} className="item">
                <span className="item-main">{target.name} <span className="caption">{target.type}</span></span>
                <button type="button" className="button ghost icon small" title={`Stop prioritizing ${target.name}`}
                        aria-label={`Stop prioritizing ${target.name}`}
                        onClick={() => setTargets(targets.filter((other) => other.id !== target.id))}>
                  <CircleMinus aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        <EntityChooser excluding={targets.map((target) => target.id)} excludingTypes={["goal", "decision", "task"]}
                       selection={null} onSelect={(entity) => setTargets([...targets, { id: entity.id, name: entity.name, type: entity.type }])} />
      </FormRow>
    </EditForm>
  );
}
