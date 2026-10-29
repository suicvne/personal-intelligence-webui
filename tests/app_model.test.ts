// The shared state's rules for problems: the banner for failures to talk to intel, the form for intel
// refusing a form's values, nothing for a cancelled call (the SwiftUI app's AppModel).
import { describe, expect, test } from "vitest";
import { IntelError } from "../src/api/intel_error.ts";
import { AppModel } from "../src/state/app_model.ts";
import { EventStream, FromSample, Json, SampleFetch } from "./sample_fetch.ts";

function Model(routes: Parameters<typeof SampleFetch>[0], token = "t"): AppModel {
  return new AppModel({
    token, fetcher: SampleFetch(routes).fetcher, saveToken: () => undefined,
    loadLocalInfo: () => Promise.reject(new Error("no companion in tests")),
  });
}

describe("AppModel", () => {
  test("a failure shows in the banner until the next success", async () => {
    const model = Model({
      "GET /api/brief": Json({ error: "internal error: boom" }, 500),
      "GET /api/status": FromSample("status.json"),
    });
    expect(await model.Run((client) => client.Brief())).toBeNull();
    expect(model.Snapshot().problem).toBe("internal error: boom");
    await model.LoadStatus();
    expect(model.Snapshot().problem).toBeNull();
    expect(model.Snapshot().status?.pending_proposals).toBe(3);
  });

  test("a form's refused values stay with the form; a refused token goes to the banner too", async () => {
    const refusing = Model({ "POST /api/sources": Json({ error: "There is no folder at /nope" }, 400) });
    let failed: string | null = null;
    expect(await refusing.Submit((client) => client.AddSource({
      kind: "filesystem", name: "x", path: "/nope", include: [], include_documents: true, projects: [], groups: [], verify_tls: true,
    }), (message) => { failed = message; })).toBeNull();
    expect(failed).toBe("There is no folder at /nope");
    expect(refusing.Snapshot().problem).toBeNull();

    const unauthorized = Model({ "GET /api/goals": Json({ error: "missing or wrong token" }, 401) });
    let said: string | null = null;
    await unauthorized.Submit((client) => client.Goals(), (message) => { said = message; });
    expect(said).toBe(IntelError.Server(401, "").message);
    expect(unauthorized.Snapshot().problem).toBe(said);
  });

  test("a cancelled call isn't a problem", async () => {
    const fetcher = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));       // as fetch does
    })) as typeof fetch;
    const model = new AppModel({ token: "t", fetcher, saveToken: () => undefined, loadLocalInfo: () => Promise.reject(new Error("none")) });
    const controller = new AbortController();
    const call = model.Run((client) => client.Brief(), controller.signal);
    controller.abort();
    expect(await call).toBeNull();
    expect(model.Snapshot().problem).toBeNull();
  });

  test("Sync Now keeps the lines it reports and asks every screen to reload", async () => {
    const model = Model({
      "POST /local/sync": () => EventStream('event: result\ndata: {"status": 200, "body": {"lines": ["notes: 1 new"], "events": 1, "entities_created": 0, "queued": 0}}\n\n'),
    });
    const before = model.Snapshot().refreshToken;
    const syncing = model.SyncNow();
    expect(model.Snapshot().isSyncing).toBe(true);
    await syncing;
    expect(model.Snapshot()).toMatchObject({ isSyncing: false, lastSyncLines: ["notes: 1 new"], refreshToken: before + 1 });
  });

  test("without a token, Settings opens and nothing is loaded", async () => {
    const model = Model({}, "");
    expect(model.Snapshot().showingSettings).toBe(true);
    await model.LoadStatus();
    expect(model.Snapshot().status).toBeNull();
  });
});
