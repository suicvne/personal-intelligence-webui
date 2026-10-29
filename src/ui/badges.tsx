import { DaysUntil } from "../lib/formatting.ts";

const KindColors: Record<string, string> = {
  decision: "purple", relationship: "blue", entity: "teal", alias: "orange", issue: "green", merge: "red",
};

export function KindBadge({ kind }: { kind: string }) {
  return <span className={`pill ${KindColors[kind] ?? ""}`}>{kind}</span>;
}

const PriorityColors: Record<number, string> = { 1: "orange", 2: "blue" };
const PriorityWords: Record<number, string> = { 1: "Priority 1 (highest)", 2: "Priority 2", 3: "Priority 3 (lowest)" };

export function PriorityWordsFor(priority: number): string {
  return PriorityWords[priority] ?? `Priority ${priority}`;
}

export function PriorityBadge({ priority }: { priority: number }) {
  return <span className={`pill mono ${PriorityColors[priority] ?? ""}`} title={PriorityWordsFor(priority)}>P{priority}</span>;
}

/** Red once a target date has passed, orange the day before and on the day. */
export function DueClass(day: string): string {
  const days = DaysUntil(day);
  if (days === null) return "muted";
  if (days < 0) return "error";
  if (days <= 1) return "warning";
  return "muted";
}
