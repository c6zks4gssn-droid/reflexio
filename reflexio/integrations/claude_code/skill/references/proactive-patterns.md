# Proactive Extraction Patterns

Beyond explicit corrections, certain moments during a session carry high learning value — even when the user says nothing. When you detect any of the patterns below, publish to Reflexio using the same mechanism as corrections. Do not wait for user input.

Use the same payload format as corrections, but the "user" turn is the original request (no correction needed), and the "assistant" turn captures the full failure → recovery arc. List every failed attempt in `tools_used` in chronological order, followed by the successful one. Include exact error messages verbatim — they are load-bearing evidence for extracting precise behavioral rules.

## Patterns

### A. Self-recovered tool failures
You tried a tool call, got an error, and fixed it yourself without user input. The error message and your recovery strategy are extractable as a behavioral rule (trigger → pitfall → instruction).

_Example:_ You ran a SQL query with `JOIN channels ON l.channel_id`, got `invalid identifier 'L.CHANNEL_ID'`, discovered the column is actually `l.stream_channel_id` by introspecting the schema, and rewrote the query.

### B. Retry chains (2+ failures on same operation)
You attempted the same operation 2+ times with different errors before succeeding. Each retry and the eventual fix form a learning arc. Publish the full chain as one interaction — list all attempts in `tools_used`.

_Example:_ File edit failed (wrong indentation), retried with different context (still wrong), then read the file first and got it right. The pattern "read before editing unfamiliar files" is extractable.

### C. Discovered documentation or behavior gaps
Tool documentation or expected behavior said X, but reality was Y. The discrepancy is a reusable rule that prevents future agents from making the same incorrect assumption.

_Example:_ API docs say `--format json` is supported, but the CLI returns `unknown flag`. You discovered `--output-format json` works instead.

### D. Workarounds for limitations
An API, tool, or system doesn't support what you needed, so you used an alternative approach. The limitation and workaround are a reusable playbook rule.

_Example:_ The database doesn't support `LATERAL JOIN`, so you rewrote the query using a correlated subquery. Or: the MCP tool doesn't accept wildcards, so you listed the directory first and filtered client-side.

### E. Anomalous or implausible results
Results that are unexpected — zeros where you expected values, row counts that don't match documentation, mean/median divergence suggesting data skew, results that contradict what the user described. Publish how you detected the anomaly and what you did about it.

_Example:_ Query returned 0 rows when the user said "we have thousands of records." You discovered the table uses soft deletes and added `WHERE deleted_at IS NULL` — or found the user was looking at a different environment.

## When to publish proactively

- **Publish immediately** after recovering from the situation — don't batch multiple unrelated patterns into one publish
- **Don't publish routine successes** — only friction, failures, surprises, and workarounds. If a tool call succeeded on the first try with no surprises, there's nothing to extract
- **Keep the bar reasonable** — a single typo in a file path that you immediately corrected is not worth publishing. The signal is in non-obvious failures where the recovery required understanding something new about the system
