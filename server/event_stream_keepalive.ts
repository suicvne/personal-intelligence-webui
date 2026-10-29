// Keeps a quiet server-sent event stream alive. A model can think for a long time without sending anything,
// and some browsers give up on a response that is silent for minutes. A comment line is only inserted
// between events, never inside one.
import type { IncomingMessage, ServerResponse } from "node:http";

export const KeepAliveComment = ": keep-alive\n\n";

/** Tracks whether the bytes forwarded so far end between two events (a blank line). */
export class EventBoundary {
  private tail = "";
  private seen = false;

  Feed(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.seen = true;
    const end = Buffer.from(chunk.subarray(Math.max(0, chunk.length - 4))).toString("latin1");
    this.tail = (this.tail + end).slice(-4);
  }

  /** True before anything was sent, or right after an event's closing blank line. */
  get atBoundary(): boolean {
    if (!this.seen) return true;
    return this.tail.endsWith("\n\n") || this.tail.endsWith("\r\n\r\n") || this.tail.endsWith("\r\r");
  }
}

/** Forwards an event stream, writing a keep-alive comment after `quietMs` without data at an event boundary. */
export function PipeEventStream(source: IncomingMessage, res: ServerResponse, quietMs: number): void {
  const boundary = new EventBoundary();
  let timer: NodeJS.Timeout | undefined;
  const Arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (boundary.atBoundary && !res.writableEnded) res.write(KeepAliveComment);
      Arm();
    }, quietMs);
  };
  const Stop = (): void => clearTimeout(timer);
  source.on("data", (chunk: Buffer) => {
    boundary.Feed(chunk);
    if (!res.write(chunk)) {
      source.pause();
      res.once("drain", () => source.resume());
    }
    Arm();
  });
  source.on("end", () => {
    Stop();
    res.end();
  });
  source.on("error", () => {
    Stop();
    res.destroy();
  });
  res.on("close", Stop);
  Arm();
}
