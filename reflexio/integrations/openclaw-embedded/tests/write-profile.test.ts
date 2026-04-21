import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { writeProfile } from "../plugin/lib/write-profile.ts";
import type { CommandRunner, MemorySearchResult, InferFn } from "../plugin/lib/openclaw-cli.ts";

let inferCallCount: number;

function createMockInferFn(results: (string | null)[]): InferFn {
  inferCallCount = 0;
  return async () => results[inferCallCount++] ?? null;
}

function createMockRunner(searchResults: MemorySearchResult[]): CommandRunner {
  return async (argv) => {
    if (argv.includes("memory") && argv.includes("search")) {
      return {
        stdout: JSON.stringify({ results: searchResults }),
        stderr: "",
        code: 0,
      };
    }
    return { stdout: "", stderr: "unexpected command", code: 1 };
  };
}

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "rfx-wp-"));
  fs.mkdirSync(path.join(workspace, ".reflexio", "profiles"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("writeProfile", () => {
  it("writes normally when no neighbors found", async () => {
    const runner = createMockRunner([]);
    const inferFn = createMockInferFn(["diet vegan query"]);

    const result = await writeProfile({
      slug: "diet-vegan", ttl: "infinity",
      body: "User is vegan.", workspace, config: { shallow_threshold: 0.4, top_k: 5 },
      runner, inferFn,
    });

    expect(fs.existsSync(result)).toBe(true);
    const content = fs.readFileSync(result, "utf8");
    expect(content).toContain("User is vegan.");
    expect(content).not.toContain("supersedes");
  });

  it("writes normally when neighbor is below threshold", async () => {
    const runner = createMockRunner([
      { path: ".reflexio/profiles/old.md", score: 0.3, snippet: "id: prof_old\n---\nOld fact", startLine: 1, endLine: 5, source: "memory" },
    ]);
    const inferFn = createMockInferFn(["diet query", null]);

    const result = await writeProfile({
      slug: "diet-vegan", ttl: "infinity",
      body: "User is vegan.", workspace, config: { shallow_threshold: 0.4, top_k: 5 },
      runner, inferFn,
    });

    expect(fs.existsSync(result)).toBe(true);
    expect(fs.readFileSync(result, "utf8")).not.toContain("supersedes");
  });

  it("supersedes when neighbor above threshold and LLM says supersede", async () => {
    const oldPath = path.join(workspace, ".reflexio", "profiles", "old.md");
    fs.writeFileSync(oldPath, "---\nid: prof_old\n---\nOld fact");

    const runner = createMockRunner(
      [{ path: oldPath, score: 0.5, snippet: "---\nid: prof_old\n---\nOld fact", startLine: 1, endLine: 5, source: "memory" }]
    );
    const inferFn = createMockInferFn(["diet vegan query", '{"decision": "supersede"}']);

    const result = await writeProfile({
      slug: "diet-vegan", ttl: "infinity",
      body: "User is vegan.", workspace, config: { shallow_threshold: 0.4, top_k: 5 },
      runner, inferFn,
    });

    expect(fs.existsSync(result)).toBe(true);
    expect(fs.readFileSync(result, "utf8")).toContain("supersedes: [prof_old]");
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it("keeps both when LLM says keep_both", async () => {
    const oldPath = path.join(workspace, ".reflexio", "profiles", "old.md");
    fs.writeFileSync(oldPath, "---\nid: prof_old\n---\nDifferent fact");

    const runner = createMockRunner(
      [{ path: oldPath, score: 0.5, snippet: "---\nid: prof_old\n---\nDifferent fact", startLine: 1, endLine: 5, source: "memory" }]
    );
    const inferFn = createMockInferFn(["query", '{"decision": "keep_both"}']);

    const result = await writeProfile({
      slug: "new-fact", ttl: "infinity",
      body: "New fact.", workspace, config: { shallow_threshold: 0.4, top_k: 5 },
      runner, inferFn,
    });

    expect(fs.existsSync(result)).toBe(true);
    expect(fs.existsSync(oldPath)).toBe(true);
    expect(fs.readFileSync(result, "utf8")).not.toContain("supersedes");
  });

  it("still writes when infer fails at preprocessing", async () => {
    const runner = createMockRunner([]);
    const inferFn = createMockInferFn([null]);

    const result = await writeProfile({
      slug: "test", ttl: "infinity",
      body: "Fact.", workspace, config: { shallow_threshold: 0.4, top_k: 5 },
      runner, inferFn,
    });

    expect(fs.existsSync(result)).toBe(true);
  });

  it("still writes when openclaw memory search fails", async () => {
    const runner = createMockRunner([]);
    const inferFn = createMockInferFn(["query"]);

    const result = await writeProfile({
      slug: "test", ttl: "infinity",
      body: "Fact.", workspace, config: { shallow_threshold: 0.4, top_k: 5 },
      runner, inferFn,
    });

    expect(fs.existsSync(result)).toBe(true);
  });

  it("throws on invalid slug", async () => {
    const runner = createMockRunner([]);
    const inferFn = createMockInferFn([]);
    await expect(
      writeProfile({
        slug: "INVALID", ttl: "infinity",
        body: "x", workspace, config: { shallow_threshold: 0.4, top_k: 5 },
        runner, inferFn,
      })
    ).rejects.toThrow("Invalid slug");
  });

  it("throws on invalid TTL", async () => {
    const runner = createMockRunner([]);
    const inferFn = createMockInferFn([]);
    await expect(
      writeProfile({
        slug: "valid", ttl: "bad_ttl" as any,
        body: "x", workspace, config: { shallow_threshold: 0.4, top_k: 5 },
        runner, inferFn,
      })
    ).rejects.toThrow("Invalid TTL");
  });
});
