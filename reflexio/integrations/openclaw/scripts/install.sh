#!/usr/bin/env bash
# reflexio-federated install.sh — plugin installation.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../plugin" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

# 1. Prereq checks
info "Checking prerequisites..."
command -v openclaw >/dev/null || die "openclaw CLI required but not found on PATH"
command -v node >/dev/null     || die "node required but not found on PATH"

# 2. Install the plugin
info "Installing plugin..."
openclaw plugins uninstall --force reflexio-federated 2>/dev/null || true
rm -rf "$OPENCLAW_HOME/extensions/reflexio-federated"
openclaw plugins install "$PLUGIN_DIR"
openclaw plugins enable reflexio-federated 2>/dev/null || true

# 3. Restart gateway
info "Restarting openclaw gateway..."
openclaw gateway restart

# 4. Verify
info "Verification:"
if openclaw plugins inspect reflexio-federated 2>/dev/null | grep -q "Status: loaded"; then
  info "  ✓ plugin registered and loaded"
else
  die "Plugin did not reach 'loaded' status. Run 'openclaw plugins inspect reflexio-federated' to debug."
fi

info "Installation complete."
info "Reflexio setup (CLI install, storage config, server start) happens automatically on first agent session."
