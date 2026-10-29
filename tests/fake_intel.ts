// A stand-in intel for working on the UI: answers every route from tests/samples (a fake world, never your
// data), streams the sample answer slowly, reads aloud with a test tone, and can act like an older intel.
//
//   npm run fake-intel -- [--port 8775] [--token fake-token] [--sync-seconds 3] [--old]
//   node server/main.ts --dev --intel-url http://127.0.0.1:8775      (then use the token "fake-token")
import { readFileSync } from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const samples = new URL("./samples/", import.meta.url);

interface Options {
  port: number;
  token: string;
  syncSeconds: number;
  old: boolean;
}

function ParseOptions(argv: string[]): Options {
  const options: Options = { port: 8775, token: "fake-token", syncSeconds: 3, old: false };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--port") options.port = Number(argv[++i]);
    else if (argument === "--token") options.token = String(argv[++i]);
    else if (argument === "--sync-seconds") options.syncSeconds = Number(argv[++i]);
    else if (argument === "--old") options.old = true;
    else throw new Error(`unknown option ${argument}`);
  }
  return options;
}

function Sample(name: string): string {
  return readFileSync(new URL(name, samples), "utf-8");
}

function Delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/** GET and POST routes answered with a sample, in the server's order (first match wins). */
const Routes: [string, RegExp, string][] = [
  ["GET", /^\/api\/status$/, "status.json"],
  ["GET", /^\/api\/sources$/, "sources.json"],
  ["POST", /^\/api\/sources$/, "source_add.json"],
  ["POST", /^\/api\/sources\/\d+\/(enable|disable)$/, "source_toggle.json"],
  ["GET", /^\/api\/brief$/, "brief.json"],
  ["GET", /^\/api\/observations$/, "observations.json"],
  ["POST", /^\/api\/observations\/\d+\/\w+$/, "observation_response.json"],
  ["GET", /^\/api\/events$/, "events.json"],
  ["GET", /^\/api\/proposals$/, "proposals.json"],
  ["GET", /^\/api\/proposals\/group$/, "proposal_group_preview.json"],
  ["POST", /^\/api\/proposals\/group$/, "group_decision.json"],
  ["GET", /^\/api\/proposals\/\d+$/, "proposal_detail.json"],
  ["POST", /^\/api\/proposals\/\d+\/(approve|reject)$/, "decision.json"],
  ["GET", /^\/api\/tasks$/, "tasks.json"],
  ["POST", /^\/api\/tasks\/import$/, "task_import.json"],
  ["GET", /^\/api\/entities$/, "entities.json"],
  ["POST", /^\/api\/entities$/, "entity_add.json"],
  ["GET", /^\/api\/entities\/[^/]+$/, "entity_detail.json"],
  ["POST", /^\/api\/entities\/\d+\/[\w/]+$/, "entity_rename.json"],
  ["GET", /^\/api\/predicates$/, "predicates.json"],
  ["GET", /^\/api\/goals$/, "goals.json"],
  ["POST", /^\/api\/goals$/, "goal_add.json"],
  ["POST", /^\/api\/goals\/\d+\/state$/, "goal_state.json"],
  ["POST", /^\/api\/goals\/\d+$/, "goal_update.json"],
  ["POST", /^\/api\/relationships(\/\d+\/\w+)?$/, "relationship.json"],
  ["POST", /^\/api\/ask$/, "ask.json"],
  ["GET", /^\/api\/llm\/models$/, "llm_models.json"],
  ["POST", /^\/api\/llm\/model$/, "llm_model.json"],
  ["GET", /^\/api\/personas$/, "personas.json"],
  ["POST", /^\/api\/personas(\/\d+(\/delete)?|\/choose)?$/, "personas.json"],
];

/** What an intel from before sources, goals, personas, the feed and streaming didn't have. */
const NewerRoutes = [/^\/api\/sources/, /^\/api\/goals/, /^\/api\/personas/, /^\/api\/events$/, /\/stream$/];

async function StreamAnswer(res: ServerResponse): Promise<void> {
  await Delay(1500);                                   // the model reads what it found
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const block of Sample("ask_stream.txt").split("\n\n").filter((part) => part.trim())) {
    if (res.destroyed) return;
    res.write(block + "\n\n");
    await Delay(block.startsWith("event: delta") ? 60 : 400);
  }
  res.end();
}

/** A WAV with an open-ended length, then a gentle two-note tone while it's "generated". */
async function StreamSpeech(res: ServerResponse): Promise<void> {
  const rate = 24_000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(0xffffffff, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(0xffffffff, 40);
  await Delay(500);
  res.writeHead(200, { "Content-Type": "audio/wav", "Cache-Control": "no-cache" });
  res.write(header);
  const pieceFrames = rate / 10;
  for (let piece = 0; piece < 20 && !res.destroyed; piece++) {
    const samples = Buffer.alloc(pieceFrames * 2);
    for (let i = 0; i < pieceFrames; i++) {
      const t = (piece * pieceFrames + i) / rate;
      const frequency = t < 1 ? 440 : 554.37;
      const envelope = Math.min(1, t * 20, (2 - t) * 20);
      samples.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * t) * 6000 * envelope), i * 2);
    }
    res.write(samples);
    await Delay(70);
  }
  res.end();
}

async function Handle(req: IncomingMessage, res: ServerResponse, options: Options): Promise<void> {
  const path = new URL(req.url ?? "/", "http://placeholder").pathname;
  const method = req.method ?? "GET";
  for await (const _ of req) {
    // read the body; this fake doesn't look at it
  }
  if (path === "/api/health") return Send(res, 200, Sample("health.json"));
  if (req.headers.authorization !== `Bearer ${options.token}`) {
    return Send(res, 401, JSON.stringify({ error: "missing or wrong token (see `intel api token`)" }));
  }
  if (options.old && NewerRoutes.some((pattern) => pattern.test(path))) {
    return Send(res, 404, JSON.stringify({ error: `no route for ${method} ${path}` }));
  }
  if (method === "POST" && path === "/api/ask/stream") return StreamAnswer(res);
  if (method === "POST" && path === "/api/speak/stream") return StreamSpeech(res);
  if (method === "POST" && path === "/api/sync") {
    await Delay(options.syncSeconds * 1000);
    return Send(res, 200, Sample("sync.json"));
  }
  for (const [routeMethod, pattern, sample] of Routes) {
    if (routeMethod === method && pattern.test(path)) return Send(res, 200, Sample(sample));
  }
  Send(res, 404, JSON.stringify({ error: `no route for ${method} ${path}` }));
}

const options = ParseOptions(process.argv.slice(2));
http.createServer((req, res) => {
  Handle(req, res, options).catch((error: unknown) => Send(res, 500, JSON.stringify({ error: String(error) })));
}).listen(options.port, "127.0.0.1", () => {
  process.stdout.write(`fake intel at http://127.0.0.1:${options.port} (token "${options.token}")${options.old ? ", acting old" : ""}\n`);
});
