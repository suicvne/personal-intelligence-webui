// Every sample in samples/ is a real response from the intel server, captured from a fake world by
// personal-intelligence/tests/test_server.py (refresh them with `npm run samples`). These are the SwiftUI
// app's decoding_tests, run through the web client.
import { describe, expect, test } from "vitest";
import { IntelClient } from "../src/api/intel_client.ts";
import { SourceFailed } from "../src/api/models.ts";
import { Days } from "../src/lib/activity_feed.ts";
import { FromSample, SampleFetch } from "./sample_fetch.ts";

const { fetcher } = SampleFetch({
  "GET /api/status": FromSample("status.json"),
  "GET /api/health": FromSample("health.json"),
  "GET /api/llm/models": FromSample("llm_models.json"),
  "POST /api/llm/model": FromSample("llm_model.json"),
  "GET /api/brief": FromSample("brief.json"),
  "GET /api/observations": FromSample("observations.json"),
  "POST /api/observations/1/ack": FromSample("observation_response.json"),
  "GET /api/proposals": FromSample("proposals.json"),
  "GET /api/proposals/1": FromSample("proposal_detail.json"),
  "POST /api/proposals/1/approve": FromSample("decision.json"),
  "GET /api/proposals/group": FromSample("proposal_group_preview.json"),
  "POST /api/proposals/group": FromSample("group_decision.json"),
  "GET /api/tasks": FromSample("tasks.json"),
  "POST /api/tasks/import": FromSample("task_import.json"),
  "GET /api/entities": FromSample("entities.json"),
  "GET /api/entities/Crawler": FromSample("entity_detail.json"),
  "POST /api/entities": FromSample("entity_add.json"),
  "POST /api/entities/1/rename": FromSample("entity_rename.json"),
  "GET /api/predicates": FromSample("predicates.json"),
  "POST /api/relationships": FromSample("relationship.json"),
  "POST /api/ask": FromSample("ask.json"),
  "GET /api/sources": FromSample("sources.json"),
  "POST /api/sources": FromSample("source_add.json"),
  "POST /api/sources/1/disable": FromSample("source_toggle.json"),
  "POST /api/goals": FromSample("goal_add.json"),
  "POST /api/goals/1": FromSample("goal_update.json"),
  "POST /api/goals/1/state": FromSample("goal_state.json"),
  "GET /api/goals": FromSample("goals.json"),
  "GET /api/events": FromSample("events.json"),
  "POST /api/personas": FromSample("persona_add.json"),
  "GET /api/personas": FromSample("personas.json"),
});
const client = new IntelClient({ token: "t", fetcher });

describe("decoding real samples", () => {
  test("status and sync", async () => {
    const status = await client.Status();
    expect(status.sources.some((source) => source.name === "3dcrawler" && source.kind === "git")).toBe(true);
    expect(status.entity_counts.project).toBe(1);
    expect(status.needs_attention).toBeLessThanOrEqual(status.open_observations);
    expect((await client.Health()).ok).toBe(true);
  });

  test("LLM models", async () => {
    const models = await client.LlmModels();
    expect(models.enabled && models.error === null).toBe(true);
    expect(models.configured).toBe("test-model");
    expect(models.chosen).toBe("gemma-4-26b-a4b");
    expect(models.current).toBe(models.chosen);
    expect(models.available).toContain("qwen-3.8-27b");
    expect((await client.ChooseLlmModel("gemma-4-26b-a4b")).current).toBe("gemma-4-26b-a4b");
  });

  test("brief and observations", async () => {
    const brief = await client.Brief();
    expect(brief.observations[0]?.entities).toEqual(["Crawler"]);
    expect(brief.observations[0]?.evidence[0]?.kind).toBe("commit");
    expect((await client.Observations()).length).toBeGreaterThan(0);
    expect((await client.RespondToObservation(1, "ack")).status).toBe("acknowledged");
  });

  test("proposals and decisions", async () => {
    const overview = await client.Proposals();
    expect(overview.predicates).toContain("PART_OF");
    expect(overview.groups.some((group) => group.name === "crawler-notes: essay.md" && group.kinds.relationship === 1)).toBe(true);
    const detail = await client.Proposal(1);
    expect(detail.fields).toEqual({ subject: "3dcrawler", predicate: "DESCRIBES", object: "The Pit" });
    expect(detail.evidence[0]?.context).toContain("The World Beneath");
    const decision = await client.Decide(1, "approve");
    expect(decision.proposal.summary).toBe("The Pit PART_OF Crawler");
    expect(decision.also_approved.length).toBe(1);
    expect((await client.PreviewGroup("x")).length).toBe(2);
    expect((await client.DecideGroup("x", "reject")).decision).toBe("reject");
  });

  test("tasks, entities and answers", async () => {
    const tasks = await client.Tasks();
    expect(tasks[0]?.location).toBe("crawler-notes:ui.md:4");
    expect((await client.ImportTasks("R1")).proposed).toBe(1);
    expect((await client.Entities()).some((entity) => entity.name === "Crawler")).toBe(true);
    const crawler = await client.Entity("Crawler");
    expect(crawler.entity.type).toBe("project");
    expect(crawler.identifiers["manifest.file"]).toBeDefined();
    const answer = await client.Ask("what?");
    expect(answer.mode).toBe("retrieval_only");
    expect(answer.spoken_text).toBe(answer.text);
    expect(answer.references.some((reference) => reference.kind === "tasks")).toBe(true);
    expect(answer.lookups).toEqual([]);
  });

  test("sources", async () => {
    const sources = await client.Sources();
    expect(sources.map((source) => source.name)).toEqual(["3dcrawler", "gitlab", "crawler-notes"]);
    const gitlab = sources.find((source) => source.kind === "gitlab")!;
    expect(gitlab.settings).toEqual({ projects: "Axiom/3dcrawler" });
    expect(gitlab.poll_interval_seconds).toBe(300);
    expect(gitlab.discovered_from).toBeNull();
    expect(SourceFailed(gitlab)).toBe(false);
    const added = await client.AddSource({ kind: "filesystem", name: "plans", path: "/x", include: [], include_documents: true,
                                           projects: [], groups: [], verify_tls: true });
    expect(added.name).toBe("plans");
    expect(added.enabled && added.records === 0 && added.last_run === null).toBe(true);
    expect(added.settings).toEqual({ include: "*.md" });
    expect(added.location?.endsWith("/Plans")).toBe(true);
    expect((await client.SetSourceEnabled(1, false)).enabled).toBe(false);
  });

  test("entity corrections", async () => {
    const added = await client.AddEntity("concept", "The Shaft");
    expect(added.entity.name).toBe("The Shaft");
    expect(added.entity.type).toBe("concept");
    expect(added.entity.other_names).toEqual(["shaft"]);
    expect(added.description).toBe("The way down");
    const renamed = await client.RenameEntity(1, "Project Succubi");
    expect(renamed.entity.name).toBe("Project Succubi");
    expect(renamed.names.some((name) => name.name === "Crawler" && name.kind === "former")).toBe(true);
    const predicates = await client.Predicates();
    expect(predicates.some((predicate) => predicate.name === "PART_OF" && predicate.meaning !== "")).toBe(true);
    const relationship = await client.AddRelationship("The Shaft", "PART_OF", "Project Succubi");
    expect([relationship.subject, relationship.predicate, relationship.object, relationship.status])
      .toEqual(["The Shaft", "PART_OF", "Project Succubi", "confirmed"]);
  });

  test("goals", async () => {
    const added = await client.AddGoal("Ship the Crawler demo", ["1"], 1, "2026-11-01");
    expect(added.statement).toBe("Ship the Crawler demo");
    expect(added.priority).toBe(1);
    expect(added.state).toBe("active");
    expect(added.target_date).toBe("2026-11-01");
    expect(added.prioritizes.map((target) => target.type)).toEqual(["project"]);
    expect(added.prioritizes[0]?.last_activity_at).not.toBeNull();
    const updated = await client.UpdateGoal(1, 2, null, ["1", "2"]);
    expect(updated.priority).toBe(2);
    expect(updated.target_date).toBeNull();
    expect(updated.prioritizes.length).toBe(2);
    expect((await client.SetGoalState(1, "achieved")).state).toBe("achieved");
    expect((await client.Goals()).map((goal) => goal.id)).toEqual([added.id]);
  });

  test("the activity feed", async () => {
    const page = await client.Events();
    expect(page.next_before).toBe(page.events[page.events.length - 1]?.id);
    const created = page.events.find((event) => event.summary === "Created project 'Crawler'")!;
    expect([created.layer, created.entity, created.entity_type, created.origin, created.source])
      .toEqual(["semantic", "Crawler", "project", "source", null]);
    const issue = page.events.find((event) => event.type === "issue.created")!;
    expect(issue.source).toBe("gitlab");
    expect(issue.uri?.endsWith("/-/issues/1")).toBe(true);
    expect(issue.record_id).not.toBeNull();
    expect(Days(page.events).flatMap((day) => day.runs).reduce((count, run) => count + run.events.length, 0))
      .toBe(page.events.length);
  });

  test("personas", async () => {
    const added = await client.AddPersona("Flirty", "", "");
    expect(added.chosen).toBeNull();
    expect(added.personas.map((persona) => persona.name)).toEqual(["Flirty"]);
    const chosen = await client.Personas();
    expect(chosen.chosen).toBe(chosen.personas[0]?.id);
    expect(chosen.personas[0]?.voice).toBe("Breathy.");
    expect(chosen.configured_style).toBe("");
    expect(chosen.configured_voice).not.toBe("");
  });
});
