// Proposals: what intel inferred and is asking you about, grouped by where it came from.
// Mirrors `intel proposals` / `intel proposal show|approve|reject`, plus correcting a proposal
// before approving it (e.g. DESCRIBES -> PART_OF).
import { BadgeCheck, Hand } from "lucide-react";
import { useRef, useState } from "react";
import type { ProposalGroupView, ProposalOverview } from "../api/models.ts";
import { useAppModel, useAppState, useTask } from "../state/app_context.tsx";
import { Select, useRoute } from "../state/router.ts";
import { IsTypingTarget, Step, useShortcuts } from "../state/shortcuts.ts";
import { KindBadge } from "../ui/badges.tsx";
import { EmptyState, Loadable, MessageBar, SearchField } from "../ui/controls.tsx";
import { MenuButton } from "../ui/menu.tsx";
import { ScreenHeader } from "../ui/shell.tsx";
import { SplitView } from "../ui/split_view.tsx";
import { GroupDecisionSheet, type GroupDecision } from "./group_decision_sheet.tsx";
import { ProposalDetailPane } from "./proposal_detail.tsx";

/** The groups in `order` (new ones last), keeping only proposals that match the filter. */
function VisibleGroups(overview: ProposalOverview | null, order: string[], filter: string): ProposalGroupView[] {
  if (!overview) return [];
  const position = new Map(order.map((name, index) => [name, index]));
  const ordered = [...overview.groups].sort((a, b) =>
    (position.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.name) ?? Number.MAX_SAFE_INTEGER));
  const needle = filter.trim().toLowerCase();
  if (needle === "") return ordered;
  return ordered.flatMap((group) => {
    const proposals = group.proposals.filter((proposal) =>
      proposal.summary.toLowerCase().includes(needle) || proposal.source.toLowerCase().includes(needle));
    return proposals.length === 0 ? [] : [{ ...group, proposals }];
  });
}

export function ProposalsScreen() {
  const model = useAppModel();
  const { refreshToken } = useAppState();
  const { id: selection } = useRoute();
  const [overview, setOverview] = useState<ProposalOverview | null>(null);
  const [filter, setFilter] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [groupDecision, setGroupDecision] = useState<GroupDecision | null>(null);
  /**
   * Group order fixed when the list loads (largest first) and kept while you review, so sections don't jump
   * around as you approve or reject. Only an explicit refresh or a sync re-sorts.
   */
  const groupOrder = useRef<string[]>([]);
  const loadedOnce = useRef(false);

  /** `resort`: take the server's order. Otherwise keep the current order and add new groups at the end. */
  const Load = async (resort: boolean, signal?: AbortSignal): Promise<ProposalOverview | null> => {
    setLoading(true);
    const result = await model.Run((client) => client.Proposals(), signal);
    if (!signal?.aborted) setLoading(false);
    if (!result) return null;
    const names = result.groups.map((group) => group.name);
    if (resort || groupOrder.current.length === 0) groupOrder.current = names;
    else groupOrder.current = [...groupOrder.current, ...names.filter((name) => !groupOrder.current.includes(name))];
    setOverview(result);
    // A group decision or a sync can remove the selected proposal; don't keep showing it. (A link to one
    // already decided still opens it, to show how it was decided.)
    const current = new URL(window.location.href).pathname.split("/")[2];
    const selected = current ? Number(current) : null;
    if (loadedOnce.current && selected !== null && !result.groups.some((group) => group.proposals.some((proposal) => proposal.id === selected))) {
      Select(null, { replace: true });
    }
    loadedOnce.current = true;
    return result;
  };
  useTask((signal) => Load(true, signal), [refreshToken]);

  const groups = VisibleGroups(overview, groupOrder.current, filter);
  const ids = groups.flatMap((group) => group.proposals.map((proposal) => proposal.id));

  /** After a decision: report it, reload, and move on to the next proposal in the list. */
  const Decided = async (id: number, message: string): Promise<void> => {
    const index = ids.indexOf(id);
    const next = index < 0 ? null : index + 1 < ids.length ? ids[index + 1]! : index > 0 ? ids[index - 1]! : null;
    setLastResult(message);
    const result = await Load(false);
    const remaining = new Set(result?.groups.flatMap((group) => group.proposals.map((proposal) => proposal.id)) ?? []);
    Select(next !== null && remaining.has(next) ? next : null, { replace: true });
    await model.LoadStatus();
  };

  useShortcuts((event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || IsTypingTarget(event.target)) return false;
    if (event.key !== "j" && event.key !== "k") return false;
    const next = Step(ids, selection, event.key === "j" ? 1 : -1);
    if (next !== null) {
      Select(next, { replace: true });
      document.querySelector(`[data-proposal="${next}"]`)?.scrollIntoView({ block: "nearest" });
    }
    return true;
  });

  const list = (
    <>
      <Loadable isLoading={isLoading} isEmpty={groups.length === 0} emptyIcon={<BadgeCheck />}
                emptyTitle={filter.trim() === "" ? "No proposals waiting" : "Nothing matches"}>
        <div className="list" role="listbox" aria-label="Proposals">
          {groups.map((group) => (
            <div key={group.name} role="group" aria-label={group.name}>
              <div className="list-section">
                <span className="section-name" title={group.name}>{group.name}</span>
                <span className="faint">{group.proposals.length}</span>
                <MenuButton label={`Decide every proposal from ${group.name}`} entries={[
                  { label: `Approve all ${group.proposals.length}…`, onSelect: () => setGroupDecision({ group: group.name, decision: "approve", count: group.proposals.length }) },
                  { label: `Reject all ${group.proposals.length}…`, onSelect: () => setGroupDecision({ group: group.name, decision: "reject", count: group.proposals.length }) },
                ]} />
              </div>
              {group.proposals.map((proposal) => (
                <button key={proposal.id} type="button" role="option" className="list-row" data-proposal={proposal.id}
                        aria-selected={proposal.id === selection} onClick={() => Select(proposal.id)}>
                  <KindBadge kind={proposal.kind} />
                  <span className="row-main clamp-2">{proposal.summary.replace("Decision: ", "")}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Loadable>
      <MessageBar message={lastResult} />
    </>
  );

  return (
    <div className="screen">
      <ScreenHeader title="Proposals">
        <SearchField value={filter} onChange={setFilter} placeholder="Filter by source or summary" />
      </ScreenHeader>
      <SplitView listLabel="Proposals" hasSelection={selection !== null} onBack={() => Select(null)} list={list}
                 detail={selection !== null
                   ? <ProposalDetailPane key={selection} id={selection} predicates={overview?.predicates ?? []}
                                         onDecided={(message) => Decided(selection, message)} />
                   : <EmptyState icon={<Hand />} title="Select a proposal"
                                 message="Approve what's right, correct what's almost right, reject the rest." />} />
      {groupDecision && (
        <GroupDecisionSheet decision={groupDecision} onClose={() => setGroupDecision(null)}
                            onDone={async (message) => {
                              setLastResult(message);
                              await Load(false);
                              await model.LoadStatus();
                            }} />
      )}
    </div>
  );
}
