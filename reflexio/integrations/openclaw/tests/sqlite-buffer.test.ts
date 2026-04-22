import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  openDb,
  insertTurn,
  getUnpublished,
  markInFlight,
  markPublished,
  markFailed,
  smartTruncate,
  cleanupOldTurns,
} from "../plugin/lib/sqlite-buffer.ts";
import type Database from "better-sqlite3";

describe("smartTruncate", () => {
  it("returns content unchanged when under limit", () => {
    expect(smartTruncate("hello", 100)).toBe("hello");
  });

  it("truncates with head + marker + tail", () => {
    const content = "a".repeat(200);
    const result = smartTruncate(content, 100);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toContain("[...truncated");
  });

  it("returns empty string for empty input", () => {
    expect(smartTruncate("", 100)).toBe("");
  });
});

describe("sqlite-buffer", () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflexio-test-"));
    const dbPath = path.join(tmpDir, "sessions.db");
    db = openDb(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inserts and retrieves turns", () => {
    insertTurn(db, "sess1", "user", "hello");
    insertTurn(db, "sess1", "assistant", "hi there");
    const turns = getUnpublished(db, "sess1", 3, 100);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe("user");
    expect(turns[1].role).toBe("assistant");
  });

  it("marks turns as in-flight then published", () => {
    insertTurn(db, "sess1", "user", "hello");
    const turns = getUnpublished(db, "sess1", 3, 100);
    markInFlight(db, "sess1", turns[turns.length - 1].id, 3);
    expect(getUnpublished(db, "sess1", 3, 100)).toHaveLength(0);
    markPublished(db, "sess1");
    expect(getUnpublished(db, "sess1", 3, 100)).toHaveLength(0);
  });

  it("increments retry count on failure", () => {
    insertTurn(db, "sess1", "user", "hello");
    const turns = getUnpublished(db, "sess1", 3, 100);
    markInFlight(db, "sess1", turns[0].id, 3);
    markFailed(db, "sess1");
    const after = getUnpublished(db, "sess1", 3, 100);
    expect(after).toHaveLength(1);
    // After MAX_RETRIES failures, turn should be excluded
    markInFlight(db, "sess1", after[0].id, 3);
    markFailed(db, "sess1");
    markInFlight(db, "sess1", after[0].id, 3);
    markFailed(db, "sess1");
    expect(getUnpublished(db, "sess1", 3, 100)).toHaveLength(0);
  });

  it("respects max interactions limit", () => {
    for (let i = 0; i < 10; i++) {
      insertTurn(db, "sess1", "user", `msg ${i}`);
    }
    const turns = getUnpublished(db, "sess1", 3, 5);
    expect(turns).toHaveLength(5);
  });
});
