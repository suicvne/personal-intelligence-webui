// Optional: reads every read-only route of a running intel through the web client, checking each response
// has the shape the screens expect (the SwiftUI app's live tests). Prints counts only, never your data.
// Asks one question without the model (retrieval only) to check the stream.
//
//   npm run live-check                    (token from `intel api token`, intel at http://127.0.0.1:8765)
//   INTEL_LIVE_TOKEN=… INTEL_LIVE_URL=… npm run live-check
import assert from "node:assert/strict";
import { IntelClient } from "../src/api/intel_client.ts";
import { Days } from "../src/lib/activity_feed.ts";
import { ApiToken, FindIntel, RunCommand } from "../server/intel_cli.ts";

async function Token(): Promise<string> {
  if (process.env.INTEL_LIVE_TOKEN) return process.env.INTEL_LIVE_TOKEN;
  const intel = FindIntel();
  if (!intel) throw new Error("Set INTEL_LIVE_TOKEN, or install intel so `intel api token` works.");
  return ApiToken(intel, RunCommand);
}

async function Main(): Promise<void> {
  const client = new IntelClient({ token: await Token(), baseUrl: process.env.INTEL_LIVE_URL ?? "http://127.0.0.1:8765" });
  const Check = async (name: string, run: () => Promise<string>): Promise<void> => {
    try {
      process.stdout.write(`ok   ${name}: ${await run()}\n`);
    } catch (error) {
      process.exitCode = 1;
      process.stdout.write(`FAIL ${name}: ${(error as Error).message}\n`);
    }
  };
  await Check("status", async () => {
    const status = await client.Status();
    assert.ok(Array.isArray(status.sources) && typeof status.needs_attention === "number");
    return `intel ${status.version}, ${status.sources.length} sources, ${status.pending_proposals} proposals`;
  });
  await Check("brief", async () => `${(await client.Brief()).observations.length} observations`);
  await Check("observations", async () => `${(await client.Observations(true)).length}`);
  await Check("proposals", async () => {
    const overview = await client.Proposals();
    const first = overview.groups[0]?.proposals[0];
    if (first) {
      const detail = await client.Proposal(first.id);
      assert.equal(typeof detail.fields, "object");
      assert.ok(Array.isArray(await client.PreviewGroup(overview.groups[0]!.name)));
    }
    return `${overview.total} in ${overview.groups.length} groups, ${overview.predicates.length} predicates`;
  });
  await Check("tasks", async () => `${(await client.Tasks({ includeClosed: true })).length}`);
  await Check("events", async () => {
    const page = await client.Events({ limit: 50 });
    if (page.next_before !== null) {
      const earlier = await client.Events({ limit: 50, before: page.next_before });
      const ids = new Set(page.events.map((event) => event.id));
      assert.ok(earlier.events.every((event) => !ids.has(event.id)), "pages overlap");
    }
    const folded = Days(page.events).flatMap((day) => day.runs).reduce((count, run) => count + run.events.length, 0);
    assert.equal(folded, page.events.length, "folding lost events");
    return `${page.events.length} on the first page`;
  });
  await Check("entities", async () => {
    let shown = 0;
    for (const type of ["project", "component", "repository"]) {
      const first = (await client.Entities(type))[0];
      if (first) {
        const detail = await client.Entity(first.id);
        assert.ok(Array.isArray(detail.names) && Array.isArray(detail.relationships));
        shown += 1;
      }
    }
    return `${(await client.Entities()).length} in all, ${shown} details read`;
  });
  await Check("predicates", async () => `${(await client.Predicates()).length}`);
  await Check("goals", async () => `${(await client.Goals(true)).length}`);
  await Check("sources", async () => `${(await client.Sources()).length}`);
  await Check("llm models", async () => {
    const models = await client.LlmModels();
    return models.enabled ? `${models.available.length} available${models.error ? ` (${models.error})` : ""}` : "LLM disabled";
  });
  await Check("personas", async () => `${(await client.Personas()).personas.length}`);
  await Check("ask stream (retrieval only)", async () => {
    const kinds: string[] = [];
    for await (const event of client.AskStream("What changed recently?", false)) kinds.push(event.kind);
    assert.equal(kinds[kinds.length - 1], "answer");
    return kinds.join(", ");
  });
}

await Main();
