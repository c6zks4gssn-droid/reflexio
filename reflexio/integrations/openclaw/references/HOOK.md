---
name: reflexio-federated-hook
description: "Automatically capture conversations and inject cross-session context before every response"
metadata:
  openclaw:
    emoji: "🧠"
    events: ["agent:bootstrap", "message:received", "message:sent", "command:stop"]
    requires:
      bins: ["reflexio"]
      env: []
---

# Reflexio Federated Hook

The hook is the core component that enables automatic conversation capture and context injection. It runs on every agent session and persists data to a local SQLite buffer.

## What the Hook Does

The hook is pure TypeScript + native Node.js HTTP. It does not spawn subprocesses or invoke the `reflexio` CLI directly from the hook code — all traffic is HTTP to the local Reflexio server at `http://127.0.0.1:8081`.

### On `agent:bootstrap` (session start)

- Checks if the Reflexio server is running via health check to `http://127.0.0.1:8081/health`
- If server is not running and hasn't been started recently, spawns `reflexio services start --only backend` in the background
- Retries any unpublished conversations from previous sessions where the server was unavailable
- Optional: fetches user profile summary via search to inject as bootstrap context (if available)

### On `message:received` (before each response)

- Executes semantic search on the user message against stored playbooks and profiles
- If results are found, formats them as markdown and injects as context
- Skips search for trivial inputs (< 5 chars, or yes/no/ok/sure/thanks) to reduce noise
- Times out after `search.timeout_ms` (default: 5000) — never blocks the response
- If search fails or times out, the agent proceeds without injected context (graceful degradation)

### On `message:sent` (each turn)

- Buffers the (user message, agent response) pair into local SQLite (`~/.reflexio/sessions.db`)
- Lightweight local write — no network calls
- If buffer exceeds `publish.batch_size` unpublished turns, triggers an incremental publish
- Ensures buffered data persists across sessions even if the server is down

### On `command:stop` (session end)

- Flushes all remaining buffered conversations to the Reflexio server via `reflexio publish`
- Blocks briefly on the HTTP round-trip; if it fails, turns stay buffered and are retried on next `agent:bootstrap`
- After successful publish, triggers background aggregation of playbooks across all agents

## Prerequisites

1. **`reflexio` CLI on PATH** — `pipx install reflexio-ai` or `pip install --user reflexio-ai`. The hook spawns this CLI to start the backend server and publish conversations.

2. **Node.js 18+** — Required to run the plugin and hook.

3. **An LLM provider API key in `~/.reflexio/.env`** — **Required for the backend server to work end-to-end, even though the hook itself never reads it.** The local Reflexio server uses this key to extract playbooks and profiles via LiteLLM. The first-use setup wizard will prompt you to select a provider (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, MiniMax, DashScope, xAI, Moonshot, ZAI, or local LLM via custom endpoint) and write the key for you.

The plugin manifest does not declare this LLM key under `requires.env` because that field describes variables the hook itself reads, and the hook is deliberately stateless (no env var access, no filesystem config reads — enforced in code). The dependency lives one hop away at the backend server.

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

All defaults are reasonable for local operation. To customize, edit `plugin/openclaw.plugin.json` and restart the agent.

## Safety and Privacy

### Security contract — hook side

The hook is **hard-pinned to `http://127.0.0.1:8081`**. The destination is a hardcoded constant in `hook/handler.ts`; changing it requires editing the source. The hook:

- Reads **no environment variables**
- Reads **no configuration files**
- Has **no code path** that reaches any external host
- Derives user identity from OpenClaw's session key (e.g., `agent:main:...` → `user_id: "main"`), with fallback to `openclaw`

All settings are hardcoded at module scope:
- Server URL: `http://127.0.0.1:8081` (loopback, not configurable)
- Agent label: `openclaw-agent` (not configurable)
- User ID: auto-derived from session key prefix

If you need remote Reflexio from OpenClaw, run a local proxy at `127.0.0.1:8081` or use the Claude Code integration, which supports full configuration overrides.

### Privacy: what the hook guarantees, what it doesn't

The hook itself communicates only with `http://127.0.0.1:8081`. It reads no environment variables, no configuration files, and has no code path that reaches any other host.

**The local Reflexio server, however, makes outbound LLM API calls** for profile/playbook extraction. The destination is whatever you configured in `~/.reflexio/.env` (OpenAI, Anthropic, Gemini, etc.). If that provider is external, excerpts of your conversations will be sent to it.

**If you want a fully offline setup, configure the server to use a local LLM:**
- Ollama (free, runs locally)
- LM Studio (free, runs locally)
- vLLM (free, runs locally)

Provide the local endpoint (e.g., `http://127.0.0.1:11434`) as your LLM provider during first-use setup.

## Buffering and Retry

The hook uses SQLite to buffer conversations locally:

- **Location**: `~/.reflexio/sessions.db`
- **Retention**: Buffered turns are kept until successfully published to the server
- **Retry logic**: On every `agent:bootstrap`, the hook retries any unpublished sessions
- **Graceful degradation**: If the server is down, the agent works normally and buffers persist

This ensures no data loss even if the server is temporarily unavailable.

## Timing and Timeouts

The hook respects strict timing bounds to never degrade agent performance:

- **Search timeout**: 5 seconds (configurable via `search.timeout_ms`)
  - If the server is slow, search times out and the agent proceeds without context
  - No context is better than a slow response
  
- **Health check timeout**: 3 seconds (configurable via `server.health_check_timeout_ms`)
  - If the server doesn't respond, assume it's down and attempt restart
  
- **Server startup**: Runs in background, doesn't block agent bootstrap
  - Hook checks for a stale startup flag (older than 2 minutes) and retries if needed

## Lifecycle Events

| Event | Trigger | Typical Action |
|-------|---------|---|
| `agent:bootstrap` | Agent session starts | Start server if needed, retry unpublished turns, inject user profile |
| `message:received` | User sends a message | Inject playbooks/profiles from search |
| `message:sent` | Agent responds | Buffer turn, maybe publish if batch size exceeded |
| `command:stop` | User ends session | Flush all buffered turns to server |

## Debugging

To see hook logs during development:

```bash
# Run agent with stderr visible
openclaw chat 2>&1 | grep "\[reflexio\]"

# Or redirect to a file and tail
openclaw chat 2>hook.log &
tail -f hook.log
```

All hook log lines are prefixed with `[reflexio]` for easy filtering.

## Implementation Details

The hook is implemented in TypeScript in `plugin/hook/`:

- **`handler.ts`** — Event handlers for all four lifecycle events
- **`setup.ts`** — First-use setup: CLI detection, LLM provider prompt, server start

Supporting libraries in `plugin/lib/`:

- **`server.ts`** — Server health check, startup logic
- **`user-id.ts`** — User identity resolution from session key
- **`sqlite-buffer.ts`** — Turn buffering and retry management
- **`publish.ts`** — Publish command construction and CLI spawn
- **`search.ts`** — Search API call and result formatting
