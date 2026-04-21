// Multi-user identity resolution.
//
// Each Openclaw agent instance maps to a distinct Reflexio user.
// Resolution chain: env var > session key agentId > openclaw.json > fallback.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let _cachedUserId: string | null = null;
let _openclawConfig: Record<string, unknown> | null = null;

/** Strip JSON5 line comments while respecting quoted strings. */
export function stripJsonComments(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      let inString = false;
      let escape = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString && ch === "/" && line[i + 1] === "/") return line.slice(0, i);
        if (!inString && ch === "/" && line[i + 1] === "*") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Read and cache ~/.openclaw/openclaw.json (JSON5 — strip comments before parsing). */
function loadOpenclawConfig(): Record<string, unknown> {
  if (_openclawConfig !== null) return _openclawConfig;
  try {
    const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const stripped = stripJsonComments(raw);
    _openclawConfig = JSON.parse(stripped);
  } catch {
    _openclawConfig = {};
  }
  return _openclawConfig!;
}

/**
 * Resolve the Reflexio user ID.
 *
 * @param sessionKey - The Openclaw session key from hook context.
 * @returns The resolved user ID string.
 */
export function resolveUserId(sessionKey: string): string {
  // 1. Explicit env override
  if (process.env.REFLEXIO_USER_ID) return process.env.REFLEXIO_USER_ID;

  // 2. Extract agentId from session key (format: agent:<agentId>:<key>)
  const sessionMatch = sessionKey.match(/^agent:([^:]+):/);
  if (sessionMatch) return sessionMatch[1];

  // 3. Read openclaw.json
  const config = loadOpenclawConfig();
  const agents = config.agents as Record<string, unknown> | undefined;
  if (agents) {
    if (typeof agents.defaults === "string") return agents.defaults;
    if (Array.isArray(agents.list) && agents.list.length > 0) {
      const first = agents.list[0];
      if (first && typeof first === "object" && (first as Record<string, unknown>).name) {
        return (first as Record<string, unknown>).name as string;
      }
      if (typeof first === "string") return first;
    }
  }

  // 4. Fallback
  return "openclaw";
}

/** Resolve the agent version label. */
export function resolveAgentVersion(): string {
  return process.env.REFLEXIO_AGENT_VERSION || "openclaw-agent";
}

/** Reset cached state — for testing only. */
export function _resetCache(): void {
  _cachedUserId = null;
  _openclawConfig = null;
}
