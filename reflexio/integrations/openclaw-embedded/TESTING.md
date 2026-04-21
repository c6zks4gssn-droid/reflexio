# Manual Testing Guide

End-to-end manual validation of `openclaw-embedded`. Run this before each release.

## Prerequisites

- A clean Openclaw instance (fresh workspace, or separate test workspace)
- Node and openclaw CLI on PATH
- An embedding provider configured (optional but recommended for full coverage)

## 1. Unit tests

From the `openclaw-embedded/` directory:

```bash
npm test
```

Expected: 54 tests pass. If any fail, stop — fix before proceeding.

## 2. Hook smoke test

```bash
node plugin/hook/smoke-test.js
```

Expected: all PASS lines printed, no FAIL.

## 3. Install plugin

```bash
./scripts/install.sh
```

Expected verification output:
```text
  ✓ plugin registered and loaded
```

If any ⚠ warnings, investigate before moving on.

## 4. First-use bootstrap

- Open a new Openclaw agent session.
- Say: "test the reflexio-embedded skill setup".
- Expected: the agent invokes the skill, runs probing commands, asks for approval to configure active-memory and extraPath.
- Approve each step.
- Verify `.reflexio/.setup_complete_<agentId>` marker exists.

## 5. Flow A — profile capture

In the agent session:

- Say: "By the way, I'm vegetarian."
- Expected: agent writes `.reflexio/profiles/diet-vegetarian-<nanoid>.md` with:
  - Frontmatter: `type: profile`, `id: prof_*`, `ttl: infinity`, `expires: never`
  - Body: ~1-sentence description

```bash
cat .reflexio/profiles/diet-*.md
```

Verify the file matches expectations.

## 6. Flow B — playbook capture

- Say: "Write a commit message for 'fix auth bug'."
- Expected: agent writes a commit message.
- Say: "No, don't add trailers."
- Expected: agent rewrites without trailers.
- Say: "Perfect, commit it."
- Expected: agent writes `.reflexio/playbooks/commit-no-trailers-<nanoid>.md`.

```bash
cat .reflexio/playbooks/commit-*.md
```

Verify frontmatter + `## When` / `## What` / `## Why` sections.

## 7. Flow C — batch extraction at session boundary

- Have a longer conversation (5+ turns) covering facts and corrections.
- The `before_compaction`, `before_reset`, or `session_end` hook fires automatically.
- Expected: a `reflexio-extractor` sub-agent is spawned.

Check `.reflexio/profiles/` and `.reflexio/playbooks/` — new files should have appeared corresponding to any facts/corrections the agent missed in-session.

## 8. Retrieval validation

Start a new session. Ask: "What do you know about my diet?"

- With Active Memory enabled: expected answer references "vegetarian" from the captured profile.
- With Active Memory disabled: expected agent calls `reflexio_search` tool, then answers.

## 9. Consolidation (on-demand)

After accumulating 10+ entries across sessions, run:

```text
/skill reflexio-consolidate
```

Expected:
- Agent calls `reflexio_run_consolidation` tool.
- Returns "Consolidation started in background."
- Logs show clustering, LLM judgment, and file write/delete activity.

Check `.reflexio/` before and after — duplicate or overlapping entries should be consolidated into individual fact files.

## 10. TTL sweep

- Create a profile with short TTL:
  ```text
  Call the `reflexio_write_profile` tool with: slug="test-temp", ttl="one_day", body="temp fact"
  ```
- Manually edit its `expires` to a past date:
  ```bash
  # Edit .reflexio/profiles/test-temp-*.md — set expires: 2020-01-01
  ```
- Start a new agent turn (triggers `before_prompt_build` hook with TTL sweep).
- Expected: the expired profile is deleted.

## 11. Degradation: no Active Memory

- Disable active-memory: `openclaw plugins disable active-memory`
- Restart gateway.
- Start new session, ask a question whose answer needs a captured profile.
- Expected: agent calls `reflexio_search` tool explicitly (per SKILL.md fallback), then answers.
- Re-enable: `openclaw plugins enable active-memory`.

## 12. Degradation: no embedding provider

- Unset embedding env vars.
- Restart gateway.
- Ask the agent something whose answer needs retrieval.
- Expected: retrieval works via FTS only (quality lower but functional).

## 13. Uninstall

```bash
./scripts/uninstall.sh
```

Verify:
- `openclaw plugins inspect reflexio-embedded` shows not loaded.
- `~/.openclaw/extensions/reflexio-embedded/` does not exist.
- `.reflexio/` in the workspace is preserved.

Run `./scripts/uninstall.sh --purge` in a test workspace to verify `.reflexio/` is deleted.

## Test report template

When testing for a release:

```text
Tested: <date> <tester>
Openclaw version: <version>
Unit tests: <pass/fail>
Hook smoke test: <pass/fail>
Flow A: <pass/fail — notes>
Flow B: <pass/fail — notes>
Flow C: <pass/fail — notes>
Retrieval: <pass/fail — notes>
Consolidation: <pass/fail — notes>
TTL sweep: <pass/fail — notes>
Degradation modes: <pass/fail — notes>
Uninstall: <pass/fail — notes>
```
