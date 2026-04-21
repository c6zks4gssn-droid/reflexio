# Reflexio: Cross-Session Memory

This project uses Reflexio to remember corrections and preferences across sessions. Reflexio publishes to a server for LLM-powered extraction — it complements local memory, which is project-scoped.

## How It Works

A `UserPromptSubmit` hook automatically runs `reflexio search` on every message you receive. When relevant corrections or preferences exist, they are injected as context before your response.

## Applying Corrections from Reflexio

1. **When you see a block titled "IMPORTANT: Apply These Corrections (from Reflexio)"** — read it carefully and follow every instruction it contains. These are explicit corrections from the user's past sessions. Behavior Corrections tell you what to do differently. User Preferences tell you how the user works.

2. **If no Reflexio context appears for a task** — the hook may not have found relevant results, or the server may be starting up. Run a manual search before beginning work:
   ```
   reflexio search "<the user's task or request>"
   ```
   If the command fails with a connection error and `REFLEXIO_URL` is unset or points to localhost/127.0.0.1 (local server), start the server in a background subagent and continue working:
   ```
   Agent(prompt="Start the Reflexio server: nohup reflexio services start --only backend > ~/.reflexio/logs/server.log 2>&1 & sleep 5 && reflexio status check", run_in_background=true)
   ```
   If `REFLEXIO_URL` points to a remote server, do not attempt to start it — proceed without Reflexio results.

3. Avoid mentioning Reflexio to the user unless they ask about it. It should be invisible.

## When to Publish to Reflexio

Reflexio captures learnings that persist across sessions and projects via server-side LLM extraction. It complements local memory — Reflexio is cross-project, local memory is project-scoped.

When the user corrects your approach, shares facts about themselves, or confirms a non-obvious procedure worked, consider publishing to Reflexio by invoking the `/reflexio` skill.

### Profiles (facts — publish when stated)
User shares a fact or preference about themselves or their environment:
- "I'm a data scientist", "my name is David"
- "We use polars not pandas", "I prefer tabs over spaces"
- "The staging DB is on port 5433"

### Playbooks (corrections — publish after confirmation)
User corrects your approach or rejects a tool call, and the correction is confirmed:
- "No, use X instead of Y", "Don't do that", "Always use Z"
- User rejects a tool call
- Confirmation can be explicit ("good", "thanks") or implicit (user moves on, no further correction)

### Successful procedures (publish after confirmation)
You complete a task using a non-obvious approach and the user confirms it worked.

### Reflexio vs local memory
Reflexio publishes to a server for cross-session extraction. Local memory writes files scoped to the current project. When a correction could apply beyond this project, Reflexio is the better fit.
