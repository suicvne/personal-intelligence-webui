// Server-sent events (text/event-stream), as intel's streaming routes send them: `event: <name>`,
// `data: <JSON>`, then a blank line to end the event. intel streams over POST, so EventSource can't be
// used; the response body is read here instead.

export interface ServerSentEvent {
  name: string;
  data: string;
}

/** Turns an event stream's lines into events. Feed it every line, the blank ones included. */
export class ServerSentEventParser {
  private name = "";
  private data: string[] = [];

  /** The event this line completes, if any. */
  Feed(line: string): ServerSentEvent | null {
    if (line === "") return this.Dispatch();
    if (line.startsWith(":")) return null;          // a comment (keep-alive)
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.name = value;
    else if (field === "data") this.data.push(value);
    // id and retry: not used by intel
    return null;
  }

  /** The last event, when the stream ended without the blank line after it. */
  Finish(): ServerSentEvent | null {
    return this.Dispatch();
  }

  /** Every event in a whole stream's text (for tests and samples). */
  static Events(text: string): ServerSentEvent[] {
    const parser = new ServerSentEventParser();
    const events: ServerSentEvent[] = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      const event = parser.Feed(line);
      if (event) events.push(event);
    }
    const last = parser.Finish();
    if (last) events.push(last);
    return events;
  }

  private Dispatch(): ServerSentEvent | null {
    const event = this.data.length === 0 ? null : { name: this.name || "message", data: this.data.join("\n") };
    this.name = "";
    this.data = [];
    return event;
  }
}

/** Splits bytes into lines (\n, with a trailing \r removed), keeping a partial line until the rest arrives. */
export class LineSplitter {
  private decoder = new TextDecoder("utf-8");
  private partial = "";

  Feed(chunk: Uint8Array): string[] {
    this.partial += this.decoder.decode(chunk, { stream: true });
    const lines = this.partial.split("\n");
    this.partial = lines.pop() ?? "";
    return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  }

  /** What's left once the stream ended. */
  Finish(): string[] {
    this.partial += this.decoder.decode();
    const rest = this.partial;
    this.partial = "";
    return rest === "" ? [] : [rest.endsWith("\r") ? rest.slice(0, -1) : rest];
  }
}

/** The events in a response body, as they arrive. */
export async function* ReadEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  const parser = new ServerSentEventParser();
  const splitter = new LineSplitter();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of splitter.Feed(value)) {
        const event = parser.Feed(line);
        if (event) yield event;
      }
    }
    for (const line of splitter.Finish()) {
      const event = parser.Feed(line);
      if (event) yield event;
    }
    const last = parser.Finish();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}
