// Keyboard shortcuts. Single keys work when you aren't typing (the browser keeps ⌘R, ⇧⌘S and ⌘,):
//
//   r refresh · S sync now · 1–8 screens · , settings · / search · j k next and previous · ? these shortcuts
//
// Screens add their own with useShortcuts (Proposals: ⌘↩ approve, ⌘⌫ reject; Ask: Esc stops).
import { useEffect, useRef } from "react";

export type ShortcutHandler = (event: KeyboardEvent) => boolean | void;

export const IsMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const CommandKey = IsMac ? "⌘" : "Ctrl+";

/** ⌘ on a Mac, Ctrl elsewhere. */
export function HasCommand(event: KeyboardEvent): boolean {
  return IsMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** True when the key goes into a text field (or a list of choices), not to the page. */
export function IsTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(target.type);
  }
  return false;
}

export function DialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

const handlers: ShortcutHandler[] = [];

/** Screen shortcuts, newest first; one returning true has handled the key. */
export function useShortcuts(handler: ShortcutHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const entry: ShortcutHandler = (event) => latest.current(event);
    handlers.unshift(entry);
    return () => {
      const index = handlers.indexOf(entry);
      if (index >= 0) handlers.splice(index, 1);
    };
  }, []);
}

/** Offers a key to the screens' shortcuts; true when one took it. */
export function DispatchToScreens(event: KeyboardEvent): boolean {
  for (const handler of handlers) {
    if (handler(event) === true) return true;
  }
  return false;
}

/** Puts the cursor in the screen's search field, if it has one. */
export function FocusSearch(): boolean {
  const field = document.querySelector<HTMLInputElement>("[data-search]");
  if (!field) return false;
  field.focus();
  field.select();
  return true;
}

/** The next (+1) or previous (-1) of `ids` after `current`; the first or last when nothing is selected. */
export function Step<T>(ids: T[], current: T | null, delta: 1 | -1): T | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index < 0) return delta > 0 ? ids[0]! : ids[ids.length - 1]!;
  return ids[Math.max(0, Math.min(ids.length - 1, index + delta))]!;
}
