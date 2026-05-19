# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**claude-receipts** is an NPM package that generates beautiful thermal printer-style receipts for Claude Code usage sessions. It integrates with Claude Code's SessionEnd hook to automatically create HTML receipts that open in the browser when a coding session ends.

## Development Commands

```bash
# Build TypeScript to JavaScript
npm run build

# Watch mode for development
npm run dev

# Test the CLI locally (after building)
node bin/claude-receipts.js generate
node bin/claude-receipts.js generate --output html
node bin/claude-receipts.js config --show
node bin/claude-receipts.js setup

# Install locally for testing as if installed globally
npm link
claude-receipts generate

# Prepare for publishing
npm run prepublishOnly  # Runs build automatically
```

## Architecture

### Data Flow

The package operates in two modes:

1. **Hook Mode** (automatic): SessionEnd hook → stdin JSON → generate HTML → open browser
2. **Manual Mode**: CLI command → discover recent session → output to console/HTML

```
SessionEnd Hook
  ↓ (stdin with session_id, transcript_path)
GenerateCommand
  ↓
SessionFinder (only if manual mode — scans ~/.claude/projects/)
  ↓
UsageCalculator (reads JSONL, prices via pricing.ts)
  + TranscriptParser (reads JSONL for metadata)
  ↓
ReceiptGenerator (text) + HtmlRenderer (styled HTML)
  ↓
LogbookWriter appends a row to logbook.csv
  ↓
Save to H:/My Drive/claude-receipts/[slug-timestamp].html (or fallback)
  + open browser (hook mode only)
```

Cost is computed inline from the transcript JSONL — no ccusage, no
subprocess, no indexer-lag retries. Hook finishes in ~1s on the fast path.

### Key Components

**Commands** (`src/commands/`)

- `generate.ts` - Main command; auto-detects if called from hook via stdin
- `setup.ts` - Modifies `~/.claude/settings.json` to install SessionEnd hook
- `config.ts` - Manages user configuration at `~/.claude-receipts.config.json`

**Core Logic** (`src/core/`)

- `usage-calculator.ts` - Reads transcript JSONL, sums per-model usage, prices via `pricing.ts`, returns `SessionUsage`
- `pricing.ts` - Static per-million-token price table for Claude models; verified against historical ccusage output. Update when new models ship.
- `session-finder.ts` - Manual-mode discovery: scans `~/.claude/projects/**/*.jsonl` by UUID prefix or mtime
- `transcript-parser.ts` - Parses `~/.claude/projects/[path].jsonl` for session metadata (slug, timestamps, message counts)
- `receipt-generator.ts` - Creates ASCII text receipt with Claude logo, location, costs
- `html-renderer.ts` - Generates standalone HTML with embedded CSS (thermal printer aesthetic)
- `logbook-writer.ts` - Appends one row per session to `<receiptsRoot>/logbook.csv` for cross-session summarization
- `config-manager.ts` - Handles `~/.claude-receipts.config.json` I/O

**Utils** (`src/utils/`)

- `location.ts` - Location detection chain: CLI flag → config → IP geolocation (geoip-lite) → fallback
- `formatting.ts` - Currency, number, date/time, duration formatting
- `ascii-art.ts` - Claude logo and separators for text receipts

### Critical Implementation Details

**SessionEnd Hook Integration**

- Hook receives JSON via stdin: `{session_id, transcript_path, cwd, ...}`
- `GenerateCommand.readStdinIfAvailable()` checks `stdin.isTTY` (false = piped from hook)
- When from hook: uses `transcript_path` directly, auto-opens browser, no console output
- Hook cannot output to console (runs after session closes), hence HTML + browser approach

**Usage Calculation**

- The transcript JSONL is canonical: every assistant message carries `message.usage` (input/output/cache_creation/cache_read tokens) plus `message.model`
- Per-model accumulators feed `pricing.ts` to compute cost
- 5-minute vs 1-hour cache TTL is not distinguished in the JSONL — we price all cache writes at the 5-minute rate (1.25× input); 1h-only sessions underbill by ≤12% of cache-write cost (typically <2% of total)
- Unknown models bill at $0 and surface via `getUnknownModels()` → logged to `hook.log` so stale price tables are visible

**File Naming**

- HTML files use session slug (e.g., `quirky-crafting-floyd.html`), not session ID
- Session slug comes from first user message in transcript JSONL
- Fallback to session ID if slug unavailable

**Output Modes**

- `--output html`: Save to `~/.claude-receipts/projects/[slug].html`
- `--output console`: Display ASCII art in terminal (default for manual use)
- Hook always uses `--output html` (set during setup)

**Config Philosophy**

- Minimal config: only `version`, optional `location`, optional `timezone`
- No `outputDirectory`, `enablePNG`, `enableConsole`, `format` - simplified after initial design
- Output format specified at command level, not config level

**Visual Design**

- Black & white thermal printer aesthetic (no color backgrounds except dark page background)
- Claude ASCII logo (not "shop" names with emojis)
- "Thank you for building!" (not "shopping")
- Dark page background (#3a3a3a) makes white receipt pop

## Type System

All types in `src/types/`:

- `session.ts` - `SessionUsage` + `ModelBreakdown` shapes consumed by the renderers
- `transcript.ts` - JSONL message structure and parsed summary
- `config.ts` - Minimal user configuration
- `session-hook.ts` - SessionEnd stdin JSON format

## Package Structure

- **ESM only** (`"type": "module"`) - Node 22+ required
- **bin entry**: `bin/claude-receipts.js` imports from `dist/cli.js`
- **Exports**: Main exports from `src/index.ts` for programmatic use
- **Files distributed**: `dist/`, `bin/`, `templates/` (though templates currently unused)

## Known Constraints

- Cannot output to console from SessionEnd hook (terminal already closed)
- New Claude model launches require a `pricing.ts` entry — until added, sessions bill at $0 (logged as `pricing miss`)
- 5m vs 1h cache TTL is not distinguished in the transcript; cache writes are priced at the 5m rate
- Browser auto-open uses platform-specific commands (`open`, `start`, `xdg-open`)

## Hook Installation

Setup command modifies `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-receipts@latest generate --output html"
          }
        ]
      }
    ]
  }
}
```

Always backs up settings.json before modification. Uses `@latest` to ensure users get updates without reinstalling.
