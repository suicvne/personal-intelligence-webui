// --dev: Vite runs inside the companion (middleware mode), so the UI, /api and /local share one origin and port.
// Only imported with --dev, so a production install without dev dependencies still starts.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

export interface DevVite {
  Handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  Close(): Promise<void>;
}

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * Starts Vite on the companion's HTTP server. Vite's HMR websocket shares the port; its upgrade listeners
 * are wrapped so the Host check runs first.
 */
export async function AttachVite(server: Server, root: string,
                                 hostAllowed: (req: IncomingMessage) => boolean): Promise<DevVite> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } },
  });
  const listeners = server.listeners("upgrade") as UpgradeListener[];
  server.removeAllListeners("upgrade");
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!hostAllowed(req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    for (const listener of listeners) listener.call(server, req, socket, head);
  });
  return {
    Handle: (req, res, next) => vite.middlewares(req, res, next),
    Close: () => vite.close(),
  };
}
