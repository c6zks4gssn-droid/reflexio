# Reflexio OpenClaw Federated Plugin

Connect [OpenClaw](https://openclaw.ai) agents to [Reflexio](https://github.com/reflexio-ai/reflexio) for automatic cross-session memory with multi-user support. Conversations are captured automatically to a local SQLite buffer, published to the Reflexio server on session end, and relevant profiles and playbooks are injected before every response via a hook.

## Table of Contents

- [How It Works](#how-it-works)
- [Multi-User Architecture](#multi-user-architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [First-Use Setup](#first-use-setup)
- [Configuration](#configuration)
- [Using `reflexio_publish` Tool](#using-reflexio_publish-tool)
- [Cross-Session Retrieval](#cross-session-retrieval)
- [File Structure](#file-structure)
- [Comparison with openclaw-embedded](#comparison-with-openclaw-embedded)
- [Uninstall](#uninstall)
- [Manual Testing](#manual-testing)

## How It Works

The plugin has three independent mechanisms:

### 1. Capture (Automatic via Hook)

```
Each Turn (message:sent)
  └── Buffer (user message, agent response) → local SQLite (~/.reflexio/sessions.db)

Session End (command:stop)
  └── Flush all buffered turns to Reflexio server via reflexio_publish CLI
      └── Server automatically:
          1. Analyzes conversation via LLM pipeline
          2. Extracts playbooks: behavior instructions with context (trigger, rationale, blocking_issue)
          3. Extracts user profiles: preferences, expertise, communication patterns
          4. Stores everything with vector embeddings for semantic search
```

Correction detection happens **server-side via LLM** — the plugin does not detect corrections itself.

### 2. Retrieve (Automatic via Hook Injection)

```
Per-message (message:received hook — automatic)
  └── Hook injects search results from reflexio search before every agent response
      └── Returns user playbooks + agent playbooks relevant to the current message
      └── Semantic search matches message content against playbook triggers
```

Both user playbooks (corrections specific to this agent instance) and agent playbooks (shared corrections aggregated from all instances) are returned and injected as context.

### 3. Aggregate (Automatic, optional manual trigger)

```
After each publish
  └── Aggregation runs in background automatically
      └── Clusters similar user playbooks across all agent instances
      └── Deduplicates and consolidates into shared agent playbooks
      └── New agent playbooks start as PENDING → can be reviewed → APPROVED/REJECTED

Manual trigger
  └── reflexio agent-playbooks aggregate  (CLI)
```

Agent playbooks accumulate corrections from all agent instances, so every instance benefits from corrections made by any other instance.

## Multi-User Architecture

Each OpenClaw agent (identified by its `agentId`) is treated as a distinct Reflexio user. This enables per-agent learning isolation alongside cross-agent shared learning:

```
~/.openclaw/
├── agents/
│   ├── main/        → Reflexio user_id: "main"
│   ├── work/        → Reflexio user_id: "work"
│   └── ops/         → Reflexio user_id: "ops"
```

- **User playbooks**: per-agent corrections, isolated by `agentId`. Mistakes made by `main` are tracked separately from mistakes made by `work`.
- **Agent playbooks**: shared corrections aggregated from ALL agents. Once a correction is aggregated and approved, every instance sees it via `reflexio search`.
- **`user_id`** is derived from the OpenClaw session key prefix (`agent:<id>:...`), with fallback to `openclaw`. There is no override — the hook is deliberately locked to automatic identity resolution to eliminate env-var reads.


## Prerequisites

- [OpenClaw](https://openclaw.ai) installed and running
- [Node.js](https://nodejs.org/) 18+ (for the plugin runtime)
- The `reflexio` CLI on PATH: `pipx install reflexio-ai` (or `pip install --user reflexio-ai`)
- An LLM API key for the Reflexio server (e.g., `OPENAI_API_KEY`) — required for playbook/profile extraction but read only by the server, never by the hook

Supported LLM providers: OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, MiniMax, DashScope, xAI, Moonshot, ZAI, or any local LLM endpoint (Ollama, LM Studio, vLLM).

## Installation

### Option 1 — ClawHub (recommended)

```bash
clawhub plugin install reflexio-federated
```

On first use, the plugin auto-installs the `reflexio-ai` CLI (via `pipx` or `pip`) and runs first-use setup.

### Option 2 — From Source (if you have `reflexio-ai` and Node.js installed)

```bash
cd /path/to/reflexio/integrations/openclaw
./scripts/install.sh
```

This installs the plugin from source, registers it with OpenClaw, and restarts the gateway.

### Option 3 — Manual (for development)

```bash
# Build the plugin
cd /path/to/reflexio/integrations/openclaw/plugin
npm install
npm run typecheck
npm run build  # if applicable

# Install via openclaw
cd /path/to/reflexio/integrations/openclaw
./scripts/install.sh
```

## First-Use Setup

On the first OpenClaw session after installation, the plugin automatically:

1. Detects if the `reflexio` CLI is installed; if not, installs it via `pipx`
2. Creates `~/.reflexio/` configuration directory if it doesn't exist
3. Prompts for LLM provider selection (OpenAI, Anthropic, Gemini, etc.) and API key
4. Configures the local storage backend (SQLite for local use, Supabase optional)
5. Starts the Reflexio server in the background at `http://127.0.0.1:8081`
6. Runs first search to verify setup is complete

**No manual steps required** — everything is automatic and transparent to the user.

## Configuration

This plugin stores all configuration in `plugin/openclaw.plugin.json` and reads the following tunable settings:

### `publish` — Conversation capture and publish behavior

- `batch_size` (default: 10): Number of turns to buffer before mid-session publish. At session end, all remaining turns are flushed regardless.
- `max_retries` (default: 3): Number of times to retry failed publish attempts.
- `max_content_length` (default: 10000): Maximum character length per turn to avoid oversized payloads.

### `search` — Context injection before each response

- `timeout_ms` (default: 5000): Maximum time to wait for search results. If the server is slow, search times out and the agent proceeds without injected context (graceful degradation).
- `top_k` (default: 5): Number of playbooks to return per search.
- `min_prompt_length` (default: 5): Skip search for trivial inputs (< 5 chars, or yes/no/ok/sure/thanks).

### `server` — Reflexio server health and startup

- `health_check_timeout_ms` (default: 3000): Time limit for server health checks. Used to determine if a restart is needed.
- `stale_flag_ms` (default: 120000): Flag file age threshold. If a startup flag is older than 2 minutes, assume the previous startup attempt failed and try again.

All settings are optional and have sensible defaults. To override, edit `plugin/openclaw.plugin.json` and restart the agent.

## Using `reflexio_publish` Tool

Conversations are automatically published at session end. For high-signal moments, use the `reflexio_publish` tool to flush immediately:

- **User corrects you** and confirms the fix (explicit "good" / "perfect" or moves on)
- **You complete a key milestone** with non-obvious learnings
- **High-friction session** with multiple corrections

The Reflexio server handles extraction (profiles, playbooks) from the published conversations. You don't need to structure the data — just publish, and the server does the rest.

## Cross-Session Retrieval

**Session 1 (cold start):** No playbooks exist yet. The agent works normally. At session end, the hook captures and publishes the full conversation. The Reflexio server's LLM pipeline analyzes it and extracts corrections or user preferences.

**Session 2+:** Before each response, the hook runs `reflexio search` and injects matching playbooks and profiles as context. Over time:

- Mistakes made once are not repeated (corrections match by trigger similarity)
- User preferences are remembered (profiles extracted automatically)
- The agent adapts its approach per-task based on accumulated playbooks
- Corrections from one agent instance propagate to all instances via aggregation

## File Structure

```
openclaw/
├── README.md                   ← This file
├── TESTING.md                  ← Manual testing guide
├── plugin/                     ← Compiled plugin (OpenClaw extension)
│   ├── openclaw.plugin.json    ← Plugin manifest and config schema
│   ├── package.json            ← NPM metadata
│   ├── lib/                    ← Core libraries
│   │   ├── user-id.ts          ← Multi-user identity resolution
│   │   ├── server.ts           ← Server URL, health check, auto-start
│   │   ├── sqlite-buffer.ts    ← Turn buffering
│   │   ├── publish.ts          ← Publish and CLI spawn
│   │   └── search.ts           ← Search and result formatting
│   ├── hook/                   ← Hook event handlers
│   │   ├── handler.ts          ← Core hook logic (bootstrap, message events, command:stop)
│   │   └── setup.ts            ← First-use setup (CLI install, storage config)
│   ├── skills/                 ← Agent instruction and tooling
│   │   └── reflexio/
│   │       └── SKILL.md        ← Teaches agent when/how to search and publish
│   ├── rules/                  ← Always-active behavioral constraints
│   │   └── reflexio.md         ← Follow injected context, manual fallback, transparency
│   └── index.ts                ← Plugin entry point (SDK registration)
├── hook/                       ← Flat hook for manual installation
│   ├── handler.ts              ← Same as plugin/hook/handler.ts
│   └── HOOK.md                 ← Hook metadata (see references/HOOK.md)
├── scripts/                    ← Installation and uninstall
│   ├── install.sh              ← Plugin installation
│   └── uninstall.sh            ← Plugin removal (preserves user data)
└── _old/                       ← Legacy documentation and code (to be removed)
```

## Comparison with openclaw-embedded

| Aspect               | openclaw (federated)                     | openclaw-embedded                       |
| -------------------- | ---------------------------------------- | --------------------------------------- |
| Architecture         | Federated (server-based)                 | Standalone (no server)                  |
| Storage              | Reflexio server + SQLite buffer          | Local SQLite only                       |
| Multi-user support   | Yes — per-agentId user isolation         | Single user per instance                |
| Cross-instance sync  | Yes — via agent playbooks aggregation    | No — isolated per instance              |
| Prerequisites        | Reflexio CLI, LLM API key, Node.js       | SQLite (no server, no API key needed)   |
| Best for             | Teams, multiple agents, persistent core  | Single agent, offline-first, lightweight |
| Deployment           | Reflexio server + OpenClaw agents        | Standalone OpenClaw agent               |

**Use the federated plugin if:**
- Multiple agents run on the same machine or team (shared learnings via aggregation)
- Corrections from one agent should propagate to others
- A persistent Reflexio server is acceptable

**Use openclaw-embedded if:**
- Single agent, offline-first operation required
- No external dependencies or API keys
- Lightweight, self-contained setup

## Uninstall

### Remove the plugin

```bash
./scripts/uninstall.sh
```

This removes the plugin from OpenClaw, cleans up state files, and preserves user data in `~/.reflexio/`.

### Remove user data (optional)

```bash
./scripts/uninstall.sh --purge
```

This also deletes `~/.reflexio/` entirely.

### Verify removal

```bash
openclaw plugins list
# Should not show reflexio-federated
```

## Manual Testing

See [TESTING.md](TESTING.md) for a complete step-by-step manual testing guide covering:
- Install verification
- First-session auto-setup
- Search injection
- Conversation capture and publish
- `reflexio_publish` tool usage
- Cross-session retry
- Multi-user isolation
- Graceful degradation
- Uninstall
