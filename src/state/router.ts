// Where the page is: the screen, what's selected on it, and its filters, all in the URL, so a selection can
// be linked to, reloaded, and gone back to.
//
//   /brief  /activity?layer=source  /proposals/12  /tasks?all=1  /goals/7?all=1
//   /entities/45?type=component&archived=1  /ask  /sources/3
import { useSyncExternalStore } from "react";

export const Screens = ["brief", "activity", "proposals", "tasks", "goals", "entities", "ask", "sources"] as const;
export type ScreenId = (typeof Screens)[number];

export interface Route {
  screen: ScreenId;
  id: number | null;
  query: URLSearchParams;
}

const ChangeEvent = "intel:navigate";

export function ParseRoute(pathname: string, search: string): Route {
  const [first = "", second] = pathname.split("/").filter(Boolean);
  const screen = (Screens as readonly string[]).includes(first) ? (first as ScreenId) : "brief";
  const id = second !== undefined && /^\d+$/.test(second) ? Number(second) : null;
  return { screen, id, query: new URLSearchParams(search) };
}

export function RoutePath(screen: ScreenId, id?: number | null, query?: URLSearchParams | Record<string, string>): string {
  const params = query instanceof URLSearchParams ? query : new URLSearchParams(query);
  const search = params.toString();
  return `/${screen}${id != null ? `/${id}` : ""}${search ? `?${search}` : ""}`;
}

/** Go somewhere in the app. `replace` doesn't leave a step to go back to (selecting the next proposal). */
export function Navigate(to: string, options: { replace?: boolean } = {}): void {
  const current = window.location.pathname + window.location.search;
  if (to === current) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(ChangeEvent));
}

let cachedKey = "";
let cachedRoute: Route = ParseRoute("/", "");

function CurrentRoute(): Route {
  const key = window.location.pathname + window.location.search;
  if (key !== cachedKey) {
    cachedKey = key;
    cachedRoute = ParseRoute(window.location.pathname, window.location.search);
  }
  return cachedRoute;
}

function Subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(ChangeEvent, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(ChangeEvent, listener);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(Subscribe, CurrentRoute);
}

/** The current screen with another selection (null: none), keeping its filters. */
export function Select(id: number | null, options: { replace?: boolean } = {}): void {
  const route = CurrentRoute();
  Navigate(RoutePath(route.screen, id, route.query), options);
}

/** The current screen with some filters changed (null removes one), keeping the selection. */
export function SetQuery(changes: Record<string, string | null>, options: { replace?: boolean; keepSelection?: boolean } = {}): void {
  const route = CurrentRoute();
  const query = new URLSearchParams(route.query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") query.delete(key);
    else query.set(key, value);
  }
  Navigate(RoutePath(route.screen, options.keepSelection === false ? null : route.id, query), { replace: options.replace ?? true });
}
