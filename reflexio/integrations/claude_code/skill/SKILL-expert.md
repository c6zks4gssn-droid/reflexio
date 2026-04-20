---
name: reflexio-expert
description: "Search past session memory for user corrections, preferences, and project conventions, AND publish new corrections when the user says 'no, do X instead' or states a preference. Retrieves behavioral rules (e.g. 'always use type hints', 'use pnpm not npm') so you follow them from the start. Use on ANY task: coding, writing, configuring, reviewing, debugging, planning, deploying, testing, or any other request."
---

# Reflexio: Learn from Past Sessions (Expert)

Reflexio remembers corrections and preferences from your past conversations with this user.

**This skill triggers on THREE types of messages:**
1. **Task requests** — user asks you to do something → search Reflexio first
2. **Corrections and preferences** — user says "no, do X instead", "always use Y", "I prefer Z" → publish to Reflexio
3. **High-signal moments** — tool failures you self-recover from, retry chains, workarounds, anomalies → publish to Reflexio

The user can also run `/reflexio-extract` at any time to summarize the full conversation and extract learnings.

---

## Step-by-Step: When User Gives a Task

Follow these steps IN ORDER:

**Step 1 — Ensure server is running (local server only):**
Check the `REFLEXIO_URL` environment variable. If it points to a remote server (anything other than `localhost` or `127.0.0.1`), **skip this step entirely** — managed Reflexio servers are always running. Go directly to Step 2.

If `REFLEXIO_URL` is unset or points to localhost/127.0.0.1 (local server):
```bash
reflexio status check
```
If this fails with a connection error, start the server in a background subagent:
```
Agent(prompt="Start the Reflexio server: nohup reflexio services start --only backend > ~/.reflexio/logs/server.log 2>&1 & sleep 5 && reflexio status check", run_in_background=true)
```
Then continue to Step 2 immediately (don't wait for the subagent).

**Step 2 — Search for relevant corrections:**
```bash
reflexio search "<the user's request or task description>"
```
If the server wasn't ready yet (connection error), skip this and proceed — you'll retry later.

**Step 3 — Apply results and do the task:**
- If search returned playbooks → follow the content guidance in each playbook
- If search returned profiles → adapt your approach to the user's preferences
- If search returned nothing or failed → proceed normally

---

## Step-by-Step: When User Corrects You

When the user corrects your approach or states a preference, follow these steps:

**Step 1 — Apply the correction** to your work first.

**Step 2 — Ensure server is running (local server only)** — same as Step 1 above: skip entirely if `REFLEXIO_URL` points to a remote server. For local servers, run `reflexio status check` and start if needed.

**Step 3 — Publish the correction to Reflexio:**

Write a summary JSON and publish it:
```bash
cat > /tmp/reflexio-summary.json << 'SUMMARY_EOF'
{
  "agent_version": "claude-code",
  "source": "claude-code-expert",
  "interactions": [
    {"role": "user", "content": "<what the user originally asked>"},
    {
      "role": "assistant",
      "content": "<your initial approach, INCLUDING any self-correction text you wrote like 'this isn't quite X' — preserve such phrases verbatim>",
      "tools_used": [
        {"tool_name": "<tool>", "tool_data": {"input": "<params> — FAILED: <exact error>  OR  — REJECTED BY USER"}}
      ]
    },
    {"role": "user", "content": "<the user's correction — preserve their exact words; if the correction was a tool-call rejection with no words, write '[rejected tool use — see tools_used above]' and explain what the rejection was objecting to>"},
    {"role": "assistant", "content": "<your acknowledgment and corrected approach>"}
  ]
}
SUMMARY_EOF
reflexio publish --agent-version claude-code --source claude-code-expert --skip-aggregation --force-extraction --file /tmp/reflexio-summary.json && rm -f /tmp/reflexio-summary.json
```

`tools_used` is **required** on the second turn whenever the original approach involved a failed or rejected tool call — the error string or rejection moment is the evidence Reflexio needs to extract a precise behavioral rule instead of a vague profile entry. For pure-text corrections (user corrected your wording or choice with no tool friction), the field can be omitted.

**Detect correction patterns:**

_Verbal corrections:_
- "No, use X instead of Y"
- "Don't do X, always do Y"
- "I prefer X", "Always use X in this project"
- "That's wrong, the correct approach is..."

_Non-verbal / implicit corrections (also publish these):_
- **Tool-call rejection** — the user rejected a tool use mid-response. This is a correction even without any words; the "correction" is the rejection itself, and the thing being corrected is whatever tool call you were about to make. Record it in `tools_used` with `— REJECTED BY USER` and write `[rejected tool use — see tools_used above]` in the following user turn's `content`.
- **Self-correction you wrote out loud** — mid-response you realized you were doing the wrong thing and said so ("actually this isn't CVR…", "I should have…"). Publish this too, because the user didn't need to correct you only because you caught it — the underlying mistake is still extractable as a rule. Preserve the self-correction sentence verbatim in the assistant turn's `content`.
- **Repeated tool failure with user intervention** — you failed the same operation 2+ times and the user stepped in to redirect. The redirect is the correction; the failures are the context. List every failed attempt under `tools_used` on the original assistant turn.

**When to publish:**
- **Simple correction** (e.g., "always use type hints") → publish immediately, context is self-contained
- **Multi-turn correction** (user corrects, then explains why, then adds exceptions) → wait until complete, then publish the full chain

**Tip:** The user can also run `/reflexio-extract` at the end of the session to do a comprehensive extraction of all learnings — including intermediate reasoning, tool calls, and context that mid-session publishes might miss.

---

## Step-by-Step: Proactive Extraction (High-Signal Moments)

Beyond explicit corrections, certain moments during a session carry high learning value — even when the user says nothing. When you detect any of the patterns below, publish to Reflexio using the same mechanism as corrections. Do not wait for user input.

**Payload format** — same as corrections, but the "user" turn is the original request (no correction needed), and the "assistant" turn captures the full failure → recovery arc:
```bash
cat > /tmp/reflexio-summary.json << 'SUMMARY_EOF'
{
  "agent_version": "claude-code",
  "source": "claude-code-expert",
  "interactions": [
    {"role": "user", "content": "<what the user originally asked>"},
    {
      "role": "assistant",
      "content": "<what you tried, what went wrong, and how you recovered — preserve self-correction phrases verbatim>",
      "tools_used": [
        {"tool_name": "<tool>", "tool_data": {"input": "<params> — FAILED: <exact error>"}},
        {"tool_name": "<tool>", "tool_data": {"input": "<corrected params> — succeeded"}}
      ]
    }
  ]
}
SUMMARY_EOF
reflexio publish --agent-version claude-code --source claude-code-expert --skip-aggregation --force-extraction --file /tmp/reflexio-summary.json && rm -f /tmp/reflexio-summary.json
```

List every failed attempt in `tools_used` in chronological order, followed by the successful one. Include exact error messages verbatim — they are load-bearing evidence for extracting precise behavioral rules.

### Patterns to detect and publish:

**A. Self-recovered tool failures**
You tried a tool call, got an error, and fixed it yourself without user input. The error message and your recovery strategy are extractable as a behavioral rule (trigger → pitfall → instruction).

_Example:_ You ran a SQL query with `JOIN channels ON l.channel_id`, got `invalid identifier 'L.CHANNEL_ID'`, discovered the column is actually `l.stream_channel_id` by introspecting the schema, and rewrote the query.

**B. Retry chains (2+ failures on same operation)**
You attempted the same operation 2+ times with different errors before succeeding. Each retry and the eventual fix form a learning arc. Publish the full chain as one interaction — list all attempts in `tools_used`.

_Example:_ File edit failed (wrong indentation), retried with different context (still wrong), then read the file first and got it right. The pattern "read before editing unfamiliar files" is extractable.

**C. Discovered documentation or behavior gaps**
Tool documentation or expected behavior said X, but reality was Y. The discrepancy is a reusable rule that prevents future agents from making the same incorrect assumption.

_Example:_ API docs say `--format json` is supported, but the CLI returns `unknown flag`. You discovered `--output-format json` works instead.

**D. Workarounds for limitations**
An API, tool, or system doesn't support what you needed, so you used an alternative approach. The limitation and workaround are a reusable playbook rule.

_Example:_ The database doesn't support `LATERAL JOIN`, so you rewrote the query using a correlated subquery. Or: the MCP tool doesn't accept wildcards, so you listed the directory first and filtered client-side.

**E. Anomalous or implausible results**
Results that are unexpected — zeros where you expected values, row counts that don't match documentation, mean/median divergence suggesting data skew, results that contradict what the user described. Publish how you detected the anomaly and what you did about it.

_Example:_ Query returned 0 rows when the user said "we have thousands of records." You discovered the table uses soft deletes and added `WHERE deleted_at IS NULL` — or found the user was looking at a different environment.

### When to publish proactively:

- **Publish immediately** after recovering from the situation — don't batch multiple unrelated patterns into one publish
- **Don't publish routine successes** — only friction, failures, surprises, and workarounds. If a tool call succeeded on the first try with no surprises, there's nothing to extract
- **Keep the bar reasonable** — a single typo in a file path that you immediately corrected is not worth publishing. The signal is in non-obvious failures where the recovery required understanding something new about the system

---

## End-of-Session Extraction Nudge

When you detect the session is winding down — the user says "thanks", "that's all", "looks good", the task is complete, or the conversation is naturally ending — check whether the session had any friction:

- Tool failures (even self-recovered ones)
- User corrections or preference statements
- Workarounds or unexpected behavior
- Retry chains

If **any** friction occurred during the session, proactively suggest:

> "This session had some learnings worth capturing. Want me to run `/reflexio-extract` to publish them for future sessions?"

If the session was entirely smooth with no friction, skip the suggestion.

---

## What Reflexio Stores

**User Profiles** — stable facts learned from conversations:
- **About the user**: expertise, background, role
- **User preferences**: communication style, tools, conventions
- **About the environment**: project setup, team conventions, constraints

**User Playbooks** — behavioral corrections with top-level fields:
- **trigger**: when does this rule apply?
- **content**: the actionable behavioral rule
- **rationale**: why the correction matters
- **blocking_issue**: what prevents correct behavior (if applicable)

You don't decide what gets extracted — the Reflexio server LLM analyzes your published summary and determines profiles vs playbooks automatically.

---

## Server Management

The Reflexio server must be running for `reflexio search` and `reflexio publish` to work.

**Managed Reflexio (remote server):** If `REFLEXIO_URL` points to a non-localhost URL (e.g., `https://reflexio.ai`), the server is always running. Do NOT run `reflexio status check` or attempt to start the server. If a command fails with a connection error, report it to the user — it's a network or configuration issue, not a server-start issue.

**Local server** (`REFLEXIO_URL` unset or pointing to localhost/127.0.0.1):

**Check:** `reflexio status check`
**Start (background subagent):**
```
Agent(prompt="Start the Reflexio server: nohup reflexio services start --only backend > ~/.reflexio/logs/server.log 2>&1 & sleep 5 && reflexio status check", run_in_background=true)
```

- Always use a background subagent to start the server — never run it in the main agent (it blocks)
- Never ask the user to start the server — handle it silently
- If `reflexio` is not found, ask the user to install it: `pip install reflexio-ai`

---

## Tips

- **Use the user's actual request as the search query** — not keywords
- **Preserve the user's exact words** in the correction summary
- **Include enough context** — what you did wrong + the correction + why + **the evidence**. Evidence means the actual failed tool input, the exact error message, or the verbatim self-correction sentence. Without the evidence, Reflexio can only extract a vague profile entry; with the evidence, it can extract a precise playbook rule with trigger, content, rationale, and blocking_issue fields. If you're only publishing one correction, make it count by including the failure.
- **If Reflexio is unreachable, proceed normally** — it enhances but never blocks
- **Don't mention Reflexio to the user** unless they ask
- **Suggest `/reflexio-extract`** at end of session if there was any friction (see End-of-Session Extraction Nudge above)
