// A raw fake intel (HTTP/1.0, bodies read by Content-Length, responses ended by closing, like the real one)
// and a companion in front of it.
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { CreateCompanion, type Companion, type CompanionOptions } from "../../server/companion.ts";

export interface UpstreamRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  socket: net.Socket;
}

export interface Upstream {
  port: number;
  requests: UpstreamRequest[];
  Close(): Promise<void>;
}

/** A server that hands each parsed request (head plus Content-Length body) to `handle` with its raw socket. */
export async function StartUpstream(handle: (request: UpstreamRequest) => void): Promise<Upstream> {
  const requests: UpstreamRequest[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0);
    let parsed = false;
    socket.on("data", (chunk: Buffer) => {
      if (parsed) return;
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const [requestLine = "", ...lines] = buffer.subarray(0, end).toString("latin1").split("\r\n");
      const headers: Record<string, string> = {};
      for (const line of lines) {
        const colon = line.indexOf(":");
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      const length = Number(headers["content-length"] ?? 0);
      if (buffer.length < end + 4 + length) return;
      parsed = true;
      const [method = "", path = ""] = requestLine.split(" ");
      const request = { method, path, headers, body: buffer.subarray(end + 4, end + 4 + length).toString("utf-8"), socket };
      requests.push(request);
      handle(request);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    Close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function JsonResponse(socket: net.Socket, status: number, payload: unknown): void {
  socket.end(`HTTP/1.0 ${status} X\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}`);
}

export interface Running {
  companion: Companion;
  port: number;
  Close(): Promise<void>;
}

export async function StartCompanion(upstreamPort: number, options: Partial<CompanionOptions> = {}): Promise<Running> {
  const companion = await CreateCompanion({
    upstream: new URL(`http://127.0.0.1:${upstreamPort}`),
    root: process.cwd(),
    distDir: options.distDir ?? "/nonexistent",
    keepAliveMs: 15_000,
    heartbeatMs: 15_000,
    ...options,
  });
  await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
  const port = (companion.server.address() as AddressInfo).port;
  return { companion, port, Close: () => companion.Close() };
}

export interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A request to the companion; `onData` sees each piece as it arrives. */
export function Call(port: number, path: string, options: {
  method?: string; headers?: Record<string, string>; body?: string; onData?: (piece: string, request: http.ClientRequest) => void;
} = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers, agent: false },
      (response) => {
        let body = "";
        response.setEncoding("utf-8");
        response.on("data", (piece: string) => {
          body += piece;
          options.onData?.(piece, request);
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
        response.on("error", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
        response.on("aborted", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      });
    request.on("error", reject);
    request.end(options.body);
  });
}

export function Delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function Closed(socket: net.Socket, withinMs: number): Promise<boolean> {
  if (socket.destroyed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), withinMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
