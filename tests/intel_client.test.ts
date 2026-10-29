// The client's transport: request shapes, errors in the SwiftUI app's words, streams and cancelling.
import { describe, expect, test } from "vitest";
import { IntelClient, UpstreamHeader } from "../src/api/intel_client.ts";
import { IntelError, IsCancel } from "../src/api/intel_error.ts";
import type { AskEvent } from "../src/api/models.ts";
import { EventStream, FromSample, Json, Sample, SampleFetch } from "./sample_fetch.ts";

async function Failure(call: Promise<unknown>): Promise<IntelError> {
  try {
    await call;
  } catch (error) {
    expect(error).toBeInstanceOf(IntelError);
    return error as IntelError;
  }
  throw new Error("expected a failure");
}

async function Drain<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

describe("requests", () => {
  test("sends the token, snake_case keys, and leaves out what isn't set", async () => {
    const { fetcher, calls } = SampleFetch({
      "POST /api/goals/3": FromSample("goal_update.json"),
      "POST /api/proposals/4/approve": FromSample("decision.json"),
      "POST /api/ask": FromSample("ask.json"),
      "GET /api/events": FromSample("events.json"),
    });
    const client = new IntelClient({ token: "secret", fetcher });
    await client.UpdateGoal(3, 2, null, ["7"]);
    await client.Decide(4, "approve", { edits: { predicate: "USES" } });
    await client.Ask("What changed?", false);
    await client.Events({ layer: "source", before: 40 });
    expect(calls.map((call) => call.headers.authorization)).toEqual(Array(4).fill("Bearer secret"));
    expect(calls[0]!.body).toEqual({ prioritizes: ["7"], priority: 2 });          // no target_date: cleared
    expect(calls[1]!.body).toEqual({ rename: false, edits: { predicate: "USES" } });
    expect(calls[2]!.body).toEqual({ question: "What changed?", use_llm: false });
    expect(calls[3]!.url).toBe("/api/events?before=40&layer=source&limit=100");
  });

  test("escapes entity references", async () => {
    const { fetcher, calls } = SampleFetch({});
    await new IntelClient({ token: "t", fetcher }).Entity("repository:a/b").catch(() => undefined);
    expect(calls[0]!.url).toBe("/api/entities/repository%3Aa%2Fb");
  });
});

describe("errors", () => {
  test("in the SwiftUI app's words", async () => {
    const { fetcher } = SampleFetch({
      "GET /api/status": Json({ error: "missing or wrong token (see `intel api token`)" }, 401),
      "GET /api/brief": Json({ error: "connect ECONNREFUSED" }, 502, { [UpstreamHeader]: "unreachable" }),
      "GET /api/tasks": new Response("not json", { status: 200 }),
      "GET /api/predicates": Json({ error: "no route for GET /api/predicates" }, 404),
      "GET /api/entities/9": Json({ error: "no entity 9" }, 404),
    });
    const client = new IntelClient({ token: "t", fetcher });
    expect((await Failure(client.Status())).message).toBe("The token was refused. Run `intel api token` and paste it in Settings.");
    expect((await Failure(client.Brief())).message)
      .toBe("Can't reach intel: connect ECONNREFUSED. Is the background service running? (intel service status)");
    expect((await Failure(client.Tasks())).kind).toBe("invalidResponse");
    expect((await Failure(client.Predicates())).message)
      .toBe("This intel can't do that yet (no route for GET /api/predicates). Restart its background service.");
    expect((await Failure(client.Entity(9))).message).toBe("no entity 9");
    expect((await Failure(client.Sources())).message).toBe("This intel can't manage sources yet. Restart its background service.");
    expect((await Failure(client.Goals())).message).toBe("This intel can't manage goals yet. Restart its background service.");
  });

  test("the companion itself gone", async () => {
    const fetcher = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const error = await Failure(new IntelClient({ token: "t", fetcher }).Status());
    expect(error.kind).toBe("companion");
  });

  test("cancelling is not a failure", async () => {
    const controller = new AbortController();
    const fetcher = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch;
    const call = new IntelClient({ token: "t", fetcher, signal: controller.signal }).Status();
    controller.abort();
    await expect(call).rejects.toSatisfy(IsCancel);
  });
});

describe("streams", () => {
  test("streams an answer", async () => {
    const { fetcher } = SampleFetch({ "POST /api/ask/stream": () => EventStream(Sample("ask_stream.txt"), 13) });
    const events = await Drain(new IntelClient({ token: "t", fetcher }).AskStream("q"));
    expect(events[0]!.kind).toBe("lookup");
    expect(events[events.length - 1]!.kind).toBe("answer");
  });

  test("a stream that ends before the answer is a failure", async () => {
    const { fetcher } = SampleFetch({ "POST /api/ask/stream": () => EventStream("event: delta\ndata: {\"text\": \"Cra\"}\n\n") });
    const error = await Failure(Drain(new IntelClient({ token: "t", fetcher }).AskStream("q")));
    expect(error.message).toContain("the connection closed before the answer was complete");
  });

  test("an error event mid-stream", async () => {
    const { fetcher } = SampleFetch({
      "POST /api/ask/stream": () => EventStream("event: delta\ndata: {\"text\": \"a\"}\n\nevent: error\ndata: {\"error\": \"internal error: boom\", \"status\": 500}\n\n"),
    });
    const error = await Failure(Drain(new IntelClient({ token: "t", fetcher }).AskStream("q")));
    expect(error.message).toBe("internal error: boom");
    expect(error.status).toBe(500);
  });

  test("an intel from before streaming is asked plainly", async () => {
    const { fetcher, calls } = SampleFetch({ "POST /api/ask": FromSample("ask.json") });
    const events: AskEvent[] = await Drain(new IntelClient({ token: "t", fetcher }).AskStream("q"));
    expect(events.map((event) => event.kind)).toEqual(["answer"]);
    expect(calls.map((call) => call.url)).toEqual(["/api/ask/stream", "/api/ask"]);
  });

  test("speech arrives in pieces; an older intel says it can't", async () => {
    const audio = new Uint8Array(25_000).fill(7);
    const { fetcher } = SampleFetch({ "POST /api/speak/stream": () => new Response(audio, { headers: { "Content-Type": "audio/wav" } }) });
    const pieces = await Drain(new IntelClient({ token: "t", fetcher }).SpeechStream("Hello"));
    expect(pieces.reduce((size, piece) => size + piece.length, 0)).toBe(25_000);
    expect(pieces.slice(0, -1).every((piece) => piece.length >= 9_600)).toBe(true);
    const old = SampleFetch({});
    const error = await Failure(Drain(new IntelClient({ token: "t", fetcher: old.fetcher }).SpeechStream("Hello")));
    expect(error.message).toBe("This intel can't read aloud while it generates speech yet. Restart its background service.");
  });

  test("sync waits through the companion's heartbeat", async () => {
    const { fetcher, calls } = SampleFetch({
      "POST /local/sync": () => EventStream(`: waiting\n\n: waiting\n\nevent: result\ndata: {"status": 200, "body": ${JSON.stringify(JSON.parse(Sample("sync_source.json")))}}\n\n`, 7),
    });
    const result = await new IntelClient({ token: "t", fetcher }).Sync(["crawler-notes"]);
    expect(result.lines.length).toBe(1);
    expect(calls[0]!.body).toEqual({ sources: ["crawler-notes"] });
    expect(calls[0]!.headers["x-intel-webui"]).toBe("1");
  });

  test("sync failures keep intel's words", async () => {
    const busy = SampleFetch({
      "POST /local/sync": () => EventStream(`event: result\ndata: {"status": 409, "body": {"error": "another sync is running"}}\n\n`),
    });
    expect((await Failure(new IntelClient({ token: "t", fetcher: busy.fetcher }).Sync())).message).toBe("another sync is running");
    const down = SampleFetch({
      "POST /local/sync": () => EventStream(`event: result\ndata: {"status": 502, "unreachable": "nothing is listening at http://127.0.0.1:8765"}\n\n`),
    });
    expect((await Failure(new IntelClient({ token: "t", fetcher: down.fetcher }).Sync())).kind).toBe("unreachable");
  });
});
