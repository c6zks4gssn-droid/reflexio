// Reflexio Federated — Openclaw plugin entry.
//
// Registers lifecycle hooks and one tool against the Openclaw Plugin API:
//   - before_prompt_build: auto-setup, search injection, retry old sessions
//   - message_sent:        buffer turn to SQLite, incremental publish
//   - before_compaction:   flush unpublished turns before transcript is lost
//   - before_reset:        flush unpublished turns before transcript is wiped
//   - session_end:         final flush of all remaining turns
//   - reflexio_publish:    agent-invoked immediate flush
//
// All core logic lives in ./hook/handler.ts — this file is only SDK wiring.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import {
  handleBeforePromptBuild,
  handleMessageSent,
  handleSessionFlush,
  handleToolPublish,
  DEFAULT_CONFIG,
  type PluginConfig,
} from "./hook/handler.ts";

// Track the most recently active session key, updated by before_prompt_build and message_sent.
//
// LIMITATION: This is a process-global variable. The Openclaw Plugin SDK does not pass session
// context into the tool `execute` callback, so `reflexio_publish` can only target the most
// recently active session. If multiple sessions run concurrently in the same process, this value
// will reflect whichever session fired last — meaning `reflexio_publish` may flush the wrong
// session's turns. This plugin is designed for single-session use. Concurrent multi-session
// support would require the Plugin SDK to expose session context in the tool execute callback.
let _activeSessionKey = "";

export default definePluginEntry({
  id: "reflexio-federated",
  name: "Reflexio Federated",
  description:
    "Cross-session memory via Reflexio server. Publishes conversations for extraction, injects relevant profiles and playbooks before each response.",
  register(api) {
    const log = api.logger;
    const runner = api.runtime.system.runCommandWithTimeout;

    // Merge user config with defaults
    const rawConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const config: PluginConfig = {
      publish: { ...DEFAULT_CONFIG.publish, ...((rawConfig.publish as Record<string, number>) ?? {}) },
      search: { ...DEFAULT_CONFIG.search, ...((rawConfig.search as Record<string, number>) ?? {}) },
      server: { ...DEFAULT_CONFIG.server, ...((rawConfig.server as Record<string, number>) ?? {}) },
    };

    // before_prompt_build: setup, search, retry
    api.on("before_prompt_build", async (_event: unknown, ctx: unknown) => {
      const context = ctx as { agentId?: string; sessionKey?: string };
      const sessionKey = context.sessionKey ?? "";
      const agentId = context.agentId ?? "main";
      if (sessionKey) _activeSessionKey = sessionKey;

      // Extract prompt from event (best-effort)
      const eventObj = _event as { prompt?: string; messages?: { role?: string; content?: unknown }[] };
      let prompt = eventObj.prompt;
      if (!prompt && Array.isArray(eventObj.messages)) {
        const lastUser = [...eventObj.messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          prompt = typeof lastUser.content === "string"
            ? lastUser.content
            : JSON.stringify(lastUser.content);
        }
      }

      const result = await handleBeforePromptBuild(
        sessionKey,
        agentId,
        prompt,
        runner,
        config,
        log,
      );

      if (result.prependSystemContext) {
        return { prependSystemContext: result.prependSystemContext };
      }
    });

    // message_sent: buffer turn to SQLite
    api.on("message_sent", (_event: unknown, ctx: unknown) => {
      const context = ctx as { sessionKey?: string };
      const event = _event as { userMessage?: string; agentResponse?: string; content?: string; role?: string };
      const sessionKey = context.sessionKey ?? "";
      if (sessionKey) _activeSessionKey = sessionKey;
      handleMessageSent(
        sessionKey,
        event.userMessage,
        event.agentResponse ?? (event.role === "assistant" ? (typeof event.content === "string" ? event.content : undefined) : undefined),
        runner,
        config,
        log,
      );
    });

    // before_compaction: flush before transcript is compacted
    api.on("before_compaction", async (_event, ctx) => {
      handleSessionFlush(ctx.sessionKey ?? "", log, config);
    });

    // before_reset: flush before transcript is wiped
    api.on("before_reset", async (_event, ctx) => {
      handleSessionFlush(ctx.sessionKey ?? "", log, config);
    });

    // session_end: final flush
    api.on("session_end", async (event, ctx) => {
      handleSessionFlush(ctx.sessionKey ?? event.sessionKey ?? "", log, config);
    });

    // reflexio_publish tool: agent-invoked immediate flush
    api.registerTool({
      name: "reflexio_publish",
      description:
        "Immediately publish all buffered conversation turns to the Reflexio server. " +
        "Use after user corrections, key milestones, or high-signal moments when you " +
        "don't want to wait for the automatic session-end publish.",
      parameters: { type: "object", properties: {} },
      optional: true,
      async execute(_id: string, _params: Record<string, unknown>) {
        // Use the module-level active session key tracked by before_prompt_build and message_sent.
        const result = handleToolPublish(_activeSessionKey, log, config);
        return { content: [{ type: "text" as const, text: result }] };
      },
    });
  },
});
