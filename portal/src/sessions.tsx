/* Agent Usage Stat session explorer. */
import { useState, useRef, useMemo, useLayoutEffect } from 'react'
import { LH, familyOf, modelShort } from './data'

const fmt = LH.fmt
const ROW_H = 40

const COLS = [
  { key: 'slug', label: 'Session', flex: 1.1, mono: true, sort: (s: any) => s.slug, defDir: 1 },
  { key: 'project', label: 'Project', flex: 1.6, sort: (s: any) => s.project.toLowerCase(), defDir: 1 },
  { key: 'machine', label: 'Machine', flex: 1.1, sort: (s: any) => s.machine, defDir: 1 },
  { key: 'models', label: 'Models', flex: 1.5, sort: (s: any) => s.primaryModel, defDir: 1 },
  { key: 'start', label: 'Started', flex: 1.4, sort: (s: any) => s.start },
  { key: 'durSec', label: 'Duration', flex: 0.95, num: true, sort: (s: any) => s.durSec },
  { key: 'totalTokens', label: 'Tokens', flex: 1.0, num: true, sort: (s: any) => s.totalTokens },
  { key: 'cost', label: 'Cost', flex: 0.95, num: true, sort: (s: any) => s.cost },
]

function ModelsCell({ s }: any) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {s.models.slice(0, 4).map((m: string, i: number) => {
          const fam = LH.FAM_BY[familyOf(m)]
          return <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: fam?.color || 'var(--txt2)' }} />
        })}
      </span>
      <span style={{ color: 'var(--txt1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {modelShort(s.primaryModel)}
      </span>
      {s.models.length > 1 && <span className="faint" style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>+{s.models.length - 1}</span>}
    </span>
  )
}
export function Sessions({ sessions, openSession }: any) {
  const [sort, setSort] = useState({ key: 'start', dir: -1 })
  const [scrollTop, setScrollTop] = useState(0)
  const [vh, setVh] = useState(600)
  const vref = useRef<any>(null)

  useLayoutEffect(() => {
    if (!vref.current) return
    const ro = new ResizeObserver(() => setVh(vref.current.clientHeight))
    ro.observe(vref.current)
    setVh(vref.current.clientHeight)
    return () => ro.disconnect()
  }, [])

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key)!
    const arr = sessions.slice()
    arr.sort((a: any, b: any) => {
      const av = col.sort(a), bv = col.sort(b)
      if (av < bv) return -sort.dir
      if (av > bv) return sort.dir
      return 0
    })
    return arr
  }, [sessions, sort])

  const setS = (c: any) => setSort((s) => (s.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: c.defDir || -1 }))

  const total = sorted.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 6)
  const last = Math.min(total, Math.ceil((scrollTop + vh) / ROW_H) + 6)
  const slice: any[] = []
  for (let i = first; i < last; i++) slice.push(sorted[i])

  const totCost = useMemo(() => sessions.reduce((a: number, s: any) => a + s.cost, 0), [sessions])

  return (
    <div className="card pad0 tablewrap" style={{ flex: 1, minHeight: 0 }}>
      <div className="tbl-head">
        {COLS.map((c) => (
          <div
            key={c.key}
            className={'th' + (c.num ? ' num' : '') + (sort.key === c.key ? ' sorted' : '')}
            style={{ flex: c.flex }}
            onClick={() => setS(c)}
          >
            {c.label}
            <span className="ar">{sort.dir < 0 ? '▼' : '▲'}</span>
          </div>
        ))}
      </div>
      <div className="vlist" ref={vref} onScroll={(e: any) => setScrollTop(e.target.scrollTop)}>
        <div style={{ height: total * ROW_H, position: 'relative' }}>
          {slice.map((s, k) => {
            const idx = first + k
            const flag = s.cost === 0
            return (
              <div
                key={s._i}
                className={'trow' + (flag ? ' flag' : '')}
                style={{ top: idx * ROW_H, height: ROW_H }}
                onClick={() => openSession(s)}
              >
                <div className="td mono" style={{ flex: COLS[0].flex }}><span className="u">{s.slug}</span></div>
                <div className="td" style={{ flex: COLS[1].flex }}><span className="name">{s.project}</span></div>
                <div className="td" style={{ flex: COLS[2].flex }}><span className="muted">{s.machine}</span></div>
                <div className="td" style={{ flex: COLS[3].flex }}><ModelsCell s={s} /></div>
                <div className="td mono" style={{ flex: COLS[4].flex }}>{fmt.datetime(s.start)}</div>
                <div className="td num mono tnum" style={{ flex: COLS[5].flex }}>{fmt.dur(s.durSec)}</div>
                <div className="td num mono tnum" style={{ flex: COLS[6].flex }}>{fmt.compact(s.totalTokens)}</div>
                <div className="td num mono tnum" style={{ flex: COLS[7].flex }}>
                  {flag ? <span className="faint">$0.00</span> : <span className="u">{fmt.usd(s.cost)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="tbl-foot">
        <span><b>{fmt.int(total)}</b> sessions</span>
        <span style={{ color: 'var(--border-default)' }}>·</span>
        <span><b>{fmt.usd(totCost)}</b> spend</span>
        <span className="sp" style={{ flex: 1 }} />
        <span>virtualized · {fmt.int(LH.SESSIONS.length)} total in ledger</span>
      </div>
    </div>
  )
}
