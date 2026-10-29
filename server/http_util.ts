// Small helpers shared by the companion's routes.
import type { IncomingMessage, ServerResponse } from "node:http";

export const MaxBodyBytes = 1024 * 1024;   // intel's request bodies are small JSON objects

export class BodyTooLarge extends Error {}

/** The whole request body. intel reads bodies by Content-Length, so they're forwarded whole, never chunked. */
export function ReadBody(req: IncomingMessage, limit = MaxBodyBytes): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLarge(`the request body is over ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The body as a JSON object, or {} when empty. */
export async function ReadJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await ReadBody(req);
  if (body.length === 0) return {};
  const parsed: unknown = JSON.parse(body.toString("utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SyntaxError("the request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function SendJson(res: ServerResponse, status: number, payload: unknown,
                         headers: Record<string, string> = {}): void {
  const data = Buffer.from(JSON.stringify(payload), "utf-8");
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(data.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(data);
}

export function SendText(res: ServerResponse, status: number, text: string): void {
  const data = Buffer.from(text, "utf-8");
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(data.length) });
  res.end(data);
}

/** Headers that describe one connection and must not be copied to another. */
export const HopByHopHeaders = new Set([
  "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
  "proxy-authenticate", "proxy-authorization", "proxy-connection",
]);
