# Reflexio OpenClaw-Embedded Plugin

A lightweight Openclaw plugin that delivers Reflexio-style user profile and playbook capabilities entirely within Openclaw's native primitives — no Reflexio server required.

## Table of Contents

- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [First-use Setup](#first-use-setup)
- [Configuration](#configuration)
- [Comparison with Other Reflexio Integrations](#comparison-with-other-reflexio-integrations)
- [Uninstall](#uninstall)
- [Further Reading](#further-reading)

## How It Works

The plugin captures two kinds of memory:

- **Profiles** — durable user facts (diet, preferences, timezone, role). Stored as `.md` files under `.reflexio/profiles/` with a TTL.
- **Playbooks** — procedural rules learned from corrections (user corrects → agent adjusts → user confirms → rule written). Stored under `.reflexio/playbooks/`.

Three flows capture memory at different moments:

- **Flow A (in-session profile)**: agent detects a preference/fact/config in the user message and writes immediately via the `reflexio_write_profile` tool.
- **Flow B (in-session playbook)**: agent recognizes correction+confirmation multi-turn pattern and writes via `reflexio_write_playbook`.
- **Flow C (session-end batch)**: hooks fire on `before_compaction`, `before_reset`, and `session_end`; spawn a `reflexio-extractor` sub-agent that extracts from the full transcript, runs dedup, and writes/deletes `.md` files.

Consolidation runs on-demand via `reflexio_run_consolidation` tool or automatically via heartbeat check (`reflexio_consolidation_check`). It clusters similar files, asks the LLM to deduplicate/merge/resolve contradictions, and writes one-fact-per-file outputs.

All retrieval is via Openclaw's memory engine — vector + FTS + MMR + temporal decay. When Active Memory is enabled, relevant profiles/playbooks are auto-injected into each turn.

## Prerequisites

- [OpenClaw](https://openclaw.ai) installed and `openclaw` CLI on PATH
- Node.js (for the plugin runtime)
- macOS or Linux (Windows via WSL)
- A bash-compatible shell (install/uninstall scripts use `#!/usr/bin/env bash`)
- Strongly recommended:
  - An embedding provider API key (OpenAI, Gemini, Voyage, or Mistral) for vector search
  - The `active-memory` plugin enabled (auto-retrieval into turns)

The plugin works without active-memory and without an embedding key — with degraded retrieval quality. See `references/architecture.md` for degradation modes.

## Installation

```bash
# From the plugin directory:
./scripts/install.sh
```

What it does:
1. Installs the `plugin/` directory as an Openclaw plugin (copied to `~/.openclaw/extensions/reflexio-embedded/`)
2. Enables the `active-memory` plugin and configures agent targeting + `.reflexio/` extraPath
3. Restarts the Openclaw gateway

Skills are auto-served from the extension directory via the manifest. Agent definitions are injected via `extraSystemPrompt` at runtime. Heartbeat entry is appended to `HEARTBEAT.md` on first agent session by `setup.ts`.

## First-use Setup

The first time an agent invokes the `reflexio-embedded` skill, it runs a one-time bootstrap:

1. Probes current config via `openclaw config get` + `openclaw memory status --deep`.
2. For any missing prereq, asks the user for approval before running `openclaw config set`.
3. On success, creates `.reflexio/.setup_complete_<agentId>` marker — subsequent sessions skip.

This guarantees zero manual `openclaw.json` editing. If exec is denied by admin policy, the skill prints the exact commands for the user to run manually.

## Configuration

Defaults are defined in `openclaw.plugin.json` via `configSchema`. To override, add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "reflexio-embedded": {
        "config": {
          "dedup": { "shallow_threshold": 0.4, "top_k": 5 },
          "consolidation": { "threshold_hours": 24 }
        }
      }
    }
  }
}
```

Tunables:

| Knob | Default | What it controls |
|---|---|---|
| `dedup.shallow_threshold` | 0.4 | Similarity above which in-session writes trigger dedup |
| `dedup.full_threshold` | 0.75 | Similarity cluster-member cutoff in consolidation |
| `dedup.top_k` | 5 | How many neighbors to consider |
| `ttl_sweep.on_bootstrap` | `true` | Whether to sweep expired profiles on each agent turn |
| `consolidation.threshold_hours` | 24 | Heartbeat consolidation interval |
| `extraction.subagent_timeout_seconds` | 120 | Flow C sub-agent timeout |

## Comparison with Other Reflexio Integrations

See `references/comparison.md` for a full matrix.

- **`integrations/openclaw-embedded/`** (this plugin): self-contained; no Reflexio server; single-user.
- **`integrations/openclaw/`** (federated): requires running Reflexio server; multi-user; cross-instance aggregation.

Both can coexist in the same Openclaw instance, but installing both serves no purpose — pick one.

## Uninstall

```bash
./scripts/uninstall.sh           # preserves .reflexio/ user data
./scripts/uninstall.sh --purge   # also deletes .reflexio/ user data
```

## Further Reading

- [Architecture deep-dive](references/architecture.md)
- [Prompt porting notes](references/porting-notes.md)
- [Future work / v2 deferrals](references/future-work.md)
- [Manual testing guide](TESTING.md)
