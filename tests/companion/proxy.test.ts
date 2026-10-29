// The /api/* pass-through against a fake intel that behaves like the real one.
import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { EventBoundary } from "../../server/event_stream_keepalive.ts";
import { Call, Closed, Delay, JsonResponse, StartCompanion, StartUpstream, type Running, type Upstream } from "./helpers.ts";

let upstream: Upstream | undefined;
let running: Running | undefined;

afterEach(async () => {
  await running?.Close();
  await upstream?.Close();
  running = undefined;
  upstream = undefined;
});

describe("proxy", () => {
  test("forwards the body with a Content-Length, and only the headers intel needs", async () => {
    upstream = await StartUpstream((request) => JsonResponse(request.socket, 200, { lines: ["ok"] }));
    running = await StartCompanion(upstream.port);
    const body = JSON.stringify({ sources: ["crawler-notes"] });
    const reply = await Call(running.port, "/api/sync?x=%2F", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json", Cookie: "c=1", "Transfer-Encoding": "chunked" },
      body,
    });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ lines: ["ok"] });
    const seen = upstream.requests[0]!;
    expect(seen.path).toBe("/api/sync?x=%2F");
    expect(seen.headers["content-length"]).toBe(String(body.length));
    expect(seen.headers["transfer-encoding"]).toBeUndefined();
    expect(seen.headers.authorization).toBe("Bearer t");
    expect(seen.headers.cookie).toBeUndefined();
    expect(seen.body).toBe(body);
  });

  test("streams a response that ends by closing, piece by piece", async () => {
    let secondSentAt = 0;
    upstream = await StartUpstream(async ({ socket }) => {
      socket.write("HTTP/1.0 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n\r\n");
      socket.write("event: delta\ndata: {\"text\": \"a\"}\n\n");
      await Delay(200);
      secondSentAt = Date.now();
      socket.end("event: answer\ndata: {}\n\n");
    });
    running = await StartCompanion(upstream.port);
    let firstAt = 0;
    const reply = await Call(running.port, "/api/ask/stream", {
      method: "POST", body: "{}", onData: () => { firstAt ||= Date.now(); },
    });
    expect(reply.headers["content-type"]).toBe("text/event-stream");
    expect(reply.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(reply.body).toBe("event: delta\ndata: {\"text\": \"a\"}\n\nevent: answer\ndata: {}\n\n");
    expect(firstAt).toBeLessThan(secondSentAt);
  });

  test("closes intel's connection when the browser goes away mid-stream", async () => {
    upstream = await StartUpstream(({ socket }) => {
      socket.write("HTTP/1.0 200 OK\r\nContent-Type: text/event-stream\r\n\r\nevent: delta\ndata: {\"text\": \"a\"}\n\n");
    });
    running = await StartCompanion(upstream.port);
    await Call(running.port, "/api/ask/stream", { method: "POST", body: "{}", onData: (_, request) => request.destroy() })
      .catch(() => undefined);
    await Delay(20);
    expect(await Closed(upstream.requests[0]!.socket, 2000)).toBe(true);
  });

  test("closes intel's connection when the browser goes away before anything arrived", async () => {
    upstream = await StartUpstream(() => undefined);           // the model is thinking
    running = await StartCompanion(upstream.port);
    const request = http.request({ host: "127.0.0.1", port: running.port, path: "/api/ask/stream", method: "POST", agent: false });
    request.on("error", () => undefined);
    request.end("{}");
    while (upstream.requests.length === 0) await Delay(5);
    request.destroy();                                          // the tab closed, or Stop
    expect(await Closed(upstream.requests[0]!.socket, 2000)).toBe(true);
  });

  test("keeps a quiet event stream alive, only between events", async () => {
    upstream = await StartUpstream(async ({ socket }) => {
      socket.write("HTTP/1.0 200 OK\r\nContent-Type: text/event-stream\r\n\r\nevent: delta\ndata: {\"text\": \"a\"}\n");
      await Delay(160);
      socket.write("\n");
      await Delay(160);
      socket.end("event: answer\ndata: {}\n\n");
    });
    running = await StartCompanion(upstream.port, { keepAliveMs: 50 });
    const reply = await Call(running.port, "/api/ask/stream", { method: "POST", body: "{}" });
    expect(reply.body.startsWith("event: delta\ndata: {\"text\": \"a\"}\n\n: keep-alive\n\n")).toBe(true);
    expect(reply.body.endsWith(": keep-alive\n\nevent: answer\ndata: {}\n\n")).toBe(true);
  });

  test("says when intel can't be reached", async () => {
    upstream = await StartUpstream(() => undefined);
    const port = upstream.port;
    await upstream.Close();
    upstream = undefined;
    running = await StartCompanion(port);
    const reply = await Call(running.port, "/api/status");
    expect(reply.status).toBe(502);
    expect(reply.headers["x-intel-webui-upstream"]).toBe("unreachable");
    expect(JSON.parse(reply.body).error).toContain("nothing is listening");
  });

  test("only GET and POST", async () => {
    upstream = await StartUpstream((request) => JsonResponse(request.socket, 200, {}));
    running = await StartCompanion(upstream.port);
    expect((await Call(running.port, "/api/status", { method: "OPTIONS" })).status).toBe(405);
    expect(upstream.requests.length).toBe(0);
  });
});

describe("event boundaries", () => {
  test("tracks where an event ends", () => {
    const boundary = new EventBoundary();
    expect(boundary.atBoundary).toBe(true);
    boundary.Feed(new TextEncoder().encode("event: delta\ndata: x\n"));
    expect(boundary.atBoundary).toBe(false);
    boundary.Feed(new TextEncoder().encode("\n"));
    expect(boundary.atBoundary).toBe(true);
    boundary.Feed(new TextEncoder().encode("data: y\r\n\r\n"));
    expect(boundary.atBoundary).toBe(true);
  });
});
