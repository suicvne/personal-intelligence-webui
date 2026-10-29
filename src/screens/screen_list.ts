// The screens in the sidebar, their icons, and the count each shows.
import { Clock3, Hexagon, Inbox, ListChecks, MessageCircleQuestion, SquarePen, Sunrise, Target, type LucideIcon } from "lucide-react";
import { SourceFailed, type StatusView } from "../api/models.ts";
import type { ScreenId } from "../state/router.ts";

export interface ScreenInfo {
  id: ScreenId;
  title: string;
  icon: LucideIcon;
  /** What the badge counts ("3 waiting"), for screen readers. */
  countLabel?: string;
}

export const ScreenList: ScreenInfo[] = [
  { id: "brief", title: "Brief", icon: Sunrise, countLabel: "need attention" },
  { id: "activity", title: "Activity", icon: Clock3 },
  { id: "proposals", title: "Proposals", icon: ListChecks, countLabel: "waiting" },
  { id: "tasks", title: "Tasks", icon: SquarePen, countLabel: "open" },
  { id: "goals", title: "Goals", icon: Target },
  { id: "entities", title: "Entities", icon: Hexagon },
  { id: "ask", title: "Ask", icon: MessageCircleQuestion },
  { id: "sources", title: "Sources", icon: Inbox, countLabel: "failed" },
];

export function ScreenTitle(id: ScreenId): string {
  return ScreenList.find((screen) => screen.id === id)?.title ?? "Intel";
}

export function Count(screen: ScreenId, status: StatusView | null): number {
  if (!status) return 0;
  switch (screen) {
    case "brief": return status.needs_attention;
    case "proposals": return status.pending_proposals;
    case "tasks": return status.open_tasks;
    case "sources": return status.sources.filter((source) => source.enabled && SourceFailed(source)).length;   // the last sync failed
    default: return 0;
  }
}
