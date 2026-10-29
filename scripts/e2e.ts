// Drives the main flows in a headless Chromium against the fake intel, checking what the page asks intel
// to do (the requests' bodies), not just what it shows.
//
//   npm run e2e                 (the source, through Vite)
//   npm run build && npm run e2e -- --built      (the built UI, with its Content-Security-Policy)
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page, type Request } from "playwright";
import { CreateCompanion } from "../server/companion.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

async function Main(): Promise<void> {
  const fakePort = 18785;
  const fake = spawn(process.execPath, [path.join(root, "tests/fake_intel.ts"), "--port", String(fakePort), "--sync-seconds", "1"],
                     { stdio: "ignore" });
  const companion = await CreateCompanion({
    upstream: new URL(`http://127.0.0.1:${fakePort}`), root, distDir: path.join(root, "dist"), dev: !process.argv.includes("--built"),
  });
  await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(companion.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  const sent: Sent[] = [];
  const errors: string[] = [];
  let failed = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript({ content: "window.localStorage.setItem('intel.token', 'fake-token')" });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", (request: Request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/local/")) return;
      const data = request.postData();
      sent.push({ method: request.method(), path: url.pathname + url.search, body: data ? JSON.parse(data) : undefined });
    });
    const Last = (method: string, prefix: string): Sent | undefined =>
      [...sent].reverse().find((request) => request.method === method && request.path.startsWith(prefix));
    const Step = async (name: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run();
        process.stdout.write(`ok   ${name}\n`);
      } catch (error) {
        failed += 1;
        process.stdout.write(`FAIL ${name}\n     ${(error as Error).message.split("\n")[0]}\n`);
      }
    };
    const Ready = async (where: string, selector: string): Promise<void> => {
      await page.goto(`${base}/${where}`);
      await page.locator(selector).first().waitFor({ timeout: 15_000 });
    };

    await Step("approving a corrected proposal sends only the changed field, with ⌘↩", async () => {
      await Ready("proposals/3", ".decision");
      await page.locator("#proposal-field-predicate").selectOption("PART_OF");
      await page.getByLabel("Note", { exact: true }).fill("it's a place in it");
      await page.keyboard.press("Meta+Enter");
      await page.locator(".message-bar").getByText("approved").waitFor();
      assert.deepEqual(Last("POST", "/api/proposals/3/")?.body, { note: "it's a place in it", rename: false, edits: { predicate: "PART_OF" } });
      assert.equal(Last("POST", "/api/proposals/3/")?.path, "/api/proposals/3/approve");
    });

    await Step("rejecting a whole group, with a note", async () => {
      await Ready("proposals", ".list-row");
      await page.getByRole("button", { name: /Decide every proposal from crawler-notes/ }).click();
      await page.getByRole("menuitem", { name: "Reject all 2…" }).click();
      await page.getByText("2 proposals: 1 entity, 1 relationship").waitFor();
      await page.getByPlaceholder("Why? (remembered with the rejection)").fill("not about the game");
      await page.keyboard.press("Enter");
      await page.locator(".message-bar").getByText("Rejected").waitFor();
      assert.deepEqual(Last("POST", "/api/proposals/group")?.body, { group: "crawler-notes: essay.md", decision: "reject", note: "not about the game" });
    });

    await Step("j and k move through the list; the URL follows", async () => {
      await Ready("proposals", ".list-row");
      await page.locator("body").press("j");
      await page.waitForURL(/\/proposals\/\d+$/);
      const first = page.url();
      await page.locator("body").press("j");
      await page.waitForURL((url) => url.href !== first);
      await page.locator("body").press("k");
      await page.waitForURL(first);
    });

    await Step("renaming an entity from its Edit menu", async () => {
      await Ready("entities/1", ".detail-title");
      await page.getByRole("button", { name: "Correct what intel knows about it" }).click();
      await page.getByRole("menuitem", { name: "Rename…" }).click();
      await page.getByLabel("New name").fill("Project Succubi");
      await page.keyboard.press("Enter");
      await page.locator(".message-bar").getByText("Renamed Crawler to Project Succubi").waitFor();
      const rename = Last("POST", "/api/entities/");          // the id is the loaded entity's (the fake's sample is 2)
      assert.match(rename?.path ?? "", /^\/api\/entities\/\d+\/rename$/);
      assert.deepEqual(rename?.body, { name: "Project Succubi" });
    });

    await Step("adding a goal that prioritizes a project, with a target date", async () => {
      await Ready("goals", ".screen-header");
      await page.getByRole("button", { name: "Add Goal" }).click();
      await page.getByPlaceholder("e.g. Ship the Crawler demo").fill("Ship the Crawler demo");
      await page.getByRole("button", { name: "1 · highest" }).click();
      await page.getByText("Has a target date").click();
      await page.getByLabel("Target date", { exact: true }).fill("2026-11-01");
      await page.locator("dialog[open]").getByRole("option", { name: /^Crawler/ }).click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.locator(".message-bar").getByText("Added").waitFor();
      const body = Last("POST", "/api/goals")?.body as Record<string, unknown>;
      assert.equal(body.statement, "Ship the Crawler demo");
      assert.equal(body.priority, 1);
      assert.equal(body.target_date, "2026-11-01");
      assert.equal((body.prioritizes as string[]).length, 1);
    });

    await Step("the activity layer is in the URL and the request", async () => {
      await Ready("activity", ".feed");
      await page.getByRole("button", { name: "Sources", exact: true }).click();
      await page.waitForURL(/layer=source/);
      await page.waitForTimeout(300);
      assert.match(Last("GET", "/api/events")?.path ?? "", /layer=source/);
    });

    await Step("Esc stops an answer before it's written", async () => {
      await Ready("ask", ".ask-bar");
      await page.getByLabel("Question").fill("What changed?");
      await page.keyboard.press("Enter");
      await page.locator(".thinking").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Ask" }).waitFor();
      assert.equal(await page.locator(".answer").count(), 0);
    });

    await Step("with Read aloud on, the whole answer is read in one voice, as soon as its text is written", async () => {
      await Ready("ask", ".ask-bar");
      await page.getByText("Read aloud").click();
      await page.getByLabel("Question").fill("What changed?");
      const speech = page.waitForRequest((request) => request.url().endsWith("/api/speak/stream"));
      await page.keyboard.press("Enter");
      const first = await speech;
      assert.deepEqual(first.postDataJSON(), { text: "Crawler's open work is the UI layout (\"ui.md\").\nNothing else is recorded." });
      await page.getByRole("heading", { name: "References" }).waitFor();
      await page.waitForTimeout(1000);
      assert.equal(sent.filter((request) => request.path === "/api/speak/stream").length, 1, "the answer was read in more than one piece");
      await page.getByText("Read aloud").click();               // off again, for the steps after
    });

    await Step("Shift+S syncs every source, through the companion's heartbeat", async () => {
      await Ready("brief", ".brief-window");
      await page.locator("body").press("Shift+S");
      await page.locator(".sidebar-footer").getByText("Syncing…").waitFor();
      await page.locator(".sidebar-footer").getByText("Synced").waitFor({ timeout: 10_000 });
      assert.equal(Last("POST", "/local/sync")?.path, "/local/sync");
      await page.getByRole("heading", { name: "Last sync" }).waitFor();
    });

    await Step("syncing one source names it", async () => {
      await Ready("sources/3", ".detail-title");
      await page.locator(".detail").getByRole("button", { name: "Sync Now" }).click();
      await page.locator(".message-bar").getByText("crawler-notes").waitFor({ timeout: 10_000 });
      assert.deepEqual(Last("POST", "/local/sync")?.body, { sources: ["crawler-notes"] });
    });

    await Step("number keys switch screens; , opens Settings and Esc closes it", async () => {
      await Ready("brief", ".brief-window");
      await page.locator("body").press("6");
      await page.waitForURL(/\/entities$/);
      await page.locator("body").press(",");
      await page.getByRole("heading", { name: "Settings" }).waitFor();
      await page.keyboard.press("Escape");
      await page.locator("dialog[open]").waitFor({ state: "detached" });
    });

    await Step("a refused token shows the SwiftUI app's words, with a way to Settings", async () => {
      await page.evaluate("window.localStorage.setItem('intel.token', 'wrong')");
      await context.addInitScript({ content: "window.localStorage.setItem('intel.token', 'wrong')" });
      await page.goto(`${base}/brief`);
      await page.getByText("The token was refused. Run `intel api token` and paste it in Settings.").first().waitFor();
    });
  } finally {
    await browser.close();
    await companion.Close();
    fake.kill();
  }
  const unexpected = errors.filter((error) => !error.includes("401"));
  if (unexpected.length > 0) {
    failed += 1;
    process.stdout.write(`\nThe page logged errors:\n${[...new Set(unexpected)].join("\n")}\n`);
  }
  process.stdout.write(failed === 0 ? "\nAll flows passed.\n" : `\n${failed} failed.\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await Main();
