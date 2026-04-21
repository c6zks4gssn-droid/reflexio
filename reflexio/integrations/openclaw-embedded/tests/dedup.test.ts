import { describe, it, expect } from "vitest";

import { preprocessQuery, judgeContradiction, extractId } from "../plugin/lib/dedup.ts";
import type { InferFn } from "../plugin/lib/openclaw-cli.ts";

function createMockInferFn(result: string | null): InferFn {
  return async () => {
    if (result === null) return null;
    return result;
  };
}

describe("preprocessQuery", () => {
  it("returns LLM-rewritten query on success", async () => {
    const inferFn = createMockInferFn(
      "User dietary preference vegan. Related: plant-based, no animal products"
    );
    const result = await preprocessQuery("Oh sorry I typed it wrong, I do like vegan food", inferFn);
    expect(result).toBe(
      "User dietary preference vegan. Related: plant-based, no animal products"
    );
  });

  it("falls back to raw text when infer fails", async () => {
    const inferFn = createMockInferFn(null);
    const raw = "I like apple juice";
    const result = await preprocessQuery(raw, inferFn);
    expect(result).toBe(raw);
  });

  it("falls back to raw text when infer returns empty string", async () => {
    const inferFn = createMockInferFn("");
    const raw = "timezone is PST";
    const result = await preprocessQuery(raw, inferFn);
    expect(result).toBe(raw);
  });
});

describe("judgeContradiction", () => {
  it("returns 'supersede' when LLM says supersede", async () => {
    const inferFn = createMockInferFn('{"decision": "supersede"}');
    const result = await judgeContradiction("User is vegan", "User is pescatarian", inferFn);
    expect(result).toBe("supersede");
  });

  it("returns 'keep_both' when LLM says keep_both", async () => {
    const inferFn = createMockInferFn('{"decision": "keep_both"}');
    const result = await judgeContradiction("User likes dark mode", "User is a developer", inferFn);
    expect(result).toBe("keep_both");
  });

  it("defaults to 'keep_both' when infer fails", async () => {
    const inferFn = createMockInferFn(null);
    const result = await judgeContradiction("A", "B", inferFn);
    expect(result).toBe("keep_both");
  });

  it("defaults to 'keep_both' on malformed JSON", async () => {
    const inferFn = createMockInferFn("I think they are related");
    const result = await judgeContradiction("A", "B", inferFn);
    expect(result).toBe("keep_both");
  });

  it("defaults to 'keep_both' on unexpected decision value", async () => {
    const inferFn = createMockInferFn('{"decision": "merge"}');
    const result = await judgeContradiction("A", "B", inferFn);
    expect(result).toBe("keep_both");
  });
});

describe("extractId", () => {
  it("extracts prof_ id from snippet", () => {
    const snippet = "---\ntype: profile\nid: prof_sdtk\ncreated: 2026\n---\nContent";
    expect(extractId(snippet)).toBe("prof_sdtk");
  });

  it("extracts pbk_ id from snippet", () => {
    const snippet = "---\ntype: playbook\nid: pbk_az4k\n---\nContent";
    expect(extractId(snippet)).toBe("pbk_az4k");
  });

  it("returns null when no id found", () => {
    expect(extractId("no frontmatter here")).toBeNull();
  });
});
