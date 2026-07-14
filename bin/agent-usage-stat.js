#!/usr/bin/env node

import("../dist/cli.js").catch((err) => {
  console.error("Failed to load agent-usage-stat CLI:", err);
  process.exit(1);
});
