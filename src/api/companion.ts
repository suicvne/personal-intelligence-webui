// What the companion server adds to intel's API (server/local_routes.ts): things a browser can't do itself.
import { IntelError } from "./intel_error.ts";
import { LocalHeader } from "./intel_client.ts";

export interface LocalInfo {
  platform: string;
  canOpen: boolean;              // can open local files and folders (macOS)
  canChooseFolder: boolean;
  localToken: boolean;           // can read the token of the intel on this Mac
  upstream: string;              // where intel's API is
}

async function Call<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { [LocalHeader]: "1", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    throw IntelError.Companion(error instanceof Error ? error.message : String(error));
  }
  const text = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      // keep the status
    }
    throw new IntelError("server", message, response.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw IntelError.InvalidResponse();
  }
}

export function GetLocalInfo(): Promise<LocalInfo> {
  return Call("/local/info", "GET");
}

/** The token of the intel on this Mac (`intel api token`). */
export async function GetLocalToken(): Promise<string> {
  return (await Call<{ token: string }>("/local/token", "POST", {})).token;
}

/** Opens a local file or folder (or shows it in Finder). `revealed` is true when it was only shown, to be safe. */
export function OpenLocalPath(path: string, reveal = false): Promise<{ revealed: boolean }> {
  return Call("/local/open", "POST", { path, reveal });
}

/** The macOS folder chooser; null when cancelled. */
export async function ChooseFolder(): Promise<string | null> {
  return (await Call<{ path: string | null }>("/local/choose-folder", "POST", {})).path;
}
