// A fetch that answers from tests/samples, for client tests.
import { readFileSync } from "node:fs";

export function Sample(name: string): string {
  return readFileSync(new URL(`./samples/${name}`, import.meta.url), "utf-8");
}

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Answer = Response | ((call: Recorded) => Response | Promise<Response>);

/** A fetcher answering "METHOD /path" (path without the query) from `routes`; records every call. */
export function SampleFetch(routes: Record<string, Answer>): { fetcher: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    const key = `${call.method} ${url.split("?")[0]}`;
    const answer = routes[key];
    if (!answer) return Json({ error: `no route for ${key}` }, 404);
    return typeof answer === "function" ? answer(call) : answer.clone();
  }) as typeof fetch;
  return { fetcher, calls };
}

export function Json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function FromSample(name: string, status = 200): Response {
  return new Response(Sample(name), { status, headers: { "Content-Type": "application/json" } });
}

export function EventStream(text: string, pieceSize = 50): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + pieceSize));
      offset += pieceSize;
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
