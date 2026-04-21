import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveUserId, stripJsonComments, _resetCache } from "../plugin/lib/user-id.ts";

describe("stripJsonComments", () => {
  it("strips line comments", () => {
    expect(stripJsonComments('{ "key": "val" } // comment')).toBe('{ "key": "val" } ');
  });

  it("preserves URLs in quoted strings", () => {
    expect(stripJsonComments('{ "url": "http://example.com" }')).toBe(
      '{ "url": "http://example.com" }',
    );
  });

  it("strips comment after quoted string containing //", () => {
    expect(stripJsonComments('{ "url": "http://x.com" } // note')).toBe(
      '{ "url": "http://x.com" } ',
    );
  });
});

describe("resolveUserId", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    _resetCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns REFLEXIO_USER_ID env var if set", () => {
    process.env.REFLEXIO_USER_ID = "custom-user";
    expect(resolveUserId("agent:main:abc123")).toBe("custom-user");
  });

  it("extracts agentId from session key format agent:<id>:<key>", () => {
    expect(resolveUserId("agent:work:session789")).toBe("work");
  });

  it("falls back to 'openclaw' when no session key or env", () => {
    expect(resolveUserId("")).toBe("openclaw");
  });

  it("falls back to 'openclaw' for non-agent session key format", () => {
    expect(resolveUserId("random-session-key")).toBe("openclaw");
  });
});
