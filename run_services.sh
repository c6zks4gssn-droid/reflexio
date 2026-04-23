#!/bin/bash
# Thin wrapper delegating to the CLI entrypoint. See `reflexio services start --help`.
# All env vars and flags (BACKEND_PORT, FRONTEND_PORT, DOCS_PORT, ...) are honored by the CLI.
exec uv run reflexio services start "$@"
