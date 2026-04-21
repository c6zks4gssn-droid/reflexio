---
name: reflexio
description: "Cross-session memory via Reflexio server. Search is automatic (hook-injected before every response). Use reflexio_publish tool to flush corrections and learnings immediately. Manual search fallback via exec if hook injection is empty."
---

# Reflexio: Cross-Session Memory

Reflexio remembers corrections and preferences from past conversations. A hook automatically searches Reflexio before every response and injects relevant context — you don't need to do anything for retrieval.

## What Reflexio Stores (on the server)

**User Profiles** — facts about the user: expertise, preferences, environment, constraints.

**User Playbooks** — behavioral corrections from past sessions:
- **trigger**: when does this rule apply?
- **instruction**: what to do instead
- **pitfall**: what to avoid
- **rationale**: why the correction matters

**Agent Playbooks** — shared corrections aggregated from all agent instances.

## Search (Automatic)

A hook runs `reflexio search` on every user message and injects matching profiles and playbooks as context before your response. No action needed.

**If no context appears for a task** — the hook may not have found results, or the server may be starting. Run a manual search:
```bash
reflexio search "<the user's task or request>"
```

If the command fails with a connection error and `REFLEXIO_URL` is unset or points to localhost, the plugin will start the server automatically. If it points to a remote server, report the issue to the user.

## Publish (When to Use `reflexio_publish`)

Conversations are automatically published to Reflexio at session end and periodically mid-session. For high-signal moments, call the `reflexio_publish` tool to flush immediately:

- **User corrects you** and confirms the fix (explicit "good" / "perfect" or moves on)
- **You complete a key milestone** with non-obvious learnings
- **High-friction session** with multiple corrections

The Reflexio server handles extraction (profiles, playbooks) from the published conversations. You don't need to structure the data — just publish, and the server does the rest.

## Infrastructure

- The plugin checks and starts the Reflexio server automatically
- **Never ask the user** to start, stop, or manage the server
- **Never mention Reflexio** to the user unless they ask
- If Reflexio is unavailable, proceed normally — it enhances but never blocks
