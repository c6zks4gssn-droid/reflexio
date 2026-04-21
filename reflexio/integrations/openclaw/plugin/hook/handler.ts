// Core hook logic: search injection, message buffering, session flush.
//
// Decoupled from the Plugin SDK so each handler can be tested independently.
// The SDK wiring in index.ts calls these functions with injected deps.
import * as os from "node:os";
import * as path from "node:path";
import type Database from "better-sqlite3";
import {
  openDb,
  insertTurn,
  countUnpublished,
  cleanupOldTurns,
  getOldUnpublishedSessions,
} from "../lib/sqlite-buffer.ts";
import { publishSession } from "../lib/publish.ts";
import { shouldSkipSearch, runSearch, isConnectionError } from "../lib/search.ts";
import { ensureServerRunning, type CommandRunner } from "../lib/server.ts";
import { resolveUserId, resolveAgentVersion } from "../lib/user-id.ts";
import { runSetupCheck, type SetupGuidance } from "./setup.ts";

type Logger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export interface PluginConfig {
  publish: { batch_size: number; max_retries: number; max_content_length: number };
  search: { timeout_ms: number; top_k: number; min_prompt_length: number };
  server: { health_check_timeout_ms: number; stale_flag_ms: number };
}

export const DEFAULT_CONFIG: PluginConfig = {
  publish: { batch_size: 10, max_retries: 3, max_content_length: 10_000 },
  search: { timeout_ms: 5_000, top_k: 5, min_prompt_length: 5 },
  server: { health_check_timeout_ms: 3_000, stale_flag_ms: 120_000 },
};

const DB_PATH = path.join(os.homedir(), ".reflexio", "sessions.db");
const MAX_INTERACTIONS = 200;
const MAX_OLD_SESSIONS = 5;

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = openDb(DB_PATH);
    cleanupOldTurns(_db, 7);
    process.on("exit", () => {
      if (_db) _db.close();
    });
  }
  return _db;
}

/**
 * Handle before_prompt_build: auto-setup, search injection, retry old sessions.
 * Returns prependSystemContext string if search results found.
 */
export async function handleBeforePromptBuild(
  sessionKey: string,
  agentId: string,
  prompt: string | undefined,
  runner: CommandRunner,
  config: PluginConfig = DEFAULT_CONFIG,
  log?: Logger,
): Promise<{ prependSystemContext?: string; setupGuidance?: SetupGuidance }> {
  // 1. Auto-setup check
  let guidance: SetupGuidance | null = null;
  try {
    guidance = await runSetupCheck(agentId);
  } catch (err) {
    log?.error?.(`[reflexio] Setup check failed: ${err}`);
  }
  if (guidance) {
    return {
      prependSystemContext: `# Reflexio Setup Required\n\n${guidance.message}`,
      setupGuidance: guidance,
    };
  }

  // 2. Ensure server is running
  try {
    await ensureServerRunning(runner, {
      staleFlagMs: config.server.stale_flag_ms,
      log,
    });
  } catch (err) {
    log?.error?.(`[reflexio] Server check failed: ${err}`);
  }

  // 3. Retry unpublished turns from old sessions
  try {
    const db = getDb();
    const userId = resolveUserId(sessionKey);
    const agentVersion = resolveAgentVersion();
    const oldSessions = getOldUnpublishedSessions(
      db,
      sessionKey,
      config.publish.max_retries,
      MAX_OLD_SESSIONS,
    );
    for (const sid of oldSessions) {
      publishSession(
        db,
        sid,
        userId,
        agentVersion,
        config.publish.max_retries,
        MAX_INTERACTIONS,
        log,
      );
    }
  } catch (err) {
    log?.error?.(`[reflexio] Old session retry failed: ${err}`);
  }

  // 4. Search injection
  if (!prompt || shouldSkipSearch(prompt, config.search.min_prompt_length)) {
    return {};
  }

  try {
    const userId = resolveUserId(sessionKey);
    const context = await runSearch(
      prompt,
      userId,
      config.search.top_k,
      config.search.timeout_ms,
      runner,
    );
    if (context) {
      return { prependSystemContext: context };
    }
  } catch (err) {
    const errMsg = String(err);
    log?.error?.(`[reflexio] Search failed: ${errMsg}`);
    if (isConnectionError(errMsg)) {
      try {
        await ensureServerRunning(runner, { staleFlagMs: config.server.stale_flag_ms, log });
      } catch {}
    }
  }

  return {};
}

/**
 * Handle message_sent: buffer turn to SQLite, trigger incremental publish.
 */
export function handleMessageSent(
  sessionKey: string,
  userMessage: string | undefined,
  agentResponse: string | undefined,
  runner: CommandRunner,
  config: PluginConfig = DEFAULT_CONFIG,
  log?: Logger,
): void {
  if (!userMessage && !agentResponse) return;

  try {
    const db = getDb();
    if (userMessage) insertTurn(db, sessionKey, "user", userMessage);
    if (agentResponse) insertTurn(db, sessionKey, "assistant", agentResponse);

    // Incremental publish at batch threshold
    const count = countUnpublished(db, sessionKey);
    if (count >= config.publish.batch_size * 2) {
      const userId = resolveUserId(sessionKey);
      const agentVersion = resolveAgentVersion();
      publishSession(
        db,
        sessionKey,
        userId,
        agentVersion,
        config.publish.max_retries,
        MAX_INTERACTIONS,
        log,
      );
    }
  } catch (err) {
    log?.error?.(`[reflexio] Failed to buffer turn: ${err}`);
  }
}

/**
 * Handle session end / compaction / reset: flush all unpublished turns.
 */
export function handleSessionFlush(
  sessionKey: string,
  log?: Logger,
  config: PluginConfig = DEFAULT_CONFIG,
): void {
  try {
    const db = getDb();
    const userId = resolveUserId(sessionKey);
    const agentVersion = resolveAgentVersion();
    publishSession(
      db,
      sessionKey,
      userId,
      agentVersion,
      config.publish.max_retries,
      MAX_INTERACTIONS,
      log,
    );
  } catch (err) {
    log?.error?.(`[reflexio] Session flush failed: ${err}`);
  }
}

/**
 * Handle reflexio_publish tool: immediate flush of current session.
 */
export function handleToolPublish(
  sessionKey: string,
  log?: Logger,
  config: PluginConfig = DEFAULT_CONFIG,
): string {
  try {
    const db = getDb();
    const count = countUnpublished(db, sessionKey);
    if (count === 0) return "No unpublished turns to flush.";

    const userId = resolveUserId(sessionKey);
    const agentVersion = resolveAgentVersion();
    publishSession(
      db,
      sessionKey,
      userId,
      agentVersion,
      config.publish.max_retries,
      MAX_INTERACTIONS,
      log,
    );
    return `Flushing ${count} turns to Reflexio server.`;
  } catch (err) {
    return `Publish failed: ${err}`;
  }
}
