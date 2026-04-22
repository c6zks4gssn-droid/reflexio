import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveServerUrl, isLocalServer } from "../plugin/lib/server.ts";

describe("resolveServerUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns REFLEXIO_URL env var when set", () => {
    process.env.REFLEXIO_URL = "https://custom.server:9090";
    expect(resolveServerUrl()).toBe("https://custom.server:9090");
  });

  it("returns default when no env var and no .env file", () => {
    delete process.env.REFLEXIO_URL;
    expect(resolveServerUrl()).toBe("http://127.0.0.1:8081");
  });
});

describe("isLocalServer", () => {
  it("returns true for localhost", () => {
    expect(isLocalServer("http://localhost:8081")).toBe(true);
  });

  it("returns true for 127.0.0.1", () => {
    expect(isLocalServer("http://127.0.0.1:8081")).toBe(true);
  });

  it("returns false for remote URL", () => {
    expect(isLocalServer("https://reflexio.ai:8081")).toBe(false);
  });

  it("returns false for localhost.evil.com", () => {
    expect(isLocalServer("https://localhost.evil.com")).toBe(false);
  });
});
