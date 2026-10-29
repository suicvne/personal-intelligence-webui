// Running local commands: the intel CLI (for its API token), open, and osascript. Never through a shell.
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type CommandRunner = (file: string, args: string[], options?: { timeoutMs?: number }) => Promise<CommandResult>;

export const RunCommand: CommandRunner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: options.timeoutMs ?? 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);   // couldn't start it, or it timed out
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), code: error ? Number(error.code) : 0 });
    });
  });

/** Where the SwiftUI app looks for intel, then PATH. */
export function IntelCandidates(): string[] {
  const known = ["/opt/homebrew/bin/intel", path.join(os.homedir(), ".local/bin/intel"), "/usr/local/bin/intel"];
  const onPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "intel"));
  return [...new Set([...known, ...onPath])];
}

export function FindIntel(candidates: string[] = IntelCandidates()): string | null {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** `intel api token`: the first line of its output. */
export async function ApiToken(intel: string, runner: CommandRunner): Promise<string> {
  const result = await runner(intel, ["api", "token"], { timeoutMs: 30_000 });
  const token = result.stdout.split("\n")[0]?.trim() ?? "";
  if (result.code !== 0 || !token) {
    throw new Error(result.stderr.trim() || `\`intel api token\` gave no token (exit ${result.code})`);
  }
  return token;
}
