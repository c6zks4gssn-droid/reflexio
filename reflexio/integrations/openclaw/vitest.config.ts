import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      // Point HOME to a nonexistent path so tests cannot accidentally read
      // ~/.reflexio/.env or other real user config files. Tests that need
      // specific home-dir content must set HOME themselves.
      HOME: "/nonexistent-test-home",
    },
  },
});
