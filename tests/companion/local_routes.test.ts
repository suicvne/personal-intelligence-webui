// Who may call the companion, the /local/* helpers, and the built UI.
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import type { CommandRunner } from "../../server/intel_cli.ts";
import { OpenPath, OpenerError } from "../../server/opener.ts";
import { Call, Delay, JsonResponse, StartCompanion, StartUpstream, type Running, type Upstream } from "./helpers.ts";

let upstream: Upstream | undefined;
let running: Running | undefined;
let folder = "";

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "intel-webui-"));
  await mkdir(path.join(folder, "dist/assets"), { recursive: true });
  await writeFile(path.join(folder, "dist/index.html"), "<!doctype html><title>Intel</title>");
  await writeFile(path.join(folder, "dist/assets/app.js"), "console.log(1)");
  await writeFile(path.join(folder, "secret.txt"), "not for you");
  await writeFile(path.join(folder, "note.md"), "# A note");
  await writeFile(path.join(folder, "run.command"), "echo hi");
  await writeFile(path.join(folder, "tool"), "#!/bin/sh\n");
  await chmod(path.join(folder, "tool"), 0o755);
  await mkdir(path.join(folder, "Thing.app/Contents"), { recursive: true });
});

afterEach(async () => {
  await running?.Close();
  await upstream?.Close();
  running = undefined;
  upstream = undefined;
});

function Recorder(): { runner: CommandRunner; runs: string[][] } {
  const runs: string[][] = [];
  return {
    runs,
    runner: async (file, args) => {
      runs.push([file, ...args]);
      if (file.endsWith("intel")) return { stdout: "the-token\n", stderr: "", code: 0 };
      if (file.endsWith("osascript")) return { stdout: "/Users/me/Notes/\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

const Local = { "X-Intel-WebUI": "1" };

describe("guards", () => {
  test("only answers to its own name", async () => {
    upstream = await StartUpstream((request) => JsonResponse(request.socket, 200, { ok: true }));
    running = await StartCompanion(upstream.port);
    expect((await Call(running.port, "/api/health", { headers: { Host: `evil.example:${running.port}` } })).status).toBe(403);
    expect((await Call(running.port, "/api/health", { headers: { Host: "127.0.0.1" } })).status).toBe(403);
    expect((await Call(running.port, "/api/health")).status).toBe(200);
    const redirect = await Call(running.port, "/brief?x=1", { headers: { Host: `localhost:${running.port}` } });
    expect(redirect.status).toBe(307);
    expect(redirect.headers.location).toBe(`http://127.0.0.1:${running.port}/brief?x=1`);
    expect(upstream.requests.length).toBe(1);
  });

  test("/local/* is only for this web UI", async () => {
    upstream = await StartUpstream(() => undefined);
    running = await StartCompanion(upstream.port, { platform: "darwin", findIntel: () => "/x/intel", ...Recorder() });
    expect((await Call(running.port, "/local/info")).status).toBe(403);
    expect((await Call(running.port, "/local/info", { headers: { ...Local, Origin: "https://evil.example" } })).status).toBe(403);
    expect((await Call(running.port, "/local/info", { headers: { ...Local, "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    const info = await Call(running.port, "/local/info", {
      headers: { ...Local, Origin: `http://127.0.0.1:${running.port}`, "Sec-Fetch-Site": "same-origin" },
    });
    expect(info.status).toBe(200);
    expect(JSON.parse(info.body)).toEqual({
      platform: "darwin", canOpen: true, canChooseFolder: true, localToken: true, upstream: `http://127.0.0.1:${upstream.port}`,
    });
  });
});

describe("local helpers", () => {
  test("reads the token of the intel on this Mac, unless told not to", async () => {
    upstream = await StartUpstream(() => undefined);
    const recorder = Recorder();
    running = await StartCompanion(upstream.port, { findIntel: () => "/x/intel", runner: recorder.runner });
    const reply = await Call(running.port, "/local/token", { method: "POST", headers: Local });
    expect(JSON.parse(reply.body)).toEqual({ token: "the-token" });
    expect(recorder.runs).toEqual([["/x/intel", "api", "token"]]);
    await running.Close();
    running = await StartCompanion(upstream.port, { findIntel: () => "/x/intel", allowLocalToken: false, runner: recorder.runner });
    expect((await Call(running.port, "/local/token", { method: "POST", headers: Local })).status).toBe(403);
  });

  test("chooses a folder", async () => {
    upstream = await StartUpstream(() => undefined);
    running = await StartCompanion(upstream.port, { platform: "darwin", ...Recorder() });
    const reply = await Call(running.port, "/local/choose-folder", { method: "POST", headers: Local });
    expect(JSON.parse(reply.body)).toEqual({ path: "/Users/me/Notes" });
  });

  test("syncs with a heartbeat while intel works", async () => {
    upstream = await StartUpstream(async ({ socket }) => {
      await Delay(150);
      JsonResponse(socket, 200, { lines: ["crawler-notes: 2 new"], events: 2, entities_created: 0, queued: 1 });
    });
    running = await StartCompanion(upstream.port, { heartbeatMs: 40 });
    const reply = await Call(running.port, "/local/sync", {
      method: "POST", headers: { ...Local, Authorization: "Bearer t" }, body: JSON.stringify({ sources: ["crawler-notes"] }),
    });
    expect(reply.headers["content-type"]).toBe("text/event-stream");
    expect(reply.body.match(/: waiting\n\n/g)!.length).toBeGreaterThanOrEqual(3);
    expect(reply.body.endsWith(`event: result\ndata: {"status":200,"body":{"lines":["crawler-notes: 2 new"],"events":2,"entities_created":0,"queued":1}}\n\n`)).toBe(true);
    expect(upstream.requests[0]!.path).toBe("/api/sync");
    expect(upstream.requests[0]!.headers.authorization).toBe("Bearer t");
    expect(upstream.requests[0]!.body).toBe("{\"sources\":[\"crawler-notes\"]}");
  });
});

describe("opener", () => {
  test("opens notes and folders, but only shows what would run", async () => {
    const { runner, runs } = Recorder();
    expect(await OpenPath(path.join(folder, "note.md"), false, runner, "darwin")).toEqual({ revealed: false });
    expect(await OpenPath(folder, false, runner, "darwin")).toEqual({ revealed: false });
    expect(await OpenPath(path.join(folder, "run.command"), false, runner, "darwin")).toEqual({ revealed: true });
    expect(await OpenPath(path.join(folder, "tool"), false, runner, "darwin")).toEqual({ revealed: true });
    expect(await OpenPath(path.join(folder, "Thing.app"), false, runner, "darwin")).toEqual({ revealed: true });
    expect(await OpenPath(path.join(folder, "note.md"), true, runner, "darwin")).toEqual({ revealed: false });
    const real = await realpath(folder);
    expect(runs).toEqual([
      ["/usr/bin/open", path.join(real, "note.md")],
      ["/usr/bin/open", real],
      ["/usr/bin/open", "-R", path.join(real, "run.command")],
      ["/usr/bin/open", "-R", path.join(real, "tool")],
      ["/usr/bin/open", "-R", path.join(real, "Thing.app")],
      ["/usr/bin/open", "-R", path.join(real, "note.md")],
    ]);
    await expect(OpenPath("relative/note.md", false, runner, "darwin")).rejects.toMatchObject({ status: 400 });
    await expect(OpenPath(path.join(folder, "missing.md"), false, runner, "darwin")).rejects.toMatchObject({ status: 404 });
    await expect(OpenPath(path.join(folder, "note.md"), false, runner, "linux")).rejects.toBeInstanceOf(OpenerError);
  });
});

describe("static files", () => {
  test("serves the built UI, falls back for pages, and stays inside dist", async () => {
    upstream = await StartUpstream(() => undefined);
    running = await StartCompanion(upstream.port, { distDir: path.join(folder, "dist") });
    const page = await Call(running.port, "/proposals/3", { headers: { Accept: "text/html" } });
    expect(page.status).toBe(200);
    expect(page.body).toContain("<title>Intel</title>");
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    const asset = await Call(running.port, "/assets/app.js");
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect((await Call(running.port, "/assets/missing.js")).status).toBe(404);
    expect((await Call(running.port, "/..%2fsecret.txt")).status).toBe(404);
    expect((await Call(running.port, "/%2e%2e/secret.txt")).status).toBe(404);
  });
});
