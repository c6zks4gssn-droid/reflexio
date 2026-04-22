# Manual Testing Guide — Reflexio × OpenClaw Federated Plugin

Step-by-step guide for manually testing the plugin end-to-end. Each phase builds on the previous one. This guide is self-contained — you should not need to reference other documentation.

## Prerequisites

- OpenClaw installed and running: `openclaw --version`
- Reflexio OpenClaw plugin installed: `./scripts/install.sh` or `clawhub plugin install reflexio-federated`
- An LLM API key for the Reflexio server (e.g., `export OPENAI_API_KEY=sk-...`)
- A terminal where you can see OpenClaw's stderr output (agent logs)

### How to view agent logs

OpenClaw outputs hook logs to stderr. To see Reflexio hook messages during a session:

```bash
# Option A: Run openclaw in a terminal and watch stderr
openclaw chat 2>reflexio-hook.log
# In another terminal: tail -f reflexio-hook.log

# Option B: Run with stderr visible
openclaw chat 2>&1 | tee session.log
```

Look for lines starting with `[reflexio]` — these are from the Reflexio hooks.

---

## Phase 1: Install & Verify

### 1.1 Install the plugin (if not already installed)

```bash
# Option A: From source
cd /path/to/reflexio/integrations/openclaw
./scripts/install.sh

# Option B: Via ClawHub
clawhub plugin install reflexio-federated
```

### 1.2 Verify plugin is loaded

```bash
openclaw plugins list
# Expected: reflexio-federated (loaded)

openclaw plugins inspect reflexio-federated
# Expected: Status: loaded
```

If the plugin shows as "disabled" or failed, run:

```bash
openclaw plugins enable reflexio-federated
openclaw gateway restart
```

### 1.3 Verify Reflexio server (optional)

The plugin automatically starts the local Reflexio server on first agent session (see Phase 2). You can optionally verify it manually:

```bash
reflexio status check
```

If the server isn't running yet, that's fine — the plugin will start it automatically during first-use setup.

---

## Phase 2: First-Session Auto-Setup & Server Auto-Start

This phase verifies the plugin's first-use setup (CLI detection, LLM provider prompt, server startup) and that the search hook works correctly with no playbooks yet.

### 2.0 Ensure the server is NOT running (optional)

If you want to test auto-start, stop the server if it's running:

```bash
reflexio services stop 2>/dev/null
# Verify it's stopped:
reflexio status check
# Expected: connection error or "Server is not running"
```

If the server is already running, that's fine — Phase 2.1 will still verify the plugin works with an existing server.

### 2.1 Start a conversation — the plugin should perform first-use setup

```bash
openclaw chat
```

Send a simple, self-contained task that doesn't require a project:

```text
Write a Python function that takes a list of numbers and returns the mean and median.
```

**What to check:**
- The agent responds normally with working code (no errors, no mention of Reflexio)
- On first session, you may see a one-time LLM provider setup prompt (if reflexio-ai CLI needs initialization)
- In the plugin logs (stderr), you should see:
  - `[reflexio] agent:bootstrap hook fired` — the bootstrap handler ran
  - `[reflexio] Server running` or `[reflexio] Starting server` — server health check
  - Potentially `[reflexio] Per-message search` — search attempted for first message
- The response should NOT be delayed more than ~5 seconds by the plugin (timeout limit)
- If setup runs, look for confirmation messages about LLM provider and storage configuration

### 2.2 Verify the server is running

After the first message, check:

```bash
reflexio status check
# Expected: Server is running
```

The plugin starts the server in the background during `agent:bootstrap` if needed. Subsequent messages in this session (and all future sessions) will find the server ready.

### 2.3 Send a second message to verify search is working

In the same session:

```text
Now write a version that also returns the standard deviation.
```

**What to check:**
- In plugin logs: search should be attempted (look for `[reflexio]` lines with search-related messages)
- Search results may be empty (no playbooks yet on cold start) — that's expected
- No search timeout errors in logs (timeout is 5 seconds by default)

### 2.4 Verify the agent doesn't mention Reflexio

The agent's behavioral rule says "never mention Reflexio to the user." Confirm the agent response contains no references to Reflexio, playbooks, or search results.

---

## Phase 3: Capture & Publish

This phase creates a correction scenario and verifies the system captures it.

### 3.1 Create a correction scenario

In the same session (or a new one via `openclaw chat`), send these messages in order. The goal is to get the agent to do something one way, then correct it:

**Message 1** — give a task with an implicit choice:
```text
Write a shell script that installs project dependencies and starts the dev server.
```

Wait for the agent to respond. It will likely use `npm install` or a similar default.

**Message 2** — correct the agent's choice:
```text
No, don't use npm. In this project we always use pnpm. Please rewrite using pnpm instead.
```

Wait for the agent to apply the correction.

**Message 3** — continue the task to provide more context:
```text
Also add a health check that curls localhost:3000/health before starting the main process.
```

**What to check:**
- The agent applies the correction (uses pnpm in the rewrite)
- In plugin logs: look for publish-related messages — the plugin should detect the correction
- If you don't see a publish during the session, that's OK — the session-end hook will capture the full conversation and publish it then

### 3.2 End the session

Exit the session:
```text
/stop
```
(or press Ctrl+C, depending on your OpenClaw configuration)

**What to check in plugin logs:**
- `[reflexio] command:stop hook fired` — the plugin detected session end
- `[reflexio] Queued N interactions for publish` — buffered turns are being published
- `[reflexio] Published via reflexio_publish CLI` — the publish command executed successfully

### 3.3 Verify playbooks were extracted

Wait ~30 seconds for server-side LLM extraction, then check:

```bash
reflexio user-playbooks list --limit 10
```

**Expected:** At least one playbook containing "pnpm" (e.g., content like "use pnpm instead of npm").

If no playbooks appear, the batch interval may not have been met (requires 5+ interactions). Use the manual extraction command instead:

```bash
# If no playbooks were extracted automatically, this is expected for short sessions.
# Phase 5 covers manual extraction as a workaround.
```

Also check profiles:
```bash
reflexio user-profiles list --limit 10
```

You may see a profile entry about project conventions (e.g., "uses pnpm").

---

## Phase 4: Retrieval (Warm Start)

This phase verifies the agent applies corrections from previous sessions.

### 4.1 Start a new session and trigger a related task

```bash
openclaw chat
```

Send a task related to the correction from Phase 3:

```text
Add the 'lodash' package to this project's dependencies.
```

**What to check:**
- In plugin logs: `[reflexio]` lines showing search was executed before the response
- The agent should use `pnpm add lodash` (not `npm install lodash`) — applying the correction from Phase 3 **without being told again**
- If the agent still uses npm, the playbook may not have been extracted yet. Check `reflexio user-playbooks list` and retry after extraction completes.

### 4.2 Send an unrelated task

In the same session:

```text
Explain how Python's garbage collector works.
```

**What to check:**
- The search returns different (or no) playbooks — the pnpm correction should NOT appear for a Python question
- The agent responds normally

---

## Phase 5: Manual Commands

### 5.1 Test `/reflexio-extract`

Start a new session and have a conversation with at least one correction or learning:

```bash
openclaw chat
```

Send a few messages:
```text
Write a function to validate email addresses using regex.
```
Then after the response:
```text
That regex is too permissive. Use a stricter pattern that requires a TLD of at least 2 characters.
```

Now use the `reflexio_publish` tool to flush immediately:

Ask the agent to use the `reflexio_publish` tool to publish the conversation:

```text
Please publish our conversation using the reflexio_publish tool so I can test the publish mechanism.
```

**What to check:**
- The agent calls the `reflexio_publish` tool
- Tool output confirms the conversation was published (e.g., "Published 2 interactions to Reflexio")
- Verify extraction worked:
  ```bash
  reflexio user-playbooks list --limit 10
  ```
  You should see a new playbook about email validation regex.

### 5.2 Test manual aggregation

After accumulating playbooks from Phases 3-5.1, manually trigger aggregation:

```bash
reflexio agent-playbooks aggregate --agent-version openclaw-agent --wait
```

**What to check:**
- Command completes without errors
- Reports how many agent playbooks were created or updated
- Verify:
  ```bash
  reflexio agent-playbooks list --agent-version openclaw-agent
  ```
  You should see agent playbooks with `PENDING` status.

---

## Phase 6: Multi-User (Multiple Agent Instances)

This phase tests that different OpenClaw agents get isolated user playbooks but share agent playbooks.

### 6.1 Set up a second agent instance

If you don't already have multiple agents, create one. OpenClaw stores agent definitions in `~/.openclaw/openclaw.json`. Add a second agent:

```bash
openclaw agents add --name test-reviewer
```

This creates a new agent with its own workspace at `~/.openclaw/workspace-test-reviewer/`.

Verify both agents exist:
```bash
openclaw agents list
# Should show at least two agents (e.g., "main" and "test-reviewer")
```

> **Note:** Use whatever agent names you already have. The test just needs two distinct agents. Replace `main` and `test-reviewer` in the commands below with your actual agent names.

### 6.2 Create different corrections on each agent

**Agent 1** (your default agent):
```bash
openclaw chat
```

Have this conversation:
```text
Write a function to format a date as a string.
```
Then:
```text
Always use ISO 8601 format (YYYY-MM-DD) for dates, never locale-specific formats.
```
Exit: `/stop`

**Agent 2** (your second agent):
```bash
openclaw chat --agent test-reviewer
```

Have this conversation:
```text
Write a function to log errors.
```
Then:
```text
Always include the stack trace when logging errors, not just the message.
```
Exit: `/stop`

### 6.3 Verify user playbook isolation

Wait ~30 seconds for extraction, then check. Replace `main` and `test-reviewer` with your actual agent names:

```bash
# Check what each agent sees (use your actual agent names)
reflexio user-playbooks list --user-id main
reflexio user-playbooks list --user-id test-reviewer
```

**Expected:**
- Agent 1's playbooks include the date formatting correction, NOT the error logging one
- Agent 2's playbooks include the error logging correction, NOT the date formatting one

> **Note:** If playbooks weren't extracted (batch interval not met), manually extract from each agent's session using `/reflexio-extract`, or seed playbooks directly:
> ```bash
> reflexio user-playbooks add --user-id main --content "Always use ISO 8601 (YYYY-MM-DD) for date formatting" --trigger "formatting dates"
> reflexio user-playbooks add --user-id test-reviewer --content "Always include stack traces when logging errors" --trigger "logging errors"
> ```

### 6.4 Aggregate and verify shared playbooks

```bash
reflexio agent-playbooks aggregate --agent-version openclaw-agent --wait
reflexio agent-playbooks list --agent-version openclaw-agent
```

**Expected:**
- Agent playbooks contain corrections from **both** agents (date formatting + error logging)
- Search from either agent returns the shared playbooks:
  ```bash
  reflexio search "format a date" --user-id main
  reflexio search "format a date" --user-id test-reviewer
  ```
  Both should return the date formatting agent playbook.

### 6.5 Clean up test agent (optional)

If you created a test agent just for this phase:
```bash
openclaw agents remove --name test-reviewer
```

---

## Phase 7: Graceful Degradation

### 7.1 Stop the server and verify agent still works

```bash
reflexio services stop
```

Start a new OpenClaw session:
```bash
openclaw chat
```

Send a task:
```text
Explain the difference between TCP and UDP.
```

**What to check:**
- The agent responds normally (no crashes, no errors visible to the user)
- In hook logs:
  - `[reflexio] Server not running — starting in background` — auto-start triggered at bootstrap
  - `[reflexio] Per-message search failed` — first search may fail while server starts (expected)
- The hook buffers the turn to local SQLite (`~/.reflexio/sessions.db`) — it will be published when the server is ready

### 7.2 Verify the server auto-recovered

Wait ~10 seconds after the first message, then check:

```bash
reflexio status check
# Expected: Server is running (auto-started by the hook)
```

Send a second message in the same session:
```text
Now explain when you'd use one over the other.
```

**What to check:**
- Search should succeed now (server is running)
- No "Search failed" errors in hook logs for this message

### 7.3 Verify buffered turns are retried on next session

Exit the current session: `/stop`

Start a new session (this triggers the `agent:bootstrap` event):
```bash
openclaw chat
```

**What to check in hook logs:**
- `[reflexio] Retrying N unpublished session(s)` — the bootstrap handler retries buffered turns from the previous session where the server wasn't ready

Exit the session: `/stop`

---

## Phase 8: Uninstall

### 8.1 Uninstall the plugin

```bash
cd /path/to/reflexio/integrations/openclaw
./scripts/uninstall.sh
```

Or if using ClawHub:

```bash
clawhub plugin uninstall reflexio-federated
```

### 8.2 Verify plugin is removed

```bash
openclaw plugins list
# Should NOT show reflexio-federated

openclaw plugins inspect reflexio-federated 2>&1 | grep -i "not found"
# Expected: plugin not found or similar error
```

### 8.3 Verify agent works without plugin

```bash
openclaw chat
```

Send any message and confirm the agent works normally with no Reflexio-related errors or log lines.

### 8.4 Optional: Delete user data

To remove stored conversations and playbooks:

```bash
cd /path/to/reflexio/integrations/openclaw
./scripts/uninstall.sh --purge
```

This deletes `~/.reflexio/` entirely. If you only ran `uninstall.sh` without `--purge`, data is preserved in case you want to re-enable the plugin later.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Plugin doesn't load | Plugin not installed or gateway not restarted | Run `./scripts/install.sh` or `clawhub plugin install reflexio-federated`; verify with `openclaw plugins list` |
| Agent doesn't follow past corrections | Search plugin timeout or no playbooks yet | Check `reflexio user-playbooks list`; verify server is running with `reflexio status check` |
| `[reflexio] Search failed` in every message | Server not running | `reflexio services start --only backend &` or restart the agent |
| Playbooks not extracted after session | Batch interval not met (need 5+ interactions) | Use `reflexio_publish` tool to manually flush, or seed playbooks with `reflexio user-playbooks add` |
| Agent mentions Reflexio to user | Agent behavioral rule not applied | Check if plugin skills loaded correctly; restart agent |
| First-use setup never ran | LLM provider already configured | Run `reflexio setup openclaw` manually if you need to reconfigure |
| Aggregation never runs | Flag file stuck | `rm ~/.reflexio/logs/.aggregation-running` |
| Can't start second agent | Agent not configured in OpenClaw | `openclaw agents add --name <name>` then `openclaw agents list` to verify |
| Search returns corrections from wrong agent | User playbooks aren't scoped by agent | Verify user_id resolution with `reflexio search "<query>" --user-id <agent-name>` |
