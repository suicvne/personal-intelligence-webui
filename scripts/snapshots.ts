// Screenshots of every screen, for checking layout without clicking through (the SwiftUI app's
// INTEL_SNAPSHOT). Runs the fake intel and the companion (with Vite, so it's the current source), then a
// headless Chromium; prints anything the page logged as an error.
//
//   npm run snapshots -- [--out snapshots] [--only brief,proposals/1,dialog-settings] [--dark] [--width 1280] [--height 800]
//
// Needs Playwright's Chromium once: npx playwright install chromium
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { CreateCompanion } from "../server/companion.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Options {
  out: string;
  only: string[] | null;
  dark: boolean;
  width: number;
  height: number;
}

function ParseOptions(argv: string[]): Options {
  const options: Options = { out: path.join(root, "snapshots"), only: null, dark: false, width: 1280, height: 800 };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--out") options.out = path.resolve(String(argv[++i]));
    else if (argument === "--only") options.only = String(argv[++i]).split(",");
    else if (argument === "--dark") options.dark = true;
    else if (argument === "--width") options.width = Number(argv[++i]);
    else if (argument === "--height") options.height = Number(argv[++i]);
    else throw new Error(`unknown option ${argument}`);
  }
  return options;
}

/** Each page to capture, and something on it that shows it has loaded. */
const Pages: [string, string][] = [
  ["brief", ".brief-window, .empty-state"],
  ["activity", ".feed, .empty-state"],
  ["proposals", ".split"],
  ["proposals/1", ".detail-inner"],
  ["tasks", ".table, .empty-state"],
  ["goals", ".split"],
  ["goals/1", ".detail-inner"],
  ["entities", ".split"],
  ["entities/1", ".detail-inner"],
  ["ask", ".ask"],
  ["sources", ".split"],
  ["sources/1", ".detail-inner"],
];

async function Capture(page: Page, base: string, name: string, ready: string, out: string): Promise<void> {
  await page.goto(`${base}/${name}`);
  await page.locator(ready).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const file = path.join(out, `${name.replace("/", "-")}.png`);
  await page.screenshot({ path: file });
  process.stdout.write(`${file}\n`);
}

/** Dialogs: each opened from where it lives, captured, then closed. */
const Dialogs: [string, string, (page: Page) => Promise<void>][] = [
  ["settings", "brief", async (page) => { await page.keyboard.press(","); }],
  ["shortcuts", "brief", async (page) => { await page.keyboard.press("?"); }],
  ["group-decision", "proposals", async (page) => {
    await page.getByRole("button", { name: /Decide every proposal/ }).first().click();
    await page.getByRole("menuitem", { name: /Reject all/ }).click();
  }],
  ["goal-sheet", "goals", async (page) => { await page.getByRole("button", { name: "Add Goal" }).click(); }],
  ["entity-relationship", "entities/1", async (page) => {
    await page.getByRole("button", { name: "Correct what intel knows about it" }).click();
    await page.getByRole("menuitem", { name: "Add a Relationship…" }).click();
  }],
  ["add-source", "sources", async (page) => { await page.getByRole("button", { name: "Add Source" }).click(); }],
];

async function CaptureDialog(page: Page, base: string, name: string, where: string, open: (page: Page) => Promise<void>, out: string): Promise<void> {
  await page.goto(`${base}/${where}`);
  await page.locator(".screen-header").waitFor();
  await page.waitForTimeout(500);
  await open(page);
  await page.locator("dialog[open]").last().waitFor({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  const file = path.join(out, `dialog-${name}.png`);
  await page.screenshot({ path: file });
  process.stdout.write(`${file}\n`);
}

/** The Ask screen while the answer streams in, and once it's complete. */
async function AskSomething(page: Page, out: string): Promise<void> {
  await page.getByLabel("Question").fill("What changed in Crawler recently?");
  await page.keyboard.press("Enter");
  await page.locator(".looking-up, .thinking").first().waitFor({ timeout: 5_000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(out, "ask-thinking.png") });
  await page.getByText("Writing… evidence and references follow.").waitFor({ timeout: 10_000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(out, "ask-writing.png") });
  await page.getByRole("heading", { name: "References" }).waitFor({ timeout: 20_000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(out, "ask-answer.png"), fullPage: true });
  process.stdout.write(`${path.join(out, "ask-thinking.png")}, ask-writing.png, ask-answer.png\n`);
}

async function Main(): Promise<void> {
  const options = ParseOptions(process.argv.slice(2));
  await mkdir(options.out, { recursive: true });
  const fakePort = 18775;
  const fake = spawn(process.execPath, [path.join(root, "tests/fake_intel.ts"), "--port", String(fakePort), "--sync-seconds", "1"],
                     { stdio: "ignore" });
  const companion = await CreateCompanion({
    upstream: new URL(`http://127.0.0.1:${fakePort}`), root, distDir: path.join(root, "dist"), dev: true,
  });
  await new Promise<void>((resolve) => companion.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(companion.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      colorScheme: options.dark ? "dark" : "light",
      deviceScaleFactor: 2,
    });
    await context.addInitScript({ content: "window.localStorage.setItem(\"intel.token\", \"fake-token\")" });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") errors.push(`[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`[pageerror] ${error.message}`));
    for (const [name, ready] of Pages) {
      if (options.only && !options.only.includes(name)) continue;
      await Capture(page, base, name, ready, options.out);
      if (name === "ask") await AskSomething(page, options.out);
    }
    for (const [name, where, open] of Dialogs) {
      if (options.only && !options.only.includes(`dialog-${name}`)) continue;
      await CaptureDialog(page, base, name, where, open, options.out);
    }
  } finally {
    await browser.close();
    await companion.Close();
    fake.kill();
  }
  if (errors.length > 0) {
    process.stdout.write(`\nThe page logged:\n${[...new Set(errors)].join("\n")}\n`);
    process.exitCode = 1;
  }
}

await Main();
