// Sources: where intel reads from (folders of notes, git repositories, GitLab) and how each one's syncing goes.
// Mirrors `intel source list|add|enable|disable` and `intel sync --source`.
import { Folder, GitBranch, Globe, Hand, Inbox, Plus, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { SourceFailed, type SourceStatus } from "../api/models.ts";
import { Duration, Minute, RelativeAge } from "../lib/formatting.ts";
import { useAppModel, useAppState, useTask } from "../state/app_context.tsx";
import { Select, useRoute } from "../state/router.ts";
import { IsTypingTarget, Step, useShortcuts } from "../state/shortcuts.ts";
import { EmptyState, Loadable, MessageBar, SearchField, Spinner, Switch } from "../ui/controls.tsx";
import { OpenButton } from "../ui/open_button.tsx";
import { ScreenHeader } from "../ui/shell.tsx";
import { SplitView } from "../ui/split_view.tsx";
import { AddSourceSheet } from "./add_source_sheet.tsx";

function KindName(kind: string): string {
  switch (kind) {
    case "filesystem": return "Folder of notes";
    case "git": return "Git repository";
    case "gitlab": return "GitLab";
    default: return kind;
  }
}

function KindIcon(kind: string): LucideIcon {
  switch (kind) {
    case "filesystem": return Folder;
    case "git": return GitBranch;
    case "gitlab": return Globe;
    default: return Inbox;
  }
}

/** Readable names for the settings intel stores (others are shown as they are). */
const SettingNames: Record<string, string> = {
  include: "Files read", document_patterns: "Documents read", include_documents: "Reads documents",
  exclude_dirs: "Skips", projects: "Projects", groups: "Groups", token_env: "Token from",
  write_token_env: "Token for new issues", verify_tls: "Verifies TLS", ref: "Branch",
  max_commits: "First import, at most", include_manifests: "Reads project files",
};

function SourceRow({ source, selected, isSyncing }: { source: SourceStatus; selected: boolean; isSyncing: boolean }) {
  const Icon = KindIcon(source.kind);
  return (
    <button type="button" role="option" className={`list-row${source.enabled ? "" : " dimmed"}`} aria-selected={selected}
            data-source={source.id} onClick={() => Select(source.id)}>
      <Icon aria-hidden />
      <span className="row-main">
        <span className="row-title">{source.name}</span>
        <span className="row-detail truncate">
          {source.enabled ? `${source.records} records · synced ${RelativeAge(source.last_success_at)}` : `disabled · ${source.records} records kept`}
        </span>
      </span>
      {isSyncing ? <Spinner label="Syncing" />
        : source.enabled && SourceFailed(source) && <span className="warning" title={source.last_error ?? "The last sync failed"}><TriangleAlert className="row-warning" aria-label="The last sync failed" /></span>}
    </button>
  );
}

function SourceDetailPane({ source, isSyncing, onSync, onSetEnabled }: {
  source: SourceStatus; isSyncing: boolean; onSync: () => void; onSetEnabled: (enabled: boolean) => void;
}) {
  const settings = Object.entries(source.settings ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return (
    <div className="detail">
      <div className="detail-inner">
        <div className="stack">
          <div className="detail-title"><h2>{source.name}</h2></div>
          <p className="muted">{KindName(source.kind)}{source.discovered_from ? ` · discovered in ${source.discovered_from}` : ""}</p>
          {source.location && (
            <div className="row location">
              <code className="truncate selectable" title={source.location}>{source.location}</code>
              <OpenButton title={source.kind === "gitlab" ? "Open" : "Show in Finder"} uri={source.location} />
            </div>
          )}
        </div>
        <div className="row wrap">
          <span title="A disabled source isn't synced; what it already read is kept">
            <Switch checked={source.enabled} onChange={onSetEnabled}>Enabled</Switch>
          </span>
          <button type="button" className="button" disabled={!source.enabled || isSyncing} onClick={onSync}>
            <RefreshCw aria-hidden />Sync Now
          </button>
          {isSyncing && <><Spinner /><span className="muted">Syncing…</span></>}
        </div>
        <dl className="facts">
          <dt>Records</dt><dd>{source.records}</dd>
          <dt>Last synced</dt><dd>{source.last_success_at ? `${RelativeAge(source.last_success_at)} (${Minute(source.last_success_at)})` : "never"}</dd>
          <dt>Last run</dt><dd>{source.last_run ?? "not yet"}</dd>
          {source.poll_interval_seconds != null && source.enabled && <><dt>Checked</dt><dd>every {Duration(source.poll_interval_seconds)}</dd></>}
        </dl>
        {SourceFailed(source) && source.last_error && (
          <div className="stack">
            <div className="inline-failure"><TriangleAlert aria-hidden /><span className="selectable">{source.last_error}</span></div>
            {source.kind === "gitlab" && source.last_error.toLowerCase().includes("token") && (
              <p className="caption selectable">Store the token in the Keychain with <code>intel secret set {source.settings?.token_env ?? "GITLAB_TOKEN"}</code>.</p>
            )}
          </div>
        )}
        {settings.length > 0 && (
          <section className="section">
            <h3>Settings</h3>
            <dl className="facts">
              {settings.map(([key, value]) => (
                <div key={key} style={{ display: "contents" }}><dt>{SettingNames[key] ?? key}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

export function SourcesScreen() {
  const model = useAppModel();
  const { refreshToken } = useAppState();
  const { id: selection } = useRoute();
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [filter, setFilter] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  /** Sources being synced from this screen, by name. */
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const Load = async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    const result = await model.Run((client) => client.Sources(), signal);
    if (result) setSources(result);
    if (!signal?.aborted) setLoading(false);
  };
  useTask((signal) => Load(signal), [refreshToken]);

  const needle = filter.trim().toLowerCase();
  const visible = needle === "" ? sources
    : sources.filter((source) => source.name.toLowerCase().includes(needle) || (source.location ?? "").toLowerCase().includes(needle));

  const Sync = async (source: SourceStatus): Promise<void> => {
    if (syncing.has(source.name)) return;
    setSyncing((current) => new Set(current).add(source.name));
    setMessage(`Syncing ${source.name}…`);
    const result = await model.Run((client) => client.Sync([source.name]));
    setMessage(result
      ? [...result.lines, ...(result.entities_created > 0 ? [`${result.entities_created} new entities`] : [])].join(" · ")
      : null);                              // the problem banner says why
    setSyncing((current) => {
      const next = new Set(current);
      next.delete(source.name);
      return next;
    });
    await Load();
    await model.LoadStatus();
  };

  const SetEnabled = async (source: SourceStatus, enabled: boolean): Promise<void> => {
    const updated = await model.Run((client) => client.SetSourceEnabled(source.id, enabled));
    if (!updated) return;
    setSources((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
    setMessage(enabled ? `Enabled ${updated.name}` : `Disabled ${updated.name}; what it read is kept`);
    await model.LoadStatus();
  };

  useShortcuts((event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || IsTypingTarget(event.target)) return false;
    if (event.key !== "j" && event.key !== "k") return false;
    const next = Step(visible.map((source) => source.id), selection, event.key === "j" ? 1 : -1);
    if (next !== null) {
      Select(next, { replace: true });
      document.querySelector(`[data-source="${next}"]`)?.scrollIntoView({ block: "nearest" });
    }
    return true;
  });

  const selected = sources.find((source) => source.id === selection) ?? null;
  const list = (
    <>
      <Loadable isLoading={isLoading} isEmpty={visible.length === 0} emptyIcon={<Inbox />}
                emptyTitle={needle === "" ? "No sources yet" : "Nothing matches"}>
        <div className="list" role="listbox" aria-label="Sources">
          {visible.map((source) => (
            <SourceRow key={source.id} source={source} selected={source.id === selection} isSyncing={syncing.has(source.name)} />
          ))}
        </div>
      </Loadable>
      <MessageBar message={message} />
    </>
  );

  return (
    <div className="screen">
      <ScreenHeader title="Sources">
        <SearchField value={filter} onChange={setFilter} placeholder="Filter by name or location" />
        <button type="button" className="button small" onClick={() => setAdding(true)}
                title="Add a folder of notes, a git repository or GitLab projects"><Plus aria-hidden />Add Source</button>
      </ScreenHeader>
      <SplitView listLabel="Sources" hasSelection={selection !== null} onBack={() => Select(null)} list={list}
                 detail={selected
                   ? <SourceDetailPane key={selected.id} source={selected} isSyncing={syncing.has(selected.name)}
                                       onSync={() => void Sync(selected)} onSetEnabled={(enabled) => void SetEnabled(selected, enabled)} />
                   : selection !== null && isLoading ? <div className="loading"><Spinner large /></div>
                   : <EmptyState icon={<Hand />} title="Select a source"
                                 message="The folders of notes, git repositories and GitLab projects intel reads." />} />
      {adding && (
        <AddSourceSheet onClose={() => setAdding(false)} onAdded={async (added, syncNow) => {
          setFilter("");
          await Load();
          Select(added.id, { replace: true });
          setMessage(`Added ${added.name}` + (syncNow ? "" : "; the background service syncs it at its next cycle"));
          if (syncNow) void Sync(added);
          await model.LoadStatus();
        }} />
      )}
    </div>
  );
}
