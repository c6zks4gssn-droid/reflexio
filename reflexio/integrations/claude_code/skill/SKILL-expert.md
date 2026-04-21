---
name: reflexio-expert
description: "Use when user corrects your approach, states a preference, rejects a tool call, or when a completed correction needs publishing to cross-session memory."
---

# Reflexio: Publish to Cross-Session Memory

Publish corrections and preferences to Reflexio so they persist across sessions and projects.

## Quick Reference

| Event | Action |
|-------|--------|
| User states fact/preference | Publish profile immediately |
| User corrects you | Apply correction, publish playbook after confirmation |
| Successful non-obvious procedure | Publish playbook after user confirms |
| User runs `/reflexio-extract` | Full session extraction (see command) |

## How to Publish

**Step 1 — Ensure server is running** (local server only). If `REFLEXIO_URL` points to a remote server, skip this. Otherwise run `reflexio status check` and start if needed — see [references/server-management.md](references/server-management.md).

**Step 2 — Write and publish the payload:**

For corrections (user corrected your approach):
```bash
cat > /tmp/reflexio-summary.json << 'SUMMARY_EOF'
{
  "agent_version": "claude-code",
  "source": "claude-code-expert",
  "interactions": [
    {"role": "user", "content": "<what the user originally asked>"},
    {
      "role": "assistant",
      "content": "<your initial approach — preserve self-correction phrases verbatim>",
      "tools_used": [
        {"tool_name": "<tool>", "tool_data": {"input": "<params> — FAILED: <exact error>  OR  — REJECTED BY USER"}}
      ]
    },
    {"role": "user", "content": "<the user's correction — preserve exact words>"},
    {"role": "assistant", "content": "<your acknowledgment and corrected approach>"}
  ]
}
SUMMARY_EOF
reflexio publish --agent-version claude-code --source claude-code-expert --skip-aggregation --force-extraction --file /tmp/reflexio-summary.json && rm -f /tmp/reflexio-summary.json
```

For proactive moments (self-recovered failure, workaround — no user correction):
```bash
cat > /tmp/reflexio-summary.json << 'SUMMARY_EOF'
{
  "agent_version": "claude-code",
  "source": "claude-code-expert",
  "interactions": [
    {"role": "user", "content": "<what the user originally asked>"},
    {
      "role": "assistant",
      "content": "<what you tried, what went wrong, how you recovered>",
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

`tools_used` is required when the approach involved a failed or rejected tool call — the error string is the evidence Reflexio needs to extract a precise behavioral rule. For pure-text corrections, the field can be omitted.

## Correction Patterns

_Verbal:_ "No, use X instead", "Don't do X, always do Y", "I prefer X", "That's wrong"

_Non-verbal:_
- **Tool-call rejection** — user rejected a tool use. Record in `tools_used` with `— REJECTED BY USER`.
- **Self-correction** — you caught your own mistake mid-response ("actually this isn't…", "I should have…"). Publish it — the underlying mistake is extractable even though the user didn't need to correct you.
- **Repeated failure with user redirect** — 2+ failures, user stepped in. List all failed attempts in `tools_used`.

## Proactive Extraction

See [references/proactive-patterns.md](references/proactive-patterns.md) for 5 high-signal patterns: self-recovered failures, retry chains, documentation gaps, workarounds, anomalous results.

## End-of-Session Nudge

When the session winds down and there was any friction (failures, corrections, workarounds), suggest:

> "This session had some learnings worth capturing. Want me to run `/reflexio-extract` to publish them for future sessions?"

Skip if the session was entirely smooth.

## Tips

- Preserve the user's exact words in corrections
- Include evidence: failed tool input, exact error message, or self-correction sentence
- If Reflexio is unreachable, proceed normally — it enhances but never blocks
- Avoid mentioning Reflexio unless the user asks
