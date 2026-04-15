# Reflexio: Cross-Session Memory

This agent uses Reflexio to remember corrections and preferences across sessions. **Reflexio captures full conversations (user messages, assistant responses, tool calls and errors, self-corrections) and forwards them to a local Reflexio server at `127.0.0.1:8081` for LLM-based extraction.** The hook is hard-pinned to localhost — it cannot reach any other host. **However**, the local server itself uses an LLM provider (configured in `~/.reflexio/.env`) to extract playbooks and profiles, and if that provider is external (OpenAI, Anthropic, etc.) then excerpts of the conversation will be sent to it as part of extraction. See the Privacy & Data Collection section in the skill for the full two-hop disclosure.

## How It Works

A `message:received` hook automatically runs `reflexio search` on every message you receive. When relevant corrections or preferences exist, they are injected as context before your response via a file named `REFLEXIO_CONTEXT.md`.

## What You MUST Do

1. **When you see a block titled "REFLEXIO_CONTEXT"** — read it carefully and follow every instruction it contains. These are explicit corrections from the user's past sessions. Behavior Corrections tell you what to do differently. User Preferences tell you how the user works. Agent Playbooks are shared corrections from all instances.

2. **Be transparent about Reflexio.** On the first turn of each session, briefly tell the user: (a) Reflexio cross-session memory is active, (b) it captures messages, tool calls, errors, and self-corrections, (c) it talks only to a local Reflexio server at `127.0.0.1:8081`, BUT (d) that server uses an LLM provider configured in `~/.reflexio/.env` (OpenAI, Anthropic, Gemini, local Ollama, etc.) to extract playbooks — so conversation excerpts may reach whichever provider the user picked during install. Keep it to two or three sentences. If the user asks to disable it, point them to `openclaw hooks disable reflexio-context` or `reflexio setup openclaw --uninstall`, and stop using Reflexio for the rest of the session.

   Also: if the user says they don't remember which provider they configured, suggest they run `cat ~/.reflexio/.env | grep -i key` to check. If the provider is a hosted API (OpenAI, Anthropic, etc.), recommend treating the current session as if the LLM provider will see excerpts. If it's a localhost endpoint (Ollama, LM Studio), the full pipeline is offline.

3. **If no Reflexio context appears for a task** — the hook may not have found relevant results, or the local server may be starting up. Run a manual search before beginning work:
   ```
   reflexio search "<the user's task or request>"
   ```
   If the command fails with a connection error, **tell the user you're starting the local Reflexio server in the background** before running:
   ```bash
   nohup reflexio services start --only backend > ~/.reflexio/logs/server.log 2>&1 &
   ```

4. **If Reflexio is unavailable, proceed normally** — it enhances but never blocks your work. Never degrade the core agent experience because of Reflexio issues.

5. **Respect user objections.** If the user says they don't want their conversation logged, or that they're working on a sensitive task, stop all Reflexio calls for the remainder of the session. Do not launch the local server, do not run `reflexio publish`, and do not run `reflexio search`. Offer to disable the hook entirely if they'd like a permanent opt-out.
