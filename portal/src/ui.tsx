/* Claude Receipts — shared view UI primitives. */
import React from 'react'
import { LHC } from './charts'

function Card({ title, hint, right, children, className, style, bodyStyle }: any) {
  return React.createElement('div', { className: 'card ' + (className || ''), style },
    (title || right) && React.createElement('div', { className: 'card-h' },
      title && React.createElement('span', { className: 'ti' }, title),
      hint && React.createElement('span', { className: 'hint' }, hint),
      React.createElement('span', { className: 'sp' }),
      right,
    ),
    React.createElement('div', { style: Object.assign({ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }, bodyStyle) }, children),
  )
}

// delta vs prior period
function Delta({ cur, prev, invert }: any) {
  if (prev == null || prev === 0) return React.createElement('span', { className: 'delta flat' }, '—')
  const d = (cur - prev) / Math.abs(prev)
  const up = cur > prev, flat = Math.abs(d) < 0.005
  let cls = 'delta '
  if (flat) cls += 'flat'
  else if (invert) cls += up ? 'invert-up' : 'invert-down'
  else cls += up ? 'up' : 'down'
  const arrow = flat ? '→' : up ? '▲' : '▼'
  return React.createElement('span', { className: cls }, arrow + ' ' + (Math.abs(d) * 100).toFixed(d < 0.1 ? 1 : 0) + '%')
}

// KPI readout strip
function KpiStrip({ items }: any) {
  return React.createElement('div', { className: 'kpis', style: { gridTemplateColumns: 'repeat(' + items.length + ',1fr)' } },
    items.map((it, i) => React.createElement('div', { className: 'kpi', key: i },
      React.createElement('div', { className: 'k' }, it.k),
      React.createElement('div', { className: 'v tnum' }, it.v, it.u && React.createElement('span', { className: 'u' }, it.u)),
      React.createElement('div', { className: 'foot' },
        React.createElement(Delta, { cur: it.cur, prev: it.prev, invert: it.invert }),
        React.createElement('span', { className: 'vs' }, 'vs prev'),
        it.spark && React.createElement('span', { style: { marginLeft: 'auto' } },
          React.createElement(LHC.Sparkline, { data: it.spark, color: it.sparkColor || 'var(--txt2)', fill: true, w: 58, h: 22 })),
      ),
    )),
  )
}

function Legend({ feats, hidden, onToggle }: any) {
  return React.createElement('div', { className: 'legend' },
    feats.map((f) => React.createElement('span', {
      key: f.key, className: 'it' + (hidden && hidden[f.key] ? ' off' : ''),
      onClick: () => onToggle && onToggle(f.key),
    },
      React.createElement('span', { className: 'sw', style: { background: f.color || f.bg } }),
      f.label)),
  )
}

// horizontal bar row list (top projects / biggest sessions / generic)
function HList({ rows, max, color }: any) {
  const mx = max || Math.max(1, ...rows.map((r) => r.value))
  return React.createElement('div', { className: 'hlist' },
    rows.map((r, i) => React.createElement('div', { className: 'hrow', key: r.key || i, onClick: r.onClick },
      React.createElement('div', { className: 'lbl' },
        r.rank != null && React.createElement('span', { className: 'rank' }, r.rank),
        r.swatch && React.createElement('span', { style: { width: 9, height: 9, borderRadius: 2, flex: '0 0 auto', background: r.swatch } }),
        React.createElement('span', { className: 'nm' }, r.name),
        r.sub && React.createElement('span', { className: 'sub' }, r.sub),
      ),
      React.createElement('div', { className: 'val tnum' }, r.valLabel, r.unit && React.createElement('i', null, r.unit)),
      React.createElement('div', { className: 'track' },
        React.createElement('div', { className: 'f', style: { width: (100 * r.value / mx) + '%', background: r.color || color || 'var(--txt1)', opacity: .85 } })),
    )),
  )
}

export const LHU = { Card, Delta, KpiStrip, Legend, HList }
