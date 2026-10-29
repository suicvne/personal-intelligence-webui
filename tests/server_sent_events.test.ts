// Ported from the SwiftUI app's ParsesEventStreams and DecodesAStreamedAnswer.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { AskEventFrom } from "../src/api/intel_client.ts";
import { IntelError } from "../src/api/intel_error.ts";
import type { AnswerView, AskEvent, LookupView } from "../src/api/models.ts";
import { ReadEventStream, ServerSentEventParser, type ServerSentEvent } from "../src/api/server_sent_events.ts";

const sample = readFileSync(new URL("./samples/ask_stream.txt", import.meta.url), "utf-8");

function Stream(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

async function Collect(stream: ReadableStream<Uint8Array>): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  for await (const event of ReadEventStream(stream)) events.push(event);
  return events;
}

describe("server-sent events", () => {
  test("parses event streams", () => {
    const events = ServerSentEventParser.Events(": keep-alive\r\n\r\nevent: delta\r\ndata: {\"text\": \"a\"}\r\n\r\n"
                                                + "data: one\ndata:two\nid: 7\n\nevent: answer\ndata: {}");
    expect(events).toEqual([
      { name: "delta", data: "{\"text\": \"a\"}" },
      { name: "message", data: "one\ntwo" },
      { name: "answer", data: "{}" },
    ]);
    expect(AskEventFrom({ name: "progress", data: "{}" })).toBeNull();
    expect(() => AskEventFrom({ name: "error", data: "{\"error\": \"internal error: boom\", \"status\": 500}" }))
      .toThrow(IntelError);
  });

  test("decodes a streamed answer", () => {
    const events = ServerSentEventParser.Events(sample).map(AskEventFrom).filter((event): event is AskEvent => event !== null);
    let streamed = "";
    const lookups: LookupView[] = [];
    let early: { text: string; spokenText: string } | null = null;
    let final: AnswerView | null = null;
    for (const event of events) {
      if (event.kind === "lookup") {
        expect(streamed).toBe("");                    // before the answer text
        lookups.push(event.lookup);
      } else if (event.kind === "delta") streamed += event.text;
      else if (event.kind === "answerText") early = { text: event.text, spokenText: event.spokenText };
      else final = event.answer;
    }
    expect(final).not.toBeNull();
    const answer = final!;
    expect(events[events.length - 1]!.kind).toBe("answer");
    expect(events.length).toBeGreaterThan(2);
    expect(answer.mode).toBe("llm");
    expect(answer.gaps).toEqual(["No issue data."]);
    expect(streamed).toBe(answer.text);
    expect(streamed).toContain("(\"ui.md\").\nNothing");
    expect(answer.text.endsWith("recorded [R1].")).toBe(true);
    expect(answer.spoken_text.endsWith("recorded.")).toBe(true);
    expect(early).toEqual({ text: answer.text, spokenText: answer.spoken_text });
    expect(lookups).toEqual([{ text: "search_records(since=2026-10-24, until=2026-10-24): 0 records",
                               description: "records changed on 2026-10-24", result: "0 records" }]);
    expect(answer.lookups).toEqual(lookups);
  });

  test("reads a stream in pieces of any size, multibyte characters included", async () => {
    const whole = ServerSentEventParser.Events(sample);
    const bytes = new TextEncoder().encode(sample);
    for (const size of [1, 7, 64]) {
      expect(await Collect(Stream(bytes, size))).toEqual(whole);
    }
    const accented = new TextEncoder().encode("event: delta\ndata: {\"text\": \"café — 🚀\"}\n\n");
    expect(await Collect(Stream(accented, 1))).toEqual([{ name: "delta", data: "{\"text\": \"café — 🚀\"}" }]);
    const unterminated = new TextEncoder().encode("event: answer\r\ndata: {}");
    expect(await Collect(Stream(unterminated, 3))).toEqual([{ name: "answer", data: "{}" }]);
  });

  test("decodes lookups from an older intel", () => {
    const call = "search_records(since=2026-10-24, until=2026-10-24): 11 records";
    const event = AskEventFrom({ name: "lookup", data: JSON.stringify({ text: call }) });
    expect(event).toEqual({ kind: "lookup", lookup: { text: call, description: call, result: null } });
    const plain = AskEventFrom({ name: "lookup", data: JSON.stringify(call) });
    expect(plain).toEqual({ kind: "lookup", lookup: { text: call, description: call, result: null } });
  });
});
