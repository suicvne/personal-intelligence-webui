// Opens a note, a folder or a file intel cited, the way the SwiftUI app does with NSWorkspace.
// `open` would also launch apps and run scripts, so those are only shown in Finder.
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { CommandRunner } from "./intel_cli.ts";

export class OpenerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface OpenResult {
  revealed: boolean;
}

/** Files `open` would run or install rather than show. */
const RevealOnlyExtensions = new Set([
  ".app", ".command", ".tool", ".sh", ".zsh", ".bash", ".csh", ".fish", ".py", ".rb", ".pl", ".php",
  ".terminal", ".fileloc", ".webloc", ".inetloc", ".url", ".jar", ".pkg", ".mpkg", ".dmg", ".workflow",
  ".scpt", ".scptd", ".applescript", ".shortcut", ".action", ".prefpane", ".kext", ".mobileconfig",
  ".bundle", ".plugin", ".framework", ".appex", ".saver", ".qlgenerator",
]);

/** True when opening this would run something instead of showing it. */
export function RevealOnly(file: string, mode: number, isFile: boolean): boolean {
  const parts = file.split(path.sep);
  if (parts.some((part) => RevealOnlyExtensions.has(path.extname(part).toLowerCase()))) return true;
  return isFile && (mode & 0o111) !== 0;
}

export async function OpenPath(target: unknown, reveal: boolean, runner: CommandRunner,
                               platform: NodeJS.Platform = process.platform): Promise<OpenResult> {
  if (platform !== "darwin") throw new OpenerError(501, "Opening files from the web UI only works on macOS.");
  if (typeof target !== "string" || !path.isAbsolute(target)) {
    throw new OpenerError(400, "Only absolute paths can be opened.");
  }
  let resolved: string;
  try {
    resolved = await realpath(target);
  } catch {
    throw new OpenerError(404, `${target} doesn't exist any more.`);
  }
  const info = await stat(resolved);
  const revealOnly = reveal || RevealOnly(resolved, info.mode, info.isFile());
  const result = await runner("/usr/bin/open", revealOnly ? ["-R", resolved] : [resolved], { timeoutMs: 15_000 });
  if (result.code !== 0) throw new OpenerError(500, result.stderr.trim() || `open failed (exit ${result.code})`);
  return { revealed: revealOnly && !reveal };
}

/** A native folder chooser (the browser can't give out absolute paths). Null when cancelled. */
export async function ChooseFolder(runner: CommandRunner, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (platform !== "darwin") throw new OpenerError(501, "Choosing a folder from the web UI only works on macOS.");
  const result = await runner("/usr/bin/osascript", [
    "-e", "tell me to activate",
    "-e", 'POSIX path of (choose folder with prompt "Choose a folder for intel to read")',
  ], { timeoutMs: 10 * 60_000 });
  if (result.code !== 0) {
    if (result.stderr.includes("-128")) return null;   // the person pressed Cancel
    throw new OpenerError(500, result.stderr.trim() || `osascript failed (exit ${result.code})`);
  }
  const chosen = result.stdout.trim();
  return chosen.length > 1 ? chosen.replace(/\/$/, "") : chosen || null;
}
