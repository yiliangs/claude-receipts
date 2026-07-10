// ── Data contract (mirrors scripts/build-data.mjs output) ─────────────────────

// One normalized session record as written to public/data/sessions.json.
export interface RawSession {
  slug: string
  sid: string
  project: string
  branch: string
  cwd: string
  machine: string
  location: string
  start: string // ISO 8601
  end: string | null
  durSec: number
  durHuman: string
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  totalTokens: number
  cost: number
  models: string[]
  // "claude" for all pre-2026-07-09 shards; other providers when they land.
  provider: string
}

export interface Meta {
  generatedAt: string
  source?: string
  sessions: number
  projects: number
  machines: number
  totalCost: number
  span: { from: string | null; to: string | null }
}

// ── Shell / cross-filter state ────────────────────────────────────────────────

export type RangeKey = '7d' | '14d' | '30d' | '90d' | 'all'

export interface Filters {
  range: RangeKey
  projects: Set<string>
  machines: Set<string>
  models: Set<string> // model-family keys (opus / sonnet / haiku / fable / other)
  search: string
}

export type ViewKey = 'overview' | 'spend' | 'tokens' | 'projects' | 'sessions'

// A half-open time window [start, end) in epoch ms.
export interface Win {
  start: number
  end: number
}

// One time bucket (day or week) used by every time-series chart.
export interface Bucket {
  start: number
  end: number
  label: string
}
