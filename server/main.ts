// node server/main.ts [--port 8766] [--intel-url http://127.0.0.1:8765] [--dev] [--open] [--no-local-token]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CreateCompanion } from "./companion.ts";
import { RunCommand } from "./intel_cli.ts";

const Usage = `Usage: node server/main.ts [options]

  --port N            where the web UI listens on 127.0.0.1 (default 8766, or $INTEL_WEBUI_PORT)
  --intel-url URL     intel's API (default http://127.0.0.1:8765, or $INTEL_URL)
  --dev               serve the source through Vite, with hot reload
  --open              open the web UI in the browser once it's listening
  --no-local-token    don't offer "Use the token of the intel on this Mac"
`;

interface Arguments {
  port: number;
  intelUrl: URL;
  dev: boolean;
  open: boolean;
  allowLocalToken: boolean;
}

function ParseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    port: Number(process.env.INTEL_WEBUI_PORT ?? 8766),
    intelUrl: new URL(process.env.INTEL_URL ?? "http://127.0.0.1:8765"),
    dev: false,
    open: false,
    allowLocalToken: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    const Value = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      return value;
    };
    if (argument === "--port") parsed.port = Number(Value());
    else if (argument === "--intel-url") parsed.intelUrl = new URL(Value());
    else if (argument === "--dev") parsed.dev = true;
    else if (argument === "--open") parsed.open = true;
    else if (argument === "--no-local-token") parsed.allowLocalToken = false;
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write(Usage);
      process.exit(0);
    } else throw new Error(`unknown option ${argument}`);
  }
  if (!Number.isInteger(parsed.port) || parsed.port < 0 || parsed.port > 65535) throw new Error("--port must be 0-65535");
  return parsed;
}

async function Main(): Promise<void> {
  let options: Arguments;
  try {
    options = ParseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${Usage}`);
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const companion = await CreateCompanion({
    upstream: options.intelUrl,
    root,
    distDir: path.join(root, "dist"),
    dev: options.dev,
    allowLocalToken: options.allowLocalToken,
  });
  companion.server.on("error", (error: NodeJS.ErrnoException) => {
    process.stderr.write(error.code === "EADDRINUSE"
      ? `Port ${options.port} is in use. Pick another with --port.\n`
      : `${error.message}\n`);
    process.exit(1);
  });
  companion.server.listen(options.port, "127.0.0.1", () => {
    const address = companion.server.address();
    const port = typeof address === "object" && address ? address.port : options.port;
    const url = `http://127.0.0.1:${port}/`;
    process.stdout.write(`intel web UI${options.dev ? " (dev)" : ""}: ${url}  ->  intel at ${options.intelUrl.origin}\n`);
    if (options.open) RunCommand("/usr/bin/open", [url]).catch(() => undefined);
  });
  const Stop = (): void => {
    companion.Close().finally(() => process.exit(0));
  };
  process.on("SIGINT", Stop);
  process.on("SIGTERM", Stop);
}

await Main();
