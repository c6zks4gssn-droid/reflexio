import { describe, it, expect } from "vitest";
import { buildPayload } from "../plugin/lib/publish.ts";
import type { Turn } from "../plugin/lib/sqlite-buffer.ts";

describe("buildPayload", () => {
  it("builds correct JSON structure", () => {
    const turns: Turn[] = [
      { id: 1, session_id: "s1", role: "user", content: "hello", timestamp: "2026-01-01T00:00:00Z", published: 0, retry_count: 0 },
      { id: 2, session_id: "s1", role: "assistant", content: "hi", timestamp: "2026-01-01T00:00:01Z", published: 0, retry_count: 0 },
    ];
    const payload = buildPayload(turns, "user1", "openclaw-agent", "sess1");
    const parsed = JSON.parse(payload);
    expect(parsed.user_id).toBe("user1");
    expect(parsed.source).toBe("openclaw");
    expect(parsed.agent_version).toBe("openclaw-agent");
    expect(parsed.session_id).toBe("sess1");
    expect(parsed.interactions).toHaveLength(2);
    expect(parsed.interactions[0].role).toBe("user");
    expect(parsed.interactions[0].content).toBe("hello");
  });

  it("returns empty interactions for empty turns", () => {
    const payload = buildPayload([], "user1", "openclaw-agent", "sess1");
    const parsed = JSON.parse(payload);
    expect(parsed.interactions).toHaveLength(0);
  });
});
