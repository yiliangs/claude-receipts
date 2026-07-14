#!/usr/bin/env bash
# ====================================================================
#  Agent Usage Stat - Usage Portal - one-click launcher (macOS)
#
#  Double-click this file in Finder (the Windows twin is
#  Agent-Usage-Stat.bat). It clears any old portal server, refreshes the
#  data from the shared logbook, starts the local viewer, and opens your
#  browser automatically at http://localhost:4179.
#  Keep the Terminal window open while using the portal; close it to stop.
#
#  IMPORTANT: the portal lives at http://localhost:4179 (this launcher).
#  Do NOT bookmark http://localhost:4173 - that is a stale built preview.
#
#  Data source: the data root from ~/.agent-usage-stat.config.json,
#  else an auto-detected Google Drive mount (see dist/utils/usage-root.js).
#  Override:    AGENT_USAGE_STAT_DATA_ROOT=<data root dir>
# ====================================================================
cd "$(dirname "$0")" || exit 1

# Finder-launched shells can miss Homebrew's PATH entries.
if ! command -v npm >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1; then
  echo ""
  echo " ERROR: Node.js / npm was not found on your PATH."
  echo " Install Node 22+ from https://nodejs.org and run this again."
  echo ""
  read -r -p " Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies, one moment..."
  if ! npm install; then
    echo ""
    echo " npm install failed - see the messages above."
    read -r -p " Press Enter to close..."
    exit 1
  fi
fi

echo ""
echo " Clearing any old portal server so you always see ONE fresh window..."
for port in 4179 4173; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086 — pids is a space-separated list on purpose
    kill -9 $pids 2>/dev/null || true
  fi
done

echo ""
echo " Refreshing data from the shared logbook..."
if ! AGENT_USAGE_STAT_REQUIRE_SOURCE=1 npm run data --silent; then
  echo ""
  echo " WARNING: could not refresh from the logbook - opening with the last"
  echo " saved snapshot. Check that Google Drive is mounted, then relaunch"
  echo " to pick up the newest sessions."
  echo ""
fi

echo ""
echo " Starting Agent Usage Stat portal..."
echo " Your browser will open automatically at http://localhost:4179"
echo " Close this window to stop the server."
echo ""
npx vite --open
