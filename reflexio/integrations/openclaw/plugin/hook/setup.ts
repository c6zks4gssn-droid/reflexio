// Runtime auto-setup: check reflexio CLI, check config, check server.
//
// Runs on before_prompt_build. Gated by per-agent marker file.
// Each step that fails returns a guidance message for the agent to present
// to the user with options — the user picks, Openclaw executes.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, execFileSync } from "node:child_process";

export interface SetupGuidance {
  /** Message for the agent to present to the user. */
  message: string;
  /** Whether the plugin can function without resolving this. */
  blocking: boolean;
}

const REFLEXIO_DIR = path.join(os.homedir(), ".reflexio");

/** Sanitize agentId for safe use in filesystem paths. */
function sanitizeAgentId(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Check if setup has been completed for a given agent. */
export function isSetupComplete(reflexioDir: string, agentId: string): boolean {
  const safeId = sanitizeAgentId(agentId);
  const marker = path.join(reflexioDir, `.setup_complete_${safeId}`);
  return fs.existsSync(marker);
}

/** Create the setup-complete marker for an agent. */
export function markSetupComplete(reflexioDir: string, agentId: string): void {
  const safeId = sanitizeAgentId(agentId);
  fs.mkdirSync(reflexioDir, { recursive: true });
  fs.writeFileSync(
    path.join(reflexioDir, `.setup_complete_${safeId}`),
    new Date().toISOString(),
  );
}

/** Check if `reflexio` CLI is available on PATH. */
export function checkReflexioInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "reflexio",
      ["--version"],
      { timeout: 5_000 },
      (err) => { resolve(err === null); },
    );
  });
}

/** Detect which Python package installer is available. */
export function detectInstaller(): "pipx" | "pip" | null {
  try {
    execFileSync("pipx", ["--version"], { timeout: 3_000, stdio: ["ignore", "pipe", "pipe"] });
    return "pipx";
  } catch {
    // pipx not found
  }
  try {
    execFileSync("pip", ["--version"], { timeout: 3_000, stdio: ["ignore", "pipe", "pipe"] });
    return "pip";
  } catch {
    // pip not found
  }
  return null;
}

/** Check if Reflexio has been configured (~/.reflexio/.env with REFLEXIO_URL). */
export function checkReflexioConfigured(reflexioDir: string = REFLEXIO_DIR): boolean {
  try {
    const envPath = path.join(reflexioDir, ".env");
    const content = fs.readFileSync(envPath, "utf-8");
    return content.split("\n").some((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) return false;
      const match = trimmed.match(/^REFLEXIO_URL\s*=\s*"?([^"\s]+)/);
      return match !== null && match[1].length > 0;
    });
  } catch {
    return false;
  }
}

/**
 * Run the full setup check chain. Returns guidance for the agent if setup
 * is incomplete, or null if everything is ready.
 */
export async function runSetupCheck(
  agentId: string,
  reflexioDir: string = REFLEXIO_DIR,
): Promise<SetupGuidance | null> {
  // Gate: already set up?
  if (isSetupComplete(reflexioDir, agentId)) return null;

  // Step 1: Is reflexio installed?
  const installed = await checkReflexioInstalled();
  if (!installed) {
    const installer = detectInstaller();
    if (installer === "pipx") {
      return {
        message:
          "Reflexio CLI is required but not found. " +
          "I can install it via pipx. OK if I run `pipx install reflexio-ai`?",
        blocking: true,
      };
    }
    if (installer === "pip") {
      return {
        message:
          "Reflexio CLI is required but not found. " +
          "I can install it via pip. OK if I run `pip install reflexio-ai`? " +
          "(If this fails on macOS, I'll guide you through pipx instead.)",
        blocking: true,
      };
    }
    return {
      message:
        "Reflexio CLI is required but not found, and neither pipx nor pip is available. " +
        "Please install pipx first (https://pipx.pypa.io/), then I can install Reflexio for you.",
      blocking: true,
    };
  }

  // Step 2: Is Reflexio configured?
  if (!checkReflexioConfigured(reflexioDir)) {
    return {
      message:
        "Reflexio needs initial configuration (storage backend, LLM provider). " +
        "OK if I run `reflexio setup init` to start the setup wizard?",
      blocking: true,
    };
  }

  // All checks passed — create marker
  markSetupComplete(reflexioDir, agentId);
  return null;
}
