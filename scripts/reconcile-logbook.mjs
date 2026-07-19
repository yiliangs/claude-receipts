#!/usr/bin/env node
/**
 * Retired: logbook.csv is no longer a usage source.
 *
 * Recompute affected sessions from their transcripts so the canonical
 * logbook.d/<session-id>.json shard is replaced in place.
 */

console.error(
  "reconcile-logbook.mjs is retired: logbook.d is the only usage source.\n" +
  "Use scripts/regen-session.mjs for targeted corrections or " +
  "scripts/bulk-regen.mjs for an explicit shard rebuild. No files were changed.",
);
process.exit(1);
