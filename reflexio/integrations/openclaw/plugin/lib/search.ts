// Search Reflexio and format results for context injection.
import type { CommandRunner } from "./server.ts";

const TRIVIAL_RE = /^(yes|no|ok|okay|sure|thanks|thank you|yep|nope|right|correct|got it|done|good|great|fine|lgtm|y|n|k|ty|thx|ack|np)$/i;

/** Decide whether to skip search for a given message. */
export function shouldSkipSearch(prompt: string, minLength: number): boolean {
  if (!prompt || prompt.length < minLength) return true;
  return TRIVIAL_RE.test(prompt.trim());
}

/** Format raw search output for context injection. Returns null if empty/no results. */
export function formatSearchContext(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes("Found 0 profiles, 0 playbooks")) return null;
  return trimmed;
}

/**
 * Run `reflexio search` and return formatted context string.
 * Returns null if no results.
 * Throws an Error (with stderr as message) on non-zero exit code so callers can
 * distinguish connection/binary errors from empty-results.
 */
export async function runSearch(
  prompt: string,
  userId: string,
  topK: number,
  timeoutMs: number,
  runner: CommandRunner,
): Promise<string | null> {
  const result = await runner(
    ["reflexio", "search", prompt.slice(0, 4096), "--user-id", userId, "--top-k", String(topK)],
    { timeoutMs },
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || `reflexio search exited with code ${result.code}`);
  }
  return formatSearchContext(result.stdout);
}

/**
 * Check if a search failure looks like a connection error.
 */
export function isConnectionError(errMsg: string): boolean {
  return (
    errMsg.includes("Cannot reach server") ||
    errMsg.includes("Connection refused") ||
    errMsg.includes("ECONNREFUSED")
  );
}
