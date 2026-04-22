// SQLite session buffer — persistent, crash-safe conversation store.
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_CONTENT_LENGTH = 10_000;

export interface Turn {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: string;
  published: number;
  retry_count: number;
}

/** Smart truncation: preserve head + tail with marker, guaranteed <= maxLength. */
export function smartTruncate(
  content: string,
  maxLength: number = MAX_CONTENT_LENGTH,
): string {
  if (!content || content.length <= maxLength) return content || "";
  // Use a fixed-width marker estimate to break the circular dependency
  // between marker length and truncated count.
  const markerTemplate = "\n\n[...truncated NNNNNNN chars...]\n\n"; // ~38 chars
  const budget = maxLength - markerTemplate.length;
  if (budget <= 0) return content.slice(0, maxLength);
  const headLen = Math.floor(budget * 0.8);
  const tailLen = budget - headLen;
  const truncated = content.length - headLen - tailLen;
  const marker = `\n\n[...truncated ${truncated} chars...]\n\n`;
  const result =
    tailLen <= 0
      ? content.slice(0, headLen) + marker
      : content.slice(0, headLen) + marker + content.slice(-tailLen);
  // Final safety clamp for edge cases (very large truncated counts exceeding reserved marker width)
  return result.length <= maxLength ? result : result.slice(0, maxLength);
}

/** Open (or create) the SQLite database and ensure schema exists. */
export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      published INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_session_published
      ON turns(session_id, published);
  `);
  try {
    db.exec("ALTER TABLE turns ADD COLUMN retry_count INTEGER DEFAULT 0");
  } catch {
    // Column already exists
  }
  return db;
}

/** Insert a single turn into the buffer. */
export function insertTurn(
  db: Database.Database,
  sessionId: string,
  role: string,
  content: string,
  maxContentLength: number = MAX_CONTENT_LENGTH,
): void {
  const truncated = smartTruncate(content, maxContentLength);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO turns (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
  ).run(sessionId, role, truncated, now);
}

/** Get unpublished turns for a session, respecting retry limit. */
export function getUnpublished(
  db: Database.Database,
  sessionId: string,
  maxRetries: number,
  maxInteractions: number,
): Turn[] {
  return db
    .prepare(
      "SELECT * FROM turns WHERE session_id = ? AND published = 0 AND retry_count < ? ORDER BY id LIMIT ?",
    )
    .all(sessionId, maxRetries, maxInteractions) as Turn[];
}

/** Get distinct session IDs with unpublished turns (excluding current session). */
export function getOldUnpublishedSessions(
  db: Database.Database,
  currentSessionId: string,
  maxRetries: number,
  limit: number,
): string[] {
  const rows = db
    .prepare(
      "SELECT session_id FROM turns WHERE published = 0 AND retry_count < ? AND session_id != ? GROUP BY session_id ORDER BY MIN(id) LIMIT ?",
    )
    .all(maxRetries, currentSessionId, limit) as { session_id: string }[];
  return rows.map((r) => r.session_id);
}

/** Count unpublished turns for a session. */
export function countUnpublished(
  db: Database.Database,
  sessionId: string,
): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM turns WHERE session_id = ? AND published = 0",
    )
    .get(sessionId) as { count: number };
  return row.count;
}

/** Mark turns as in-flight (published=2) to prevent concurrent publish. */
export function markInFlight(
  db: Database.Database,
  sessionId: string,
  maxId: number,
  maxRetries: number,
): void {
  db.prepare(
    "UPDATE turns SET published = 2 WHERE session_id = ? AND published = 0 AND retry_count < ? AND id <= ?",
  ).run(sessionId, maxRetries, maxId);
}

/** Mark in-flight turns as successfully published (scoped to batch). */
export function markPublished(db: Database.Database, sessionId: string, maxId: number): void {
  db.prepare(
    "UPDATE turns SET published = 1 WHERE session_id = ? AND published = 2 AND id <= ?",
  ).run(sessionId, maxId);
}

/** Reset in-flight turns back to unpublished and increment retry count (scoped to batch). */
export function markFailed(db: Database.Database, sessionId: string, maxId: number): void {
  db.prepare(
    "UPDATE turns SET published = 0, retry_count = retry_count + 1 WHERE session_id = ? AND published = 2 AND id <= ?",
  ).run(sessionId, maxId);
}

/** Delete published turns older than the given number of days. */
export function cleanupOldTurns(db: Database.Database, days: number = 7): void {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "DELETE FROM turns WHERE published = 1 AND timestamp < ?",
  ).run(cutoff);
}
