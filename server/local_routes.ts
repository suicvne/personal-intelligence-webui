// /local/*: what a browser can't do by itself. Only this web UI may call these (see guards.ts).
//
//   GET  /local/info             {platform, canOpen, canChooseFolder, localToken, upstream}
//   POST /local/token            {token}: runs `intel api token`
//   POST /local/open             {path, reveal?} -> {revealed}: open (or show in Finder) a local file or folder
//   POST /local/choose-folder    {path|null}: the macOS folder chooser
//   POST /local/sync             {sources?}: POST /api/sync with a heartbeat (see long_call.ts)
import type { IncomingMessage, ServerResponse } from "node:http";
import { ReadJsonObject, SendJson } from "./http_util.ts";
import { ApiToken, FindIntel, type CommandRunner } from "./intel_cli.ts";
import { LongCall } from "./long_call.ts";
import { ChooseFolder, OpenerError, OpenPath } from "./opener.ts";

export interface LocalOptions {
  upstream: URL;
  runner: CommandRunner;
  allowLocalToken: boolean;
  heartbeatMs: number;
  platform: NodeJS.Platform;
  findIntel: () => string | null;
}

export function DefaultFindIntel(): string | null {
  return FindIntel();
}

async function Route(req: IncomingMessage, res: ServerResponse, options: LocalOptions, route: string): Promise<void> {
  const darwin = options.platform === "darwin";
  if (route === "GET /local/info") {
    SendJson(res, 200, {
      platform: options.platform,
      canOpen: darwin,
      canChooseFolder: darwin,
      localToken: options.allowLocalToken && options.findIntel() !== null,
      upstream: options.upstream.origin,
    });
    return;
  }
  if (route === "POST /local/token") {
    if (!options.allowLocalToken) {
      SendJson(res, 403, { error: "This web UI was started with --no-local-token; paste the token from `intel api token`." });
      return;
    }
    const intel = options.findIntel();
    if (!intel) {
      SendJson(res, 404, { error: "Couldn't find intel in /opt/homebrew/bin, ~/.local/bin, /usr/local/bin or PATH." });
      return;
    }
    SendJson(res, 200, { token: await ApiToken(intel, options.runner) });
    return;
  }
  if (route === "POST /local/open") {
    const body = await ReadJsonObject(req);
    SendJson(res, 200, await OpenPath(body.path, body.reveal === true, options.runner, options.platform));
    return;
  }
  if (route === "POST /local/choose-folder") {
    SendJson(res, 200, { path: await ChooseFolder(options.runner, options.platform) });
    return;
  }
  if (route === "POST /local/sync") {
    await LongCall(req, res, options.upstream, "/api/sync", options.heartbeatMs);
    return;
  }
  SendJson(res, 404, { error: `no route for ${route}` });
}

export async function HandleLocal(req: IncomingMessage, res: ServerResponse, options: LocalOptions): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://placeholder").pathname;
  try {
    await Route(req, res, options, `${req.method ?? "GET"} ${pathname}`);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof OpenerError) SendJson(res, error.status, { error: error.message });
    else if (error instanceof SyntaxError) SendJson(res, 400, { error: error.message });
    else SendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
