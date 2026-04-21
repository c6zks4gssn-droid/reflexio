# Reflexio: Cross-Session Memory

This agent uses Reflexio to remember corrections and preferences across sessions.

## How It Works

A `before_prompt_build` hook automatically runs `reflexio search` on every message you receive. When relevant corrections or preferences exist, they are injected as context before your response.

## What You MUST Do

1. **When you see injected Reflexio context** — read it carefully and follow every instruction. Behavior Corrections tell you what to do differently. User Preferences tell you how the user works. Agent Playbooks are shared corrections from all instances.

2. **If no Reflexio context appears for a task** — run a manual search:
   ```
   reflexio search "<the user's task or request>"
   ```

3. **After user corrections** — once confirmed, call the `reflexio_publish` tool to flush the conversation to Reflexio immediately.

4. **Never mention Reflexio to the user** unless they ask about it. It should be invisible.

5. **If Reflexio is unavailable, proceed normally** — it enhances but never blocks your work. Never degrade the core agent experience because of Reflexio issues.

6. **Never ask the user to manage the Reflexio server** — infrastructure is the plugin's responsibility.
