// Server management: URL resolution, health check, auto-start.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

export type CommandRunner = (
  argv: string[],
  opts: { timeoutMs: number; input?: string },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

type Logger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

const LOGS_DIR = path.join(os.homedir(), ".reflexio", "logs");
const STARTING_FLAG = path.join(LOGS_DIR, ".server-starting");
const DEFAULT_URL = "http://127.0.0.1:8081";
const DEFAULT_STALE_FLAG_MS = 2 * 60 * 1000;

/** Resolve Reflexio server URL: env var > ~/.reflexio/.env > default. */
export function resolveServerUrl(): string {
  if (process.env.REFLEXIO_URL) return process.env.REFLEXIO_URL;
  try {
    const envPath = path.join(os.homedir(), ".reflexio", ".env");
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(/^REFLEXIO_URL="?([^"\n]+)/m);
    if (match) return match[1];
  } catch {
    // .env file missing
  }
  return DEFAULT_URL;
}

/** Check if a URL points to a local server. */
export function isLocalServer(url: string): boolean {
  return url.includes("127.0.0.1") || url.includes("localhost");
}

/**
 * Ensure the local Reflexio server is running.
 * Remote servers are never auto-started. Uses a flag file to prevent concurrent starts.
 */
export async function ensureServerRunning(
  runner: CommandRunner,
  opts: { staleFlagMs?: number; log?: Logger } = {},
): Promise<void> {
  const serverUrl = resolveServerUrl();
  if (!isLocalServer(serverUrl)) return;

  const staleFlagMs = opts.staleFlagMs ?? DEFAULT_STALE_FLAG_MS;

  // Check flag file — if recent, another start is in progress
  try {
    const stat = fs.statSync(STARTING_FLAG);
    if (Date.now() - stat.mtimeMs < staleFlagMs) {
      opts.log?.info?.("[reflexio] Server start already in progress, skipping");
      return;
    }
    fs.unlinkSync(STARTING_FLAG);
  } catch {
    // Flag doesn't exist — proceed
  }

  // Health check
  try {
    const result = await runner(
      ["curl", "-sf", "--max-time", "2", `${serverUrl}/health`],
      { timeoutMs: 3_000 },
    );
    if (result.code === 0) return; // Server healthy
  } catch {
    // Server not running
  }

  // Start server in background
  fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STARTING_FLAG, String(Date.now()), { mode: 0o600 });

  const child = spawn(
    "sh",
    [
      "-c",
      `reflexio services start --only backend >> "${path.join(LOGS_DIR, "server.log")}" 2>&1 & sleep 30 && rm -f "${STARTING_FLAG}"`,
    ],
    { detached: true, stdio: ["ignore", "ignore", "ignore"] },
  );
  child.unref();

  opts.log?.info?.("[reflexio] Server not running — starting in background");
}
