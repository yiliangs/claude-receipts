/* ============================================================
   Agent Usage Stat — custom SVG charts (ledger aesthetic)
   Hand-built, no libs. Mono labels, hairline grids, muted fills.
   Ported from the Natalie LogHub chart kit; Histogram generalized to
   take an x-axis formatter (cost distribution, not just durations).
   ============================================================ */
import React, { useState, useRef, useLayoutEffect, useId } from 'react'
import { LH } from './data'

const fmt = LH.fmt

// measure a container's width
function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((es) => { for (const e of es) setW(e.contentRect.width) })
    ro.observe(ref.current)
    setW(ref.current.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as [any, number]
}

// shared floating tooltip
function Tip({ tip }: any) {
  if (!tip) return null
  return React.createElement('div', {
    className: 'hovertip',
    style: { left: Math.min(tip.x + 14, window.innerWidth - 200), top: tip.y - 10 },
  },
    React.createElement('div', { className: 'ht-t' }, tip.title),
    tip.rows.map((r, i) => React.createElement('div', { className: 'ht-r', key: i },
      r.color ? React.createElement('span', { className: 'sw', style: { background: r.color } }) : null,
      React.createElement('span', { className: 'l' }, r.l),
      React.createElement('span', { className: 'v' }, r.v),
    )),
  )
}

const niceMax = (m) => {
  if (m <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(m)))
  const n = m / p
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * p
}

// ---------- Stacked bars (discrete buckets, robust outlier cap) ----------
function StackedBars({ series, labels, height, yFmt, hidden }: any) {
  const [ref, w] = useWidth()
  const [tip, setTip] = useState(null)
  const [hi, setHi] = useState(-1)
  const clipId = useId()
  const H = height || 240, padL = 46, padR = 8, padT = 12, padB = 22
  const n = labels.length
  const active = series.filter((s) => !(hidden && hidden[s.key]))
  const totals = labels.map((_, i) => active.reduce((a, s) => a + s.values[i], 0))

  const positives = totals.filter((t) => t > 0).sort((a, b) => a - b)
  const rawMax = Math.max(1, ...totals)
  const p95 = positives.length ? positives[Math.min(positives.length - 1, Math.floor(0.95 * positives.length))] : rawMax
  const capCandidate = niceMax(p95)
  const broken = rawMax > capCandidate * 1.6
  const cap = broken ? capCandidate : niceMax(rawMax)

  const iw = Math.max(10, w - padL - padR), ih = H - padT - padB
  const breakBand = broken ? 18 : 0
  const usableH = ih - breakBand
  const baseY = padT + ih
  const capLineY = baseY - usableH
  const step = iw / Math.max(1, n)
  const bw = Math.max(1, step * 0.72)
  const BX = (i) => padL + (i + 0.5) * step
  const BY = (v) => baseY - (v / cap) * usableH

  let acc = labels.map(() => 0)
  const segs = active.map((s) => {
    const lower = acc.slice()
    const upper = acc.map((b, i) => b + s.values[i])
    acc = upper
    return { s, lower, upper }
  })
  const ticks = 4
  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    let i = Math.floor((px - padL) / step)
    i = Math.max(0, Math.min(n - 1, i))
    setHi(i)
    setTip({
      x: e.clientX, y: e.clientY, title: labels[i],
      rows: active.slice().reverse().filter((s) => s.values[i] > 0).map((s) => ({
        color: s.color, l: s.label, v: (yFmt || fmt.int)(s.values[i]),
      })).concat([{ l: 'Total', v: (yFmt || fmt.int)(totals[i]) }]),
    })
  }
  const labStep = Math.ceil(n / Math.max(2, Math.floor(iw / 64)))

  return React.createElement('div', { ref, style: { width: '100%' } },
    w > 0 && React.createElement('svg', {
      className: 'chart', width: w, height: H,
      onMouseMove: onMove, onMouseLeave: () => { setTip(null); setHi(-1) },
      style: { display: 'block', cursor: 'crosshair' },
    },
      React.createElement('defs', null,
        React.createElement('clipPath', { id: clipId },
          React.createElement('rect', { x: padL - 1, y: capLineY, width: iw + padR + 2, height: usableH }))),
      Array.from({ length: ticks + 1 }, (_, k) => {
        const v = (cap / ticks) * k, y = BY(v)
        return React.createElement('g', { key: k },
          React.createElement('line', { className: 'gridln', x1: padL, x2: w - padR, y1: y, y2: y }),
          React.createElement('text', { x: padL - 6, y: y + 3, textAnchor: 'end', fontSize: 9 }, (yFmt || fmt.int)(v)),
        )
      }),
      hi >= 0 && React.createElement('rect', { x: BX(hi) - step / 2, y: padT, width: step, height: ih, fill: 'var(--txt0)', fillOpacity: 0.04 }),
      React.createElement('g', { clipPath: 'url(#' + clipId + ')' },
        segs.map((seg) => labels.map((_, i) => {
          const yU = BY(seg.upper[i]), yL = BY(seg.lower[i])
          const h = yL - yU
          if (h <= 0) return null
          return React.createElement('rect', {
            key: seg.s.key + '-' + i, x: BX(i) - bw / 2, y: yU, width: bw, height: Math.max(0.5, h),
            rx: bw > 4 ? 1 : 0, fill: seg.s.color, fillOpacity: hi === i ? 1 : 0.82,
            stroke: seg.s.border || seg.s.color, strokeWidth: 0.5, strokeOpacity: 0.4,
          })
        }))
      ),
      broken && labels.map((_, i) => {
        if (totals[i] <= cap) return null
        const cx = BX(i), x0 = cx - bw / 2, u = bw / 6
        const zig = `M${x0} ${capLineY} l${u} -4 l${u} 4 l${u} -4 l${u} 4 l${u} -4 l${u} 4`
        return React.createElement('g', { key: 'brk' + i },
          React.createElement('rect', { x: x0, y: capLineY - 1.5, width: bw, height: 4, fill: '#0A0A0A' }),
          React.createElement('path', { d: zig, fill: 'none', stroke: 'var(--txt2)', strokeWidth: 1 }),
          step >= 34 && React.createElement('text', { x: cx, y: capLineY - 7, textAnchor: 'middle', fontSize: 8.5, fontFamily: 'var(--mono)', fill: 'var(--txt0)' }, (yFmt || fmt.compact)(totals[i])),
        )
      }),
      labels.map((l, i) => i % labStep === 0 ? React.createElement('text', {
        key: 'x' + i, x: BX(i), y: H - 7, textAnchor: 'middle', fontSize: 9,
      }, l) : null),
    ),
    React.createElement(Tip, { tip }),
  )
}

// ---------- Multi-line (rate / cumulative over time) ----------
function MultiLine({ series, labels, height, yFmt, pct, hidden, band }: any) {
  const [ref, w] = useWidth()
  const [tip, setTip] = useState(null)
  const [hi, setHi] = useState(-1)
  const H = height || 220, padL = 46, padR = 8, padT = 12, padB = 22
  const n = labels.length
  const active = series.filter((s) => !(hidden && hidden[s.key]))
  const ymaxRaw = Math.max(0.0001, ...active.flatMap((s) => s.values.filter((v) => v != null)))
  const ymax = niceMax(ymaxRaw)
  const iw = Math.max(10, w - padL - padR), ih = H - padT - padB
  const X = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * iw)
  const Y = (v) => padT + ih - (v / ymax) * ih
  const path = (vals) => {
    let d = '', started = false
    for (let i = 0; i < n; i++) {
      if (vals[i] == null) { started = false; continue }
      d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(vals[i]).toFixed(1) + ' '
      started = true
    }
    return d
  }
  const ticks = 4
  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    let i = Math.round((px - padL) / (iw / Math.max(1, n - 1)))
    i = Math.max(0, Math.min(n - 1, i))
    setHi(i)
    setTip({
      x: e.clientX, y: e.clientY, title: labels[i],
      rows: active.filter((s) => s.values[i] != null).map((s) => ({
        color: s.color, l: s.label, v: pct ? fmt.pct(s.values[i]) : (yFmt || fmt.int)(s.values[i]),
      })),
    })
  }
  const labStep = Math.ceil(n / Math.max(2, Math.floor(iw / 64)))
  return React.createElement('div', { ref, style: { width: '100%' } },
    w > 0 && React.createElement('svg', {
      className: 'chart', width: w, height: H, onMouseMove: onMove,
      onMouseLeave: () => { setTip(null); setHi(-1) }, style: { display: 'block', cursor: 'crosshair' },
    },
      Array.from({ length: ticks + 1 }, (_, k) => {
        const v = (ymax / ticks) * k, y = Y(v)
        return React.createElement('g', { key: k },
          React.createElement('line', { className: 'gridln', x1: padL, x2: w - padR, y1: y, y2: y }),
          React.createElement('text', { x: padL - 6, y: y + 3, textAnchor: 'end', fontSize: 9 },
            pct ? fmt.pct0(v) : (yFmt || fmt.int)(v)),
        )
      }),
      band ? React.createElement('path', { d: band, fill: 'var(--txt2)', fillOpacity: .07 }) : null,
      active.map((s) => React.createElement('path', {
        key: s.key, d: path(s.values), fill: 'none', stroke: s.color,
        strokeWidth: s.w || 1.75, strokeOpacity: s.dim ? .5 : 1,
        strokeDasharray: s.dash || 'none',
      })),
      labels.map((l, i) => i % labStep === 0 ? React.createElement('text', {
        key: 'x' + i, x: X(i), y: H - 7, textAnchor: 'middle', fontSize: 9,
      }, l) : null),
      hi >= 0 && React.createElement('line', { className: 'crosshair', x1: X(hi), x2: X(hi), y1: padT, y2: padT + ih }),
      hi >= 0 && active.map((s) => s.values[hi] != null ? React.createElement('circle', {
        key: 'p' + s.key, cx: X(hi), cy: Y(s.values[hi]), r: 3, fill: s.color, stroke: '#0d0d0d', strokeWidth: 1,
      }) : null),
    ),
    React.createElement(Tip, { tip }),
  )
}

// ---------- Vertical bars (cost/tokens by project) ----------
function VBars({ data, height, yFmt, onPick, color }: any) {
  const [ref, w] = useWidth()
  const [tip, setTip] = useState(null)
  const [hi, setHi] = useState(-1)
  const H = height || 200, padL = 46, padR = 8, padT = 12, padB = 64
  const n = data.length
  const ymax = niceMax(Math.max(1, ...data.map((d) => d.value)))
  const iw = Math.max(10, w - padL - padR), ih = H - padT - padB
  const bw = (iw / Math.max(1, n)) * 0.62
  const X = (i) => padL + (i + 0.5) * (iw / Math.max(1, n))
  const Y = (v) => padT + ih - (v / ymax) * ih
  const ticks = 4
  return React.createElement('div', { ref, style: { width: '100%' } },
    w > 0 && React.createElement('svg', { className: 'chart', width: w, height: H, style: { display: 'block' } },
      Array.from({ length: ticks + 1 }, (_, k) => {
        const v = (ymax / ticks) * k, y = Y(v)
        return React.createElement('g', { key: k },
          React.createElement('line', { className: 'gridln', x1: padL, x2: w - padR, y1: y, y2: y }),
          React.createElement('text', { x: padL - 6, y: y + 3, textAnchor: 'end', fontSize: 9 }, (yFmt || fmt.int)(v)))
      }),
      data.map((d, i) => React.createElement('rect', {
        key: i, x: X(i) - bw / 2, y: Y(d.value), width: bw, height: Math.max(0, padT + ih - Y(d.value)),
        rx: 2, fill: d.color || color || 'var(--txt1)', fillOpacity: hi === i ? 1 : .85,
        style: { cursor: onPick ? 'pointer' : 'default' },
        onMouseEnter: (e) => { setHi(i); setTip({ x: e.clientX, y: e.clientY, title: d.full || d.label, rows: [{ l: d.sub || 'Value', v: (yFmt || fmt.int)(d.value) }] }) },
        onMouseMove: (e) => setTip((t) => t && { ...t, x: e.clientX, y: e.clientY }),
        onMouseLeave: () => { setHi(-1); setTip(null) },
        onClick: onPick ? () => onPick(d, i) : null,
      })),
      data.map((d, i) => React.createElement('text', {
        key: 'l' + i, x: X(i), y: H - padB + 14, textAnchor: 'end', fontSize: 9,
        transform: 'rotate(-34 ' + X(i) + ' ' + (H - padB + 14) + ')',
        fill: hi === i ? 'var(--txt0)' : 'var(--txt2)',
      }, d.label)),
    ),
    React.createElement(Tip, { tip }),
  )
}

// ---------- Histogram with markers (generic x formatter) ----------
function Histogram({ values, height, color, markers, xFmt, bins }: any) {
  const [ref, w] = useWidth()
  const [tip, setTip] = useState(null)
  const xf = xFmt || fmt.ms
  const H = height || 180, padL = 8, padR = 8, padT = 12, padB = 28
  if (!values.length) values = [0]
  const lo = Math.min(...values), hi = Math.max(...values, lo + 1)
  const BINS = bins || 26
  const arr = new Array(BINS).fill(0)
  values.forEach((v) => { let b = Math.floor((v - lo) / (hi - lo) * BINS); if (b >= BINS) b = BINS - 1; if (b < 0) b = 0; arr[b]++ })
  const ymax = Math.max(1, ...arr)
  const iw = Math.max(10, w - padL - padR), ih = H - padT - padB
  const bw = iw / BINS
  const Xv = (v) => padL + ((v - lo) / (hi - lo)) * iw
  return React.createElement('div', { ref, style: { width: '100%' } },
    w > 0 && React.createElement('svg', { className: 'chart', width: w, height: H, style: { display: 'block' } },
      arr.map((c, i) => React.createElement('rect', {
        key: i, x: padL + i * bw + 0.5, y: padT + ih - (c / ymax) * ih, width: bw - 1,
        height: (c / ymax) * ih, fill: color || 'var(--txt1)', fillOpacity: .55, rx: 1,
        onMouseEnter: (e) => setTip({ x: e.clientX, y: e.clientY, title: xf(lo + (i / BINS) * (hi - lo)) + '–' + xf(lo + ((i + 1) / BINS) * (hi - lo)), rows: [{ l: 'Sessions', v: c }] }),
        onMouseMove: (e) => setTip((t) => t && { ...t, x: e.clientX, y: e.clientY }),
        onMouseLeave: () => setTip(null),
      })),
      (markers || []).map((m, i) => React.createElement('g', { key: 'm' + i },
        React.createElement('line', { x1: Xv(m.v), x2: Xv(m.v), y1: padT - 2, y2: padT + ih, stroke: m.color || 'var(--txt0)', strokeWidth: 1.5, strokeDasharray: m.dash || 'none' }),
        React.createElement('text', { x: Xv(m.v), y: padT - 4, textAnchor: 'middle', fontSize: 9, fill: m.color || 'var(--txt0)' }, m.label),
      )),
      React.createElement('text', { x: padL, y: H - 8, textAnchor: 'start', fontSize: 9 }, xf(lo)),
      React.createElement('text', { x: w - padR, y: H - 8, textAnchor: 'end', fontSize: 9 }, xf(hi)),
    ),
    React.createElement(Tip, { tip }),
  )
}

// ---------- Donut ----------
function Donut({ segments, size, thickness, centerTop, centerBot }: any) {
  const sz = size || 132, th = thickness || 16, r = (sz - th) / 2, cx = sz / 2, cy = sz / 2
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  let ang = -Math.PI / 2
  const C = 2 * Math.PI * r
  return React.createElement('div', { style: { position: 'relative', width: sz, height: sz } },
    React.createElement('svg', { width: sz, height: sz },
      segments.map((s, i) => {
        const frac = s.value / total
        const dash = frac * C
        const el = React.createElement('circle', {
          key: i, cx, cy, r, fill: 'none', stroke: s.color, strokeWidth: th,
          strokeDasharray: dash + ' ' + (C - dash),
          strokeDashoffset: -((ang + Math.PI / 2) / (2 * Math.PI)) * C,
          transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
        })
        ang += frac * 2 * Math.PI
        return el
      }),
    ),
    React.createElement('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 } },
      React.createElement('div', { className: 'mono tnum', style: { fontSize: 20, fontWeight: 300, color: 'var(--txt0)' } }, centerTop),
      React.createElement('div', { className: 'mono', style: { fontSize: 8.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--txt2)' } }, centerBot),
    ),
  )
}

// ---------- Sparkline ----------
function Sparkline({ data, w, h, color, fill }: any) {
  w = w || 80; h = h || 26
  if (!data || !data.length) return null
  const max = Math.max(...data), min = Math.min(...data)
  const rng = max - min || 1
  const X = (i) => (i / (data.length - 1)) * (w - 2) + 1
  const Y = (v) => h - 2 - ((v - min) / rng) * (h - 4)
  let d = '', area = ''
  data.forEach((v, i) => { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ' })
  area = d + 'L' + X(data.length - 1) + ' ' + h + ' L' + X(0) + ' ' + h + ' Z'
  return React.createElement('svg', { width: w, height: h, style: { display: 'block' } },
    fill && React.createElement('path', { d: area, fill: color || 'var(--txt1)', fillOpacity: .12 }),
    React.createElement('path', { d, fill: 'none', stroke: color || 'var(--txt1)', strokeWidth: 1.4, strokeLinejoin: 'round', strokeLinecap: 'round' }),
  )
}

export const LHC = { StackedBars, MultiLine, VBars, Histogram, Donut, Sparkline, useWidth }
