// POST /local/sync: intel's sync can wait up to ten minutes for another sync to finish, then run for a while,
// without sending a byte. Some browsers give up on a silent response after five minutes, so the companion
// answers at once with an event stream, sends a comment every so often, and ends with the real response:
//
//   : waiting
//   event: result
//   data: {"status": 200, "body": {...}}              (or {"status": 502, "unreachable": "..."})
import type { IncomingMessage, ServerResponse } from "node:http";
import { ReadBody } from "./http_util.ts";
import { ForwardedHeaders, RequestUpstream, UnreachableMessage } from "./proxy.ts";

export async function LongCall(req: IncomingMessage, res: ServerResponse, upstream: URL, path: string,
                               heartbeatMs: number): Promise<void> {
  const body = await ReadBody(req);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Content-Type-Options": "nosniff",
  });
  res.write(": waiting\n\n");
  const heartbeat = setInterval(() => res.write(": waiting\n\n"), heartbeatMs);
  const Finish = (result: Record<string, unknown>): void => {
    clearInterval(heartbeat);
    if (res.writableEnded) return;
    res.end(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
  };

  const headers = { ...ForwardedHeaders(req), "content-type": "application/json" };
  const upReq = RequestUpstream(upstream, { method: "POST", path, headers, body });
  res.on("close", () => {
    clearInterval(heartbeat);
    if (!res.writableFinished) upReq.destroy();
  });
  upReq.on("error", (error) => Finish({ status: 502, unreachable: UnreachableMessage(upstream, error) }));
  upReq.on("response", (upRes) => {
    const chunks: Buffer[] = [];
    upRes.on("data", (chunk: Buffer) => chunks.push(chunk));
    upRes.on("error", (error) => Finish({ status: 502, unreachable: UnreachableMessage(upstream, error) }));
    upRes.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text.trim() || `HTTP ${upRes.statusCode}` };
      }
      Finish({ status: upRes.statusCode ?? 502, body: parsed });
    });
  });
}
