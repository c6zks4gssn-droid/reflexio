import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  isSetupComplete,
  markSetupComplete,
  checkReflexioInstalled,
  checkReflexioConfigured,
} from "../plugin/hook/setup.ts";

describe("isSetupComplete", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflexio-setup-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when marker does not exist", () => {
    expect(isSetupComplete(tmpDir, "main")).toBe(false);
  });

  it("returns true after markSetupComplete", () => {
    markSetupComplete(tmpDir, "main");
    expect(isSetupComplete(tmpDir, "main")).toBe(true);
  });

  it("is per-agent", () => {
    markSetupComplete(tmpDir, "main");
    expect(isSetupComplete(tmpDir, "work")).toBe(false);
  });
});

describe("checkReflexioInstalled", () => {
  it("returns a boolean", async () => {
    const result = await checkReflexioInstalled();
    expect(typeof result).toBe("boolean");
  });
});

describe("checkReflexioConfigured", () => {
  it("returns false for nonexistent directory", () => {
    expect(checkReflexioConfigured("/tmp/nonexistent-reflexio-dir-" + Date.now())).toBe(false);
  });
});
