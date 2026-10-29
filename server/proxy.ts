// /api/* passes straight through to intel. The browser sends its own token; the companion never adds one.
//
// intel's server is HTTP/1.0 and reads request bodies by Content-Length only, so bodies are buffered and
// sent with a length (a chunked body would arrive as {}). Responses stream through unbuffered, and when the
// browser goes away the upstream request is closed too, which stops intel generating an answer or speech.
import http from "node:http";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PipeEventStream } from "./event_stream_keepalive.ts";
import { BodyTooLarge, HopByHopHeaders, ReadBody, SendJson } from "./http_util.ts";

/** Set on a 502 when intel itself can't be reached, so the UI can tell that apart from the companion being gone. */
export const UpstreamHeader = "X-Intel-WebUI-Upstream";

const ForwardedRequestHeaders = ["authorization", "content-type", "accept"];

export interface UpstreamCall {
  method: string;
  path: string;
  headers: http.OutgoingHttpHeaders;
  body: Buffer;
}

/** Starts a request to intel. agent:false: the global agent has a 5 s idle timeout, and intel closes every connection anyway. */
export function RequestUpstream(upstream: URL, call: UpstreamCall): http.ClientRequest {
  const transport = upstream.protocol === "https:" ? https : http;
  const request = transport.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
    method: call.method,
    path: call.path,
    headers: { ...call.headers, host: upstream.host, "content-length": String(call.body.length) },
    agent: false,
  });
  request.end(call.body);
  return request;
}

/** The headers the browser sent that intel needs. */
export function ForwardedHeaders(req: IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const name of ForwardedRequestHeaders) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}

export function UnreachableMessage(upstream: URL, error: Error): string {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ECONNREFUSED" ? `nothing is listening at ${upstream.origin}` : `${error.message} (${upstream.origin})`;
}

function ResponseHeaders(upRes: IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(upRes.headers)) {
    if (value !== undefined && !HopByHopHeaders.has(name)) headers[name] = value;
  }
  return headers;
}

export interface ProxyOptions {
  keepAliveMs: number;
}

export async function ProxyApi(req: IncomingMessage, res: ServerResponse, upstream: URL,
                               options: ProxyOptions): Promise<void> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "POST") {
    SendJson(res, 405, { error: `intel's API only takes GET and POST, not ${method}` }, { Allow: "GET, POST" });
    return;
  }
  let body: Buffer;
  try {
    body = method === "POST" ? await ReadBody(req) : Buffer.alloc(0);
  } catch (error) {
    if (error instanceof BodyTooLarge) SendJson(res, 413, { error: error.message });
    else res.destroy();
    return;
  }
  if (res.destroyed) return;

  const upReq = RequestUpstream(upstream, { method, path: req.url ?? "/", headers: ForwardedHeaders(req), body });
  res.on("close", () => {
    if (!res.writableFinished) upReq.destroy();
  });
  upReq.on("error", (error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    SendJson(res, 502, { error: UnreachableMessage(upstream, error) }, { [UpstreamHeader]: "unreachable" });
  });
  upReq.on("response", (upRes) => {
    const type = String(upRes.headers["content-type"] ?? "");
    const streaming = type.startsWith("text/event-stream") || type.startsWith("audio/");
    const headers = ResponseHeaders(upRes);
    if (streaming) {
      headers["cache-control"] = "no-cache, no-transform";
      headers["x-content-type-options"] = "nosniff";
    }
    res.writeHead(upRes.statusCode ?? 502, headers);
    upRes.on("error", () => res.destroy());
    if (type.startsWith("text/event-stream")) {
      res.flushHeaders();
      PipeEventStream(upRes, res, options.keepAliveMs);
    } else {
      if (streaming) res.flushHeaders();
      upRes.pipe(res);
    }
  });
}
