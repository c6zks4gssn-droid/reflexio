#!/bin/bash
# Thin wrapper delegating to the CLI entrypoint. See `reflexio services start --help`.
# Port env vars honored by the CLI: BACKEND_PORT, DOCS_PORT (see reflexio/cli/run_services.py).
exec uv run reflexio services start "$@"
