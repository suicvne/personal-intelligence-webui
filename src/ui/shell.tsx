// The frame around every screen: the sidebar with counts and a status footer, each screen's header with the
// global actions, and the problem banner.
import { CircleHelp, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, RefreshCw, RotateCw, Settings, TriangleAlert } from "lucide-react";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { RelativeAge } from "../lib/formatting.ts";
import { Count, ScreenList } from "../screens/screen_list.ts";
import { useAppModel, useAppState } from "../state/app_context.tsx";
import { Navigate, RoutePath, type ScreenId } from "../state/router.ts";
import { CountBadge, Spinner } from "./controls.tsx";

export interface ShellActions {
  OpenNav(): void;
  ShowHelp(): void;
}

export const ShellContext = createContext<ShellActions>({ OpenNav: () => undefined, ShowHelp: () => undefined });

export function Sidebar({ current, collapsed, onCollapse, onNavigate }: {
  current: ScreenId; collapsed: boolean; onCollapse: (collapsed: boolean) => void; onNavigate: () => void;
}) {
  const model = useAppModel();
  const { status, isSyncing } = useAppState();
  const shell = useContext(ShellContext);
  const Go = (event: MouseEvent, screen: ScreenId): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;   // a new tab
    event.preventDefault();
    Navigate(RoutePath(screen));
    onNavigate();
  };
  const newest = status?.sources.map((source) => source.last_success_at).filter((at): at is string => !!at).sort().pop();
  return (
    <nav className="sidebar" aria-label="Screens">
      <div className="brand">
        <img src="/favicon.svg" alt="" />
        <span className="brand-name">Intel</span>
        <button type="button" className="button ghost icon small collapse-toggle" onClick={() => onCollapse(!collapsed)}
                title={collapsed ? "Show the sidebar" : "Narrow the sidebar"} aria-label={collapsed ? "Show the sidebar" : "Narrow the sidebar"}>
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>
      <div className="nav">
        {ScreenList.map((screen, index) => {
          const Icon = screen.icon;
          return (
            <a key={screen.id} href={RoutePath(screen.id)} aria-current={screen.id === current ? "page" : undefined}
               title={`${screen.title} (${index + 1})`} onClick={(event) => Go(event, screen.id)}>
              <Icon aria-hidden />
              <span className="nav-label">{screen.title}</span>
              <CountBadge count={Count(screen.id, status)} label={screen.countLabel} />
            </a>
          );
        })}
      </div>
      <div className="sidebar-footer">
        <div className="footer-main" aria-live="polite">
          {isSyncing ? <><Spinner label="Syncing" /><span className="footer-text">Syncing…</span></>
            : status ? <span className="footer-text">Synced {RelativeAge(newest)}</span>
            : <span className="footer-text">Not connected</span>}
        </div>
        {status && !isSyncing && (
          <div className="footer-text truncate" title={status.llm}>
            {status.sources.filter((source) => source.enabled).length} sources · {status.llm}
          </div>
        )}
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="button ghost small" onClick={() => model.ShowSettings(true)} title="Settings (,)">
            <Settings aria-hidden /><span className="footer-text">Settings</span>
          </button>
          <button type="button" className="button ghost small icon" onClick={shell.ShowHelp} title="Keyboard shortcuts (?)"
                  aria-label="Keyboard shortcuts">
            <CircleHelp aria-hidden />
          </button>
        </div>
      </div>
    </nav>
  );
}

/** A screen's title bar: its name, its own controls, then Refresh and Sync Now. */
export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  const model = useAppModel();
  const { isSyncing } = useAppState();
  const shell = useContext(ShellContext);
  return (
    <header className="screen-header">
      <button type="button" className="button ghost icon menu-toggle" onClick={shell.OpenNav} aria-label="Screens">
        <MenuIcon aria-hidden />
      </button>
      <h1>{title}</h1>
      <div className="controls">{children}</div>
      <div className="global-actions">
        <button type="button" className="button ghost icon" onClick={() => model.RequestRefresh()} title="Reload (r)" aria-label="Reload">
          <RotateCw aria-hidden />
        </button>
        <button type="button" className="button small" onClick={() => void model.SyncNow()} disabled={isSyncing}
                title="Sync every source now (Shift+S)">
          {isSyncing ? <Spinner label="Syncing" /> : <RefreshCw aria-hidden />}
          Sync Now
        </button>
      </div>
    </header>
  );
}

export function ProblemBanner() {
  const model = useAppModel();
  const { problem } = useAppState();
  if (!problem) return null;
  return (
    <div className="banner" role="alert">
      <TriangleAlert aria-hidden />
      <span className="banner-text">{problem}</span>
      <button type="button" className="button small" onClick={() => model.ShowSettings(true)}>Settings…</button>
    </div>
  );
}

export function Notice() {
  const { notice } = useAppState();
  if (!notice) return null;
  return <div className="notice" role="status">{notice}</div>;
}
