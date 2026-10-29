// Who may talk to the companion. It listens on loopback only; these checks keep web pages from other
// origins out (including DNS rebinding, where a hostile name resolves to 127.0.0.1).
import type { IncomingMessage } from "node:http";

export const LocalHeader = "x-intel-webui";

/** The canonical origin. localhost and 127.0.0.1 are different origins, and the token lives in one of them. */
export function CanonicalOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** True when the Host header names this server on loopback (127.0.0.1 or localhost, with our port). */
export function HostAllowed(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function IsLocalhostName(req: IncomingMessage): boolean {
  return (req.headers.host ?? "").toLowerCase().startsWith("localhost:");
}

/**
 * Why a /local/* request is refused, or null when it's this web UI calling.
 * The custom header forces a CORS preflight for any other origin, which the companion never answers;
 * Origin and Sec-Fetch-Site are checked too when the browser sends them.
 */
export function LocalCallerProblem(req: IncomingMessage, port: number): string | null {
  if (req.headers[LocalHeader] !== "1") return "missing the X-Intel-WebUI header";
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== CanonicalOrigin(port) && origin !== `http://localhost:${port}`) {
    return `requests from ${origin} aren't accepted`;
  }
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") {
    return `${site} requests aren't accepted`;
  }
  return null;
}
