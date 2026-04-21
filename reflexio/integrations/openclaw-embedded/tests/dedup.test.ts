import { describe, it, expect } from "vitest";

import { preprocessQuery, judgeDedup, extractId } from "../plugin/lib/dedup.ts";
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

describe("judgeDedup", () => {
  it("returns merge_and_resolve when LLM merges", async () => {
    const inferFn = createMockInferFn('{"decision": "merge_and_resolve", "resolved": "User does not like Greek food."}');
    const result = await judgeDedup("User does not like Greek food.", "User likes Greek food.", inferFn);
    expect(result).toEqual({ decision: "merge_and_resolve", resolved: "User does not like Greek food." });
  });

  it("returns merge_and_resolve preserving non-contradicted facts", async () => {
    const inferFn = createMockInferFn('{"decision": "merge_and_resolve", "resolved": "User does not like Chinese food. User likes Greek food."}');
    const result = await judgeDedup(
      "User does not like Chinese food.",
      "User likes Chinese food. User likes Greek food.",
      inferFn
    );
    expect(result).toEqual({
      decision: "merge_and_resolve",
      resolved: "User does not like Chinese food. User likes Greek food.",
    });
  });

  it("returns keep_both for different topics", async () => {
    const inferFn = createMockInferFn('{"decision": "keep_both"}');
    const result = await judgeDedup("User likes dark mode", "User is a developer", inferFn);
    expect(result).toEqual({ decision: "keep_both" });
  });

  it("defaults to keep_both when infer fails", async () => {
    const inferFn = createMockInferFn(null);
    const result = await judgeDedup("A", "B", inferFn);
    expect(result).toEqual({ decision: "keep_both" });
  });

  it("defaults to keep_both on malformed JSON", async () => {
    const inferFn = createMockInferFn("I think they are related");
    const result = await judgeDedup("A", "B", inferFn);
    expect(result).toEqual({ decision: "keep_both" });
  });

  it("defaults to keep_both on merge_and_resolve with empty resolved", async () => {
    const inferFn = createMockInferFn('{"decision": "merge_and_resolve", "resolved": ""}');
    const result = await judgeDedup("A", "B", inferFn);
    expect(result).toEqual({ decision: "keep_both" });
  });

  it("defaults to keep_both on unexpected decision value", async () => {
    const inferFn = createMockInferFn('{"decision": "supersede"}');
    const result = await judgeDedup("A", "B", inferFn);
    expect(result).toEqual({ decision: "keep_both" });
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
