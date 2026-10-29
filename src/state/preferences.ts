// What this browser remembers: the token and a few preferences. Storage can be missing or refuse (private
// windows, blocked site data), so every read and write is allowed to fail quietly.

const Keys = {
  token: "intel.token",
  readAloud: "intel.readAnswersAloud",
  sidebarCollapsed: "intel.sidebarCollapsed",
} as const;

function Read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function Write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // not remembered; it still works for this visit
  }
}

export function LoadToken(): string {
  return Read(Keys.token) ?? "";
}

/** Saving an empty token forgets it. */
export function SaveToken(token: string): void {
  Write(Keys.token, token.trim() === "" ? null : token.trim());
}

export function LoadReadAloud(): boolean {
  return Read(Keys.readAloud) === "1";
}

export function SaveReadAloud(on: boolean): void {
  Write(Keys.readAloud, on ? "1" : null);
}

export function LoadSidebarCollapsed(): boolean {
  return Read(Keys.sidebarCollapsed) === "1";
}

export function SaveSidebarCollapsed(collapsed: boolean): void {
  Write(Keys.sidebarCollapsed, collapsed ? "1" : null);
}
