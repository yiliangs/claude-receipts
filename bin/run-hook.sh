#!/usr/bin/env bash
# Wrapper invoked by the Claude Code SessionEnd hook.
# Settings.json points here so the hook line is stable across machines and
# survives node upgrades. Node resolution is deferred to run time:
#   1. node on PATH (the normal case)
#   2. Windows + WinGet: glob the latest versioned node-*-win-x64 dir
#      (WinGet installs land in a versioned dir with no stable Links/ shim)
#   3. nvm: glob the latest version under ~/.nvm/versions/node
# Set CLAUDE_RECEIPTS_DEBUG=1 to log which node was chosen.
set -e

NODE_BIN="$(command -v node || true)"

if [ -z "$NODE_BIN" ] && [ -n "$LOCALAPPDATA" ]; then
  NODE_BIN="$(ls -td "$LOCALAPPDATA"/Microsoft/WinGet/Packages/OpenJS.NodeJS*/node-*-win-x64/node.exe 2>/dev/null | head -1)"
fi

if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN="$(ls -td "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)"
fi

if [ -z "$NODE_BIN" ]; then
  echo "claude-receipts: node not found on PATH or in known install locations" >&2
  exit 1
fi

[ -n "$CLAUDE_RECEIPTS_DEBUG" ] && echo "claude-receipts: using $NODE_BIN" >&2

exec "$NODE_BIN" "$(dirname "$0")/claude-receipts.js" "$@"
