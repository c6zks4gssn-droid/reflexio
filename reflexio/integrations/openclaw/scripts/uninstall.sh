#!/usr/bin/env bash
# reflexio-federated uninstall.sh — reverses install.sh.
# Leaves ~/.reflexio/ user data intact unless --purge is passed.
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
PURGE_DATA="${1:-}"

info() { echo "==> $*"; }

info "Disabling plugin..."
openclaw plugins disable reflexio-federated 2>/dev/null || echo "(already disabled)"

info "Uninstalling plugin..."
openclaw plugins uninstall --force reflexio-federated 2>/dev/null || echo "(already uninstalled)"
rm -rf "$OPENCLAW_HOME/extensions/reflexio-federated"

info "Cleaning up state files..."
rm -f "$HOME/.reflexio/sessions.db"
rm -f "$HOME/.reflexio/logs/.server-starting"

# Remove setup markers
find "$HOME/.reflexio/" -name ".setup_complete_*" -delete 2>/dev/null || true

if [[ "$PURGE_DATA" == "--purge" ]]; then
  info "Purging ~/.reflexio/ user data per --purge flag..."
  rm -rf "$HOME/.reflexio"
else
  info "User data at ~/.reflexio/ preserved. Use --purge to delete it too."
fi

info "Restarting openclaw gateway..."
openclaw gateway restart

info "Uninstall complete."
