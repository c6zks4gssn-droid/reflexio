import { describe, it, expect } from "vitest";
import { shouldSkipSearch, formatSearchContext } from "../plugin/lib/search.ts";

describe("shouldSkipSearch", () => {
  it("skips short messages", () => {
    expect(shouldSkipSearch("hi", 5)).toBe(true);
  });

  it("skips trivial responses", () => {
    expect(shouldSkipSearch("yes", 5)).toBe(true);
    expect(shouldSkipSearch("ok", 5)).toBe(true);
    expect(shouldSkipSearch("thanks", 5)).toBe(true);
    expect(shouldSkipSearch("Sure", 5)).toBe(true);
  });

  it("does not skip real messages", () => {
    expect(shouldSkipSearch("Write a Python function to sort a list", 5)).toBe(false);
  });
});

describe("formatSearchContext", () => {
  it("returns null for empty results", () => {
    expect(formatSearchContext("")).toBeNull();
    expect(formatSearchContext("Found 0 profiles, 0 playbooks")).toBeNull();
  });

  it("returns trimmed content for real results", () => {
    const result = formatSearchContext("## Playbooks\n- Use type hints");
    expect(result).toBe("## Playbooks\n- Use type hints");
  });
});
