// What went wrong talking to intel, in words the screens can show as they are (the SwiftUI app's IntelError).

export type IntelErrorKind =
  | "server"          // intel answered with an error
  | "unreachable"     // intel couldn't be reached (the companion said so, or the connection broke)
  | "companion"       // the web UI's own server is gone
  | "invalidResponse";

export class IntelError extends Error {
  readonly kind: IntelErrorKind;
  readonly status: number | null;

  constructor(kind: IntelErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "IntelError";
    this.kind = kind;
    this.status = status;
  }

  static Server(status: number, message: string): IntelError {
    const shown = status === 401 ? "The token was refused. Run `intel api token` and paste it in Settings." : message;
    return new IntelError("server", shown, status);
  }

  static Unreachable(message: string): IntelError {
    return new IntelError("unreachable",
      `Can't reach intel: ${message}. Is the background service running? (intel service status)`);
  }

  static Companion(message: string): IntelError {
    return new IntelError("companion", `Can't reach the web UI's server (${message}). Is \`npm start\` still running?`);
  }

  static InvalidResponse(): IntelError {
    return new IntelError("invalidResponse",
      "intel sent a response this app doesn't understand. Are the app and intel the same version?");
  }

  /** A 404 from an intel older than the app: its service runs the old code until it restarts. */
  static Outdated(ability: string): IntelError {
    return IntelError.Server(404, `This intel can't ${ability} yet. Restart its background service.`);
  }

  /** The error for a failed response: the server's {"error": …} message. */
  static FromFailure(status: number, body: string): IntelError {
    let message = `HTTP ${status}`;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {
      // not JSON: keep the status
    }
    if (status === 404 && message.startsWith("no route for ")) {   // an intel older than the app
      return IntelError.Server(404, `This intel can't do that yet (${message}). Restart its background service.`);
    }
    return IntelError.Server(status, message);
  }

  get isClientError(): boolean {
    return this.kind === "server" && this.status !== null && this.status >= 400 && this.status < 500;
  }
}

/** True when this "error" is a cancellation: someone stopped the request, so there's nothing to report. */
export function IsCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function IsStatus(error: unknown, status: number): boolean {
  return error instanceof IntelError && error.kind === "server" && error.status === status;
}

export function Describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
