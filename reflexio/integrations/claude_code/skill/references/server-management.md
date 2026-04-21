# Server Management

The Reflexio server must be running for `reflexio search` and `reflexio publish` to work.

## Managed Reflexio (remote server)

If `REFLEXIO_URL` points to a non-localhost URL (e.g., `https://reflexio.ai`), the server is always running. Do NOT run `reflexio status check` or attempt to start the server. If a command fails with a connection error, report it to the user — it's a network or configuration issue, not a server-start issue.

## Local server

`REFLEXIO_URL` unset or pointing to localhost/127.0.0.1:

**Check:** `reflexio status check`

**Start (background subagent):**
```
Agent(prompt="Start the Reflexio server: nohup reflexio services start --only backend > ~/.reflexio/logs/server.log 2>&1 & sleep 5 && reflexio status check", run_in_background=true)
```

- Always use a background subagent to start the server — never run it in the main agent (it blocks)
- Never ask the user to start the server — handle it silently
- If `reflexio` is not found, ask the user to install it: `pip install reflexio-ai`
