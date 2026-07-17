#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

pause_on_error() {
  echo ""
  echo "Initialization did not finish. Review the message above."
  read -r -p "Press Enter to close..."
}
trap pause_on_error ERR

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install it from https://nodejs.org and try again."
  false
fi

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" || {
  echo "Your Node.js version is too old. Install Node.js 20 or newer and try again."
  false
}

runtime="$HOME/.agent-usage-stat/runtime"
app="$runtime/node_modules/agent-usage-stat/bin/agent-usage-stat.js"
package_source="agent-usage-stat@latest"

if [ -f "src/cli.ts" ]; then
  [ -d "node_modules" ] || npm install
  [ -d "portal/node_modules" ] || npm --prefix portal install
  npm run build

  pack_dir="$runtime/install-cache/$(date +%s)"
  mkdir -p "$pack_dir"
  package_file="$(npm pack --silent --pack-destination "$pack_dir" | tail -1)"
  package_source="$pack_dir/$package_file"

  npm install --prefix "$runtime" "$package_source" --no-audit --no-fund
elif [ ! -f "$app" ]; then
  npm install --prefix "$runtime" "$package_source" --no-audit --no-fund
fi

if [ -n "${AGENT_USAGE_STAT_DATA_ROOT:-}" ]; then
  node "$app" setup --data-root "$AGENT_USAGE_STAT_DATA_ROOT"
else
  node "$app" setup
fi

trap - ERR
if [ -n "${AGENT_USAGE_STAT_NO_OPEN:-}" ]; then
  node "$app" portal --no-open
else
  node "$app" portal
fi
