import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runConsolidation } from "../plugin/lib/consolidate.ts";
import type { CommandRunner, InferFn, MemorySearchResult } from "../plugin/lib/openclaw-cli.ts";

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "rfx-cons-"));
  fs.mkdirSync(path.join(workspace, ".reflexio", "profiles"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".reflexio", "playbooks"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function writeTestProfile(name: string, id: string, body: string, ttl = "infinity"): string {
  const filePath = path.join(workspace, ".reflexio", "profiles", name);
  const expires = ttl === "infinity" ? "never" : "2099-01-01";
  fs.writeFileSync(filePath, `---\ntype: profile\nid: ${id}\ncreated: 2026-04-20T00:00:00Z\nttl: ${ttl}\nexpires: ${expires}\n---\n\n${body}\n`);
  return filePath;
}

function createMockRunner(searchResults: MemorySearchResult[]): CommandRunner {
  return async (argv) => {
    if (argv.includes("memory") && argv.includes("search")) {
      return { stdout: JSON.stringify({ results: searchResults }), stderr: "", code: 0 };
    }
    if (argv.includes("memory") && argv.includes("index")) {
      return { stdout: "", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "unexpected command", code: 1 };
  };
}

describe("runConsolidation", () => {
  it("does nothing with fewer than 2 files", async () => {
    writeTestProfile("single.md", "prof_aaa0", "Only one fact.");
    const runner = createMockRunner([]);
    const inferFn: InferFn = async () => null;

    const result = await runConsolidation({ workspaceDir: workspace, runner, inferFn });
    expect(result.filesDeleted).toBe(0);
    expect(result.filesWritten).toBe(0);
  });

  it("clusters by relative path (real-world memory search format)", async () => {
    const p1 = writeTestProfile("food-a.md", "prof_aaa0", "User likes Chinese food.");
    const p2 = writeTestProfile("food-b.md", "prof_bbb0", "User likes Chinese cuisine.");

    // Memory search returns RELATIVE paths (as in production)
    const searchResults: MemorySearchResult[] = [
      { path: ".reflexio/profiles/food-b.md", score: 0.8, snippet: "User likes Chinese cuisine.", startLine: 1, endLine: 5, source: "memory" },
    ];
    const runner = createMockRunner(searchResults);

    const inferFn: InferFn = async () => JSON.stringify({
      action: "consolidate",
      facts: [{ slug: "food-preference-chinese", body: "User likes Chinese food and cuisine.", source_ids: ["prof_aaa0", "prof_bbb0"] }],
      ids_to_delete: ["prof_aaa0", "prof_bbb0"],
      rationale: "Merged duplicate Chinese food preferences.",
    });

    const result = await runConsolidation({ workspaceDir: workspace, runner, inferFn });
    expect(result.filesWritten).toBe(1);
    expect(result.filesDeleted).toBe(2);
    expect(fs.existsSync(p1)).toBe(false);
    expect(fs.existsSync(p2)).toBe(false);

    const profileDir = path.join(workspace, ".reflexio", "profiles");
    const remaining = fs.readdirSync(profileDir).filter((f) => f.endsWith(".md"));
    expect(remaining).toHaveLength(1);
    const content = fs.readFileSync(path.join(profileDir, remaining[0]), "utf8");
    expect(content).toContain("User likes Chinese food and cuisine.");
  });

  it("keeps all when LLM returns keep_all", async () => {
    const p1 = writeTestProfile("food.md", "prof_aaa0", "User likes Chinese food.");
    const p2 = writeTestProfile("mode.md", "prof_bbb0", "User prefers dark mode.");

    const searchResults: MemorySearchResult[] = [
      { path: ".reflexio/profiles/mode.md", score: 0.5, snippet: "User prefers dark mode.", startLine: 1, endLine: 5, source: "memory" },
    ];
    const runner = createMockRunner(searchResults);
    const inferFn: InferFn = async () => JSON.stringify({ action: "keep_all" });

    const result = await runConsolidation({ workspaceDir: workspace, runner, inferFn });
    expect(result.filesDeleted).toBe(0);
    expect(result.filesWritten).toBe(0);
    expect(fs.existsSync(p1)).toBe(true);
    expect(fs.existsSync(p2)).toBe(true);
  });

  it("skips cluster when inferFn fails", async () => {
    writeTestProfile("a.md", "prof_aaa0", "Fact A.");
    writeTestProfile("b.md", "prof_bbb0", "Fact B.");

    const searchResults: MemorySearchResult[] = [
      { path: ".reflexio/profiles/b.md", score: 0.8, snippet: "Fact B.", startLine: 1, endLine: 5, source: "memory" },
    ];
    const runner = createMockRunner(searchResults);
    const inferFn: InferFn = async () => null;

    const result = await runConsolidation({ workspaceDir: workspace, runner, inferFn });
    expect(result.filesDeleted).toBe(0);
  });

  it("filters out self-matches from search results", async () => {
    writeTestProfile("food-a.md", "prof_aaa0", "User likes Chinese food.");
    writeTestProfile("food-b.md", "prof_bbb0", "User likes Chinese cuisine.");

    // Search returns the file itself as the top result (self-match) + a real neighbor
    const searchResults: MemorySearchResult[] = [
      { path: ".reflexio/profiles/food-a.md", score: 1.0, snippet: "User likes Chinese food.", startLine: 1, endLine: 5, source: "memory" },
      { path: ".reflexio/profiles/food-b.md", score: 0.8, snippet: "User likes Chinese cuisine.", startLine: 1, endLine: 5, source: "memory" },
    ];
    const runner = createMockRunner(searchResults);

    const inferFn: InferFn = async () => JSON.stringify({
      action: "consolidate",
      facts: [{ slug: "food-chinese", body: "User likes Chinese food.", source_ids: ["prof_aaa0", "prof_bbb0"] }],
      ids_to_delete: ["prof_aaa0", "prof_bbb0"],
      rationale: "Dedup.",
    });

    const result = await runConsolidation({ workspaceDir: workspace, runner, inferFn });
    expect(result.profilesClustered).toBe(2);
    expect(result.filesWritten).toBe(1);
    expect(result.filesDeleted).toBe(2);
  });
});
