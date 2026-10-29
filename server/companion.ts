// The companion server: serves the web UI, passes /api/* through to intel, and adds /local/* helpers.
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AttachVite, type DevVite } from "./dev_vite.ts";
import { CanonicalOrigin, HostAllowed, IsLocalhostName, LocalCallerProblem } from "./guards.ts";
import { SendJson, SendText } from "./http_util.ts";
import { RunCommand, type CommandRunner } from "./intel_cli.ts";
import { DefaultFindIntel, HandleLocal } from "./local_routes.ts";
import { ProxyApi } from "./proxy.ts";
import { ServeStatic } from "./static_files.ts";

export interface CompanionOptions {
  upstream: URL;
  root: string;                 // the project folder (index.html for --dev)
  distDir: string;              // the built UI
  dev?: boolean;
  keepAliveMs?: number;         // quiet time before a keep-alive comment on event streams
  heartbeatMs?: number;         // /local/sync heartbeat
  runner?: CommandRunner;
  allowLocalToken?: boolean;
  platform?: NodeJS.Platform;
  findIntel?: () => string | null;
}

export interface Companion {
  server: http.Server;
  Close(): Promise<void>;
}

const SecurityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export async function CreateCompanion(options: CompanionOptions): Promise<Companion> {
  const server = http.createServer();
  server.requestTimeout = 0;          // answers can take minutes; nothing here waits on the request body for long
  server.headersTimeout = 60_000;
  const Port = (): number => (server.address() as AddressInfo | null)?.port ?? 0;
  const local = {
    upstream: options.upstream,
    runner: options.runner ?? RunCommand,
    allowLocalToken: options.allowLocalToken ?? true,
    heartbeatMs: options.heartbeatMs ?? 15_000,
    platform: options.platform ?? process.platform,
    findIntel: options.findIntel ?? DefaultFindIntel,
  };
  const keepAliveMs = options.keepAliveMs ?? 15_000;
  let vite: DevVite | null = null;

  const Handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const port = Port();
    if (!HostAllowed(req, port)) {
      SendText(res, 403, "This server only answers to 127.0.0.1.");
      return;
    }
    if (IsLocalhostName(req) && req.method === "GET") {
      res.writeHead(307, { Location: CanonicalOrigin(port) + (req.url ?? "/") });   // one origin, one stored token
      res.end();
      return;
    }
    for (const [name, value] of Object.entries(SecurityHeaders)) res.setHeader(name, value);
    const pathname = new URL(req.url ?? "/", "http://placeholder").pathname;
    if (pathname.startsWith("/api/")) {
      await ProxyApi(req, res, options.upstream, { keepAliveMs });
      return;
    }
    if (pathname.startsWith("/local/")) {
      const problem = LocalCallerProblem(req, port);
      if (problem) {
        SendJson(res, 403, { error: problem });
        return;
      }
      await HandleLocal(req, res, local);
      return;
    }
    if (vite) {
      vite.Handle(req, res, () => SendText(res, 404, "Not found"));
      return;
    }
    await ServeStatic(req, res, options.distDir);
  };

  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    Handle(req, res).catch((error: unknown) => {
      if (res.headersSent) res.destroy();
      else SendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  server.on("upgrade", (req: IncomingMessage, socket) => {
    if (!vite) socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  });
  if (options.dev) {
    server.removeAllListeners("upgrade");
    vite = await AttachVite(server, options.root, (req) => HostAllowed(req, Port()));
  }

  return {
    server,
    Close: async () => {
      await vite?.Close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
