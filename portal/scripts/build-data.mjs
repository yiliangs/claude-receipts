/* ============================================================
   claude-receipts portal — data builder
   Reads the shared logbook.csv (one row per Claude Code session) and
   emits the clean artifacts the portal loads at startup:
     public/data/sessions.json  — one normalized record per session
     public/data/meta.json      — build time + headline counts (freshness pill)

   Source path resolution (first hit wins):
     1. argv[2]
     2. $CLAUDE_RECEIPTS_LOGBOOK
     3. H:\My Drive\claude-receipts\logbook.csv   (the canonical Drive copy)

   If the source is unreachable, the existing snapshot in public/data is left
   untouched so the portal still builds offline.
   ============================================================ */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/data')
const DEFAULT_SRC = 'H:/My Drive/claude-receipts/logbook.csv'

const src = process.argv[2] || process.env.CLAUDE_RECEIPTS_LOGBOOK || DEFAULT_SRC

// ---- RFC-4180-ish CSV line parser (honors quotes + escaped "") ----
function parseLine(line) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++ }
      else q = !q
    } else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

const num = (v) => {
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? n : 0
}
// models column packs several model ids with ';' (occasionally ',') separators
const splitModels = (v) =>
  String(v || '')
    .split(/[;,]/)
    .map((m) => m.trim())
    .filter(Boolean)

function main() {
  if (!existsSync(src)) {
    console.warn(`[build-data] source not found: ${src}`)
    if (existsSync(resolve(OUT_DIR, 'sessions.json'))) {
      console.warn('[build-data] keeping existing snapshot in public/data — portal will still build.')
      return
    }
    console.error('[build-data] no source and no snapshot — portal will have no data.')
    process.exit(0)
  }

  const raw = readFileSync(src, 'utf8')
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length)
  if (!lines.length) { console.error('[build-data] empty CSV'); process.exit(1) }

  const header = parseLine(lines[0])
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]))
  const need = ['start_time', 'total_cost_usd', 'total_tokens', 'project']
  for (const k of need) if (!(k in idx)) { console.error(`[build-data] missing column: ${k}`); process.exit(1) }
  const get = (r, name) => (idx[name] != null ? r[idx[name]] : '')

  const sessions = []
  for (let li = 1; li < lines.length; li++) {
    const r = parseLine(lines[li])
    if (r.length < header.length) continue // skip malformed/truncated rows
    const start = get(r, 'start_time')
    if (!start || Number.isNaN(Date.parse(start))) continue
    sessions.push({
      slug: get(r, 'session_slug') || get(r, 'session_id').slice(0, 8) || '—',
      sid: get(r, 'session_id'),
      project: (get(r, 'project') || '—').trim(),
      branch: (get(r, 'branch') || '').trim(),
      cwd: get(r, 'cwd'),
      machine: (get(r, 'machine') || '—').trim(),
      location: (get(r, 'location') || '').trim(),
      start,
      end: get(r, 'end_time') || null,
      durSec: num(get(r, 'duration_seconds')),
      durHuman: get(r, 'duration_human'),
      input: num(get(r, 'input_tokens')),
      output: num(get(r, 'output_tokens')),
      cacheCreate: num(get(r, 'cache_creation_tokens')),
      cacheRead: num(get(r, 'cache_read_tokens')),
      totalTokens: num(get(r, 'total_tokens')),
      cost: num(get(r, 'total_cost_usd')),
      models: splitModels(get(r, 'models')),
    })
  }

  // ---- meta / headline counts ----
  let minStart = Infinity, maxStart = -Infinity, totalCost = 0
  const projects = new Set(), machines = new Set()
  for (const s of sessions) {
    const t = Date.parse(s.start)
    if (t < minStart) minStart = t
    if (t > maxStart) maxStart = t
    totalCost += s.cost
    projects.add(s.project)
    machines.add(s.machine)
  }
  const meta = {
    generatedAt: new Date().toISOString(),
    source: src,
    sessions: sessions.length,
    projects: projects.size,
    machines: machines.size,
    totalCost: Math.round(totalCost * 100) / 100,
    span: {
      from: Number.isFinite(minStart) ? new Date(minStart).toISOString() : null,
      to: Number.isFinite(maxStart) ? new Date(maxStart).toISOString() : null,
    },
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, 'sessions.json'), JSON.stringify(sessions))
  writeFileSync(resolve(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2))
  console.log(
    `[build-data] ${sessions.length} sessions · ${projects.size} projects · ` +
      `$${meta.totalCost.toLocaleString('en-US')} → public/data/`
  )
}

main()
