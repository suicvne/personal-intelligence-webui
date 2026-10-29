// The page: the shell around the screen the URL names, Settings, and the keyboard shortcuts.
import { useEffect, useState } from "react";
import { ActivityScreen } from "./screens/activity_screen.tsx";
import { AskScreen } from "./screens/ask_screen.tsx";
import { BriefScreen } from "./screens/brief_screen.tsx";
import { EntitiesScreen } from "./screens/entities_screen.tsx";
import { GoalsScreen } from "./screens/goals_screen.tsx";
import { ProposalsScreen } from "./screens/proposals_screen.tsx";
import { ScreenList, ScreenTitle } from "./screens/screen_list.ts";
import { SettingsDialog } from "./screens/settings_dialog.tsx";
import { ShortcutsHelp } from "./screens/shortcuts_help.tsx";
import { SourcesScreen } from "./screens/sources_screen.tsx";
import { TasksScreen } from "./screens/tasks_screen.tsx";
import { useAppModel, useAppState, useTask } from "./state/app_context.tsx";
import { LoadSidebarCollapsed, SaveSidebarCollapsed } from "./state/preferences.ts";
import { Navigate, RoutePath, useRoute, type ScreenId } from "./state/router.ts";
import { DialogOpen, DispatchToScreens, FocusSearch, IsTypingTarget } from "./state/shortcuts.ts";
import { Notice, ProblemBanner, ShellContext, Sidebar } from "./ui/shell.tsx";

function Screen({ id }: { id: ScreenId }) {
  switch (id) {
    case "brief": return <BriefScreen />;
    case "activity": return <ActivityScreen />;
    case "proposals": return <ProposalsScreen />;
    case "tasks": return <TasksScreen />;
    case "goals": return <GoalsScreen />;
    case "entities": return <EntitiesScreen />;
    case "ask": return <AskScreen />;
    case "sources": return <SourcesScreen />;
  }
}

export function App() {
  const model = useAppModel();
  const { refreshToken, showingSettings, status } = useAppState();
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [showingHelp, setShowingHelp] = useState(false);
  const [collapsed, setCollapsed] = useState(LoadSidebarCollapsed);

  useTask((signal) => model.LoadStatus(signal), [refreshToken]);

  useEffect(() => {
    const pending = status?.pending_proposals ?? 0;
    document.title = `${ScreenTitle(route.screen)}${route.screen === "proposals" && pending > 0 ? ` (${pending})` : ""} · Intel`;
  }, [route.screen, status]);

  // Badges stay current in a tab left open: the status again every minute while the page is visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !DialogOpen()) void model.LoadStatus();
    }, 60_000);
    return () => clearInterval(timer);
  }, [model]);

  useEffect(() => {
    const Key = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      if (DialogOpen()) return;
      if (DispatchToScreens(event)) {
        event.preventDefault();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || IsTypingTarget(event.target)) return;
      const index = Number(event.key) - 1;
      let handled = true;
      if (event.key === "r") model.RequestRefresh();
      else if (event.key === "S") void model.SyncNow();
      else if (event.key === ",") model.ShowSettings(true);
      else if (event.key === "?") setShowingHelp(true);
      else if (event.key === "/") handled = FocusSearch();
      else if (Number.isInteger(index) && index >= 0 && index < ScreenList.length) Navigate(RoutePath(ScreenList[index]!.id));
      else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", Key);
    return () => window.removeEventListener("keydown", Key);
  }, [model]);

  const Collapse = (value: boolean): void => {
    setCollapsed(value);
    SaveSidebarCollapsed(value);
  };

  return (
    <ShellContext.Provider value={{ OpenNav: () => setNavOpen(true), ShowHelp: () => setShowingHelp(true) }}>
      <div className="app" data-sidebar={collapsed ? "rail" : "full"} data-nav-open={navOpen ? "" : undefined}
           onClick={(event) => { if (navOpen && event.target === event.currentTarget) setNavOpen(false); }}>
        <Sidebar current={route.screen} collapsed={collapsed} onCollapse={Collapse} onNavigate={() => setNavOpen(false)} />
        <main className="main">
          <Screen key={route.screen} id={route.screen} />
          <ProblemBanner />
        </main>
        {showingSettings && <SettingsDialog />}
        {showingHelp && <ShortcutsHelp onClose={() => setShowingHelp(false)} />}
        <Notice />
      </div>
    </ShellContext.Provider>
  );
}
