// Build payload and spawn `reflexio interactions publish`.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type Database from "better-sqlite3";
import type { Turn } from "./sqlite-buffer.ts";
import {
  getUnpublished,
  markInFlight,
  markPublished,
  markFailed,
} from "./sqlite-buffer.ts";

type Logger = {
  info?: (msg: string) => void;
  error?: (msg: string) => void;
};

const PAYLOAD_DIR = path.join(os.homedir(), ".reflexio", "tmp");

/** Build a JSON payload string from turns. */
export function buildPayload(
  turns: Turn[],
  userId: string,
  agentVersion: string,
  sessionId: string,
): string {
  return JSON.stringify({
    user_id: userId,
    source: "openclaw",
    agent_version: agentVersion,
    session_id: sessionId,
    interactions: turns.map((t) => ({ role: t.role, content: t.content })),
  });
}

/** Sanitize a string for use in a filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^-+/, "").slice(0, 100) || "unnamed";
}

/**
 * Publish unpublished turns for a session. Fire-and-forget spawn of CLI.
 * Marks turns in-flight before spawning, then published/failed on exit.
 */
export function publishSession(
  db: Database.Database,
  sessionId: string,
  userId: string,
  agentVersion: string,
  maxRetries: number,
  maxInteractions: number,
  log?: Logger,
): void {
  const turns = getUnpublished(db, sessionId, maxRetries, maxInteractions);
  if (turns.length === 0) return;

  const maxId = turns[turns.length - 1].id;
  markInFlight(db, sessionId, maxId, maxRetries);

  const payload = buildPayload(turns, userId, agentVersion, sessionId);

  fs.mkdirSync(PAYLOAD_DIR, { recursive: true, mode: 0o700 });
  const payloadFile = path.join(
    PAYLOAD_DIR,
    `publish-${sanitizeFilename(sessionId)}-${Date.now()}.json`,
  );
  fs.writeFileSync(payloadFile, payload, { mode: 0o600 });

  const child = spawn(
    "reflexio",
    ["interactions", "publish", "--file", payloadFile],
    { stdio: ["ignore", "ignore", "ignore"], detached: true },
  );

  child.on("close", (code) => {
    if (code === 0) {
      try {
        markPublished(db, sessionId);
      } catch (err) {
        log?.error?.(`[reflexio] Failed to mark turns published: ${err}`);
      }
    } else {
      log?.error?.(`[reflexio] Publish failed (exit ${code}), incrementing retry`);
      try {
        markFailed(db, sessionId);
      } catch (err) {
        log?.error?.(`[reflexio] Failed to update retry count: ${err}`);
      }
    }
    try {
      fs.unlinkSync(payloadFile);
    } catch {}
  });
  child.unref();

  log?.info?.(
    `[reflexio] Queued ${turns.length} turns for publish (session ${sessionId})`,
  );
}
