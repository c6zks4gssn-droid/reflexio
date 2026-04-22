---
name: reflexio-federated-plugin
description: "Automatically capture conversations and inject cross-session context before every response"
metadata:
  openclaw:
    emoji: "🧠"
    hooks: ["before_prompt_build", "message_sent", "before_compaction", "before_reset", "session_end"]
    requires:
      bins: ["reflexio"]
      env: ["REFLEXIO_USER_ID", "REFLEXIO_AGENT_VERSION"]
---

# Reflexio Federated Plugin

The plugin is the core component that enables automatic conversation capture and cross-session context injection. It is implemented against the **Openclaw Plugin SDK** (`openclaw/plugin-sdk`) and runs on every agent session, persisting data to a local SQLite buffer.

## Plugin SDK Hooks

The plugin registers the following hooks via `api.on(...)` in the Plugin SDK:

### `before_prompt_build` (before each response)

Fires before the agent builds its next response. This is the primary hook — it handles:

1. **First-use setup check** — detects whether the `reflexio` CLI is installed and configured. If setup is needed, injects a setup instruction into the system context.
2. **Server auto-start** — checks if the local Reflexio server is healthy via a health check; if not, spawns `reflexio services start --only backend` in the background.
3. **Retry unpublished turns** — publishes any buffered turns from previous sessions that failed to reach the server.
4. **Search injection** — runs `reflexio search` on the user's message and, if results are found, prepends them as system context before the agent responds. Skips search for trivial/short inputs to reduce noise. Times out after `search.timeout_ms` (default: 5 000 ms) — never blocks the response.

### `message_sent` (each turn)

Fires after the agent sends a response. Buffers the (user message, agent response) pair into local SQLite at `~/.reflexio/sessions.db`. Lightweight local write — no network calls. If the buffer exceeds `publish.batch_size * 2` unpublished turns, triggers an incremental publish to the server.

### `before_compaction` (before transcript compaction)

Fires before Openclaw compacts the transcript. Flushes all unpublished buffered turns to the Reflexio server so no data is lost when the compaction discards history.

### `before_reset` (before transcript wipe)

Fires before Openclaw wipes the transcript (e.g., `/reset`). Same as `before_compaction` — flushes all remaining unpublished turns.

### `session_end` (session end)

Fires when the session ends. Performs a final flush of all remaining buffered turns to the Reflexio server.

## Tool: `reflexio_publish`

In addition to hooks, the plugin registers one agent-invocable tool:

- **`reflexio_publish`** — immediately flushes all buffered conversation turns to the Reflexio server. Useful after user corrections or high-signal moments when automatic session-end flushing would be too late.

> **Single-session limitation:** The `execute` callback in the Plugin SDK does not receive session context, so this tool always targets the most recently active session. Concurrent multi-session use is not supported.

## Prerequisites

1. **`reflexio` CLI on PATH** — `pipx install reflexio-ai` or `pip install --user reflexio-ai`. The plugin shells out to this CLI to start the backend server and publish conversations.

2. **Node.js 18+** — Required to run the plugin.

3. **An LLM provider API key in `~/.reflexio/.env`** — Required for the backend server to extract playbooks and profiles. The first-use setup wizard prompts you to configure this on the first agent session.

## Configuration

All settings are optional and defined in `plugin/openclaw.plugin.json` under the `configSchema`:

### `publish` — Conversation capture and publish behavior

```json
"publish": {
  "batch_size": 10,           // Number of turns to buffer before mid-session publish
  "max_retries": 3,           // Retry count for failed publish attempts
  "max_content_length": 10000 // Max characters per turn (prevents oversized payloads)
}
```

### `search` — Context injection before each response

```json
"search": {
  "timeout_ms": 5000,         // Max time to wait for search results
  "top_k": 5,                 // Number of playbooks to return per search
  "min_prompt_length": 5      // Skip search for inputs shorter than this
}
```

### `server` — Reflexio server health and startup

```json
"server": {
  "health_check_timeout_ms": 3000,  // Time limit for health checks
  "stale_flag_ms": 120000           // Flag file age before retry (2 minutes)
}
```

## Security and Privacy

### What the plugin reads

- **Environment variables**: `REFLEXIO_USER_ID` (overrides auto-derived user ID) and `REFLEXIO_AGENT_VERSION` (overrides agent version label). Both are optional.
- **`~/.openclaw/openclaw.json`**: read by the Openclaw host process to load the plugin; the plugin itself does not read this file directly.
- **`~/.reflexio/.env`**: read to resolve `REFLEXIO_URL` if the env var is not set in the process environment.

### What the plugin shells out to

The plugin spawns the `reflexio` CLI for:
- `reflexio services start --only backend` — starts the local server if not running
- `reflexio search <query>` — fetches context from the local server
- `reflexio interactions publish --file <payload.json>` — publishes buffered turns

All spawned processes use the binary on your `PATH`. If `reflexio` is not found, the `error` event on the child process is caught, the affected turns are marked for retry, and the plugin continues working without blocking the agent.

### Network destinations

The plugin communicates only with the Reflexio server at the URL resolved from `REFLEXIO_URL` / `~/.reflexio/.env` / default `http://127.0.0.1:8081`. Local-server detection uses exact hostname matching (`127.0.0.1` or `localhost`); only local servers are auto-started.

**The local Reflexio server makes outbound LLM API calls** for profile/playbook extraction. The destination depends on your `~/.reflexio/.env` configuration (OpenAI, Anthropic, Gemini, or a local LLM). For a fully offline setup, configure a local LLM provider (Ollama, LM Studio, vLLM) during first-use setup.

## Buffering and Retry

The plugin uses SQLite to buffer conversations locally:

- **Location**: `~/.reflexio/sessions.db`
- **Retention**: Buffered turns are kept until successfully published to the server
- **Retry logic**: On every `before_prompt_build`, the plugin retries any unpublished sessions from previous runs (up to `max_retries`)
- **Graceful degradation**: If the server is down, the agent works normally and buffers persist

## Lifecycle Summary

| Hook | Trigger | Actions |
|------|---------|---------|
| `before_prompt_build` | Before each agent response | Setup check, server auto-start, retry old sessions, search injection |
| `message_sent` | After each agent response | Buffer turn to SQLite, incremental publish if batch threshold exceeded |
| `before_compaction` | Before transcript compaction | Flush all unpublished turns |
| `before_reset` | Before transcript wipe | Flush all unpublished turns |
| `session_end` | Session ends | Final flush of all remaining turns |

## Implementation

The plugin is implemented in TypeScript in `plugin/`:

- **`index.ts`** — SDK wiring: `definePluginEntry`, hook registration, tool registration
- **`hook/handler.ts`** — Core logic: `handleBeforePromptBuild`, `handleMessageSent`, `handleSessionFlush`, `handleToolPublish`
- **`hook/setup.ts`** — First-use setup: CLI detection, LLM provider prompt, server start

Supporting libraries in `plugin/lib/`:

- **`server.ts`** — URL resolution, health check, auto-start
- **`user-id.ts`** — User identity and agent version resolution from env vars / session key
- **`sqlite-buffer.ts`** — Turn buffering, retry management
- **`publish.ts`** — Payload construction, CLI spawn with error handling
- **`search.ts`** — Search invocation, result formatting, trivial-input filtering

## Debugging

All plugin log lines are prefixed with `[reflexio]` for easy filtering:

```bash
# Option A: capture stderr to file and tail it
openclaw chat 2>reflexio-plugin.log
tail -f reflexio-plugin.log | grep "\[reflexio\]"

# Option B: watch inline
openclaw chat 2>&1 | grep "\[reflexio\]"
```
