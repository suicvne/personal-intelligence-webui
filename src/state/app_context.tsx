// Connects the AppModel to React: the screens read its state and call it through these hooks.
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { AppModel, AppState } from "./app_model.ts";

const AppModelContext = createContext<AppModel | null>(null);

export function AppModelProvider({ model, children }: { model: AppModel; children: ReactNode }) {
  return <AppModelContext.Provider value={model}>{children}</AppModelContext.Provider>;
}

export function useAppModel(): AppModel {
  const model = useContext(AppModelContext);
  if (!model) throw new Error("useAppModel outside AppModelProvider");
  return model;
}

/** The shared state; the component re-renders when it changes. */
export function useAppState(): AppState {
  const model = useAppModel();
  return useSyncExternalStore(model.Subscribe, model.Snapshot);
}

/**
 * Work that belongs to a view while it shows, like SwiftUI's .task(id:): it starts when the view appears and
 * whenever `deps` change, and its signal aborts when they change again or the view goes away.
 */
export function useTask(work: (signal: AbortSignal) => Promise<unknown> | void, deps: unknown[]): void {
  const latest = useRef(work);
  latest.current = work;
  useEffect(() => {
    const controller = new AbortController();
    void latest.current(controller.signal);
    return () => controller.abort();
  }, deps);
}
