// Serves the built UI from dist/. Page URLs (/proposals/12) fall back to index.html for the client router.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { SendText } from "./http_util.ts";

const MimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** The file under distDir that a URL path names, or null when it would escape distDir. */
export function ResolveInside(distDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const root = path.resolve(distDir);
  const resolved = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function LooksLikePage(req: IncomingMessage, urlPath: string): boolean {
  const last = urlPath.split("/").pop() ?? "";
  return !last.includes(".") && (req.headers.accept ?? "").includes("text/html");
}

async function IsFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function SendFile(req: IncomingMessage, res: ServerResponse, file: string, headers: Record<string, string>): void {
  const type = MimeTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, ...headers });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

export async function ServeStatic(req: IncomingMessage, res: ServerResponse, distDir: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    SendText(res, 405, "Method not allowed");
    return;
  }
  const urlPath = new URL(req.url ?? "/", "http://placeholder").pathname;
  const index = path.join(distDir, "index.html");
  if (!(await IsFile(index))) {
    SendText(res, 503, "The web UI isn't built yet. Run `npm run build`, or `npm run dev` while working on it.");
    return;
  }
  const page = { "Cache-Control": "no-cache", "Content-Security-Policy": ContentSecurityPolicy };
  if (urlPath === "/" || urlPath === "/index.html") {
    SendFile(req, res, index, page);
    return;
  }
  const file = ResolveInside(distDir, urlPath);
  if (file === null) {
    SendText(res, 404, "Not found");
    return;
  }
  if (await IsFile(file)) {
    const immutable = urlPath.startsWith("/assets/");
    SendFile(req, res, file, { "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
    return;
  }
  if (LooksLikePage(req, urlPath)) {
    SendFile(req, res, index, page);
    return;
  }
  SendText(res, 404, "Not found");
}
