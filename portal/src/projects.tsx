/* Agent Usage Stat — Projects: one row per project, fully detailed.
   Click a row → filter to that project and jump to the Sessions explorer. */
import { useState, useMemo } from 'react'
import { LH } from './data'
import { LHA } from './agg'
import { LHU } from './ui'

const fmt = LH.fmt

const COLS = [
  { key: 'project', label: 'Project', flex: 2, num: false, sort: (p: any) => p.project.toLowerCase(), defDir: 1 },
  { key: 'sessions', label: 'Sessions', flex: 0.85, num: true, sort: (p: any) => p.sessions },
  { key: 'cost', label: 'Spend', flex: 1.0, num: true, sort: (p: any) => p.cost },
  { key: 'tokens', label: 'Tokens', flex: 1.0, num: true, sort: (p: any) => p.tokens },
  { key: 'avgCost', label: 'Avg / Ses', flex: 1.0, num: true, sort: (p: any) => p.avgCost },
  { key: 'durSec', label: 'Duration', flex: 1.0, num: true, sort: (p: any) => p.durSec },
  { key: 'topFam', label: 'Top Model', flex: 1.1, num: false, sort: (p: any) => p.cost },
  { key: 'machines', label: 'Boxes', flex: 0.7, num: true, sort: (p: any) => p.machines },
  { key: 'last', label: 'Last Active', flex: 1.1, num: false, sort: (p: any) => p.last },
]

function ModelTag({ famKey }: any) {
  const f = LH.FAM_BY[famKey]
  if (!f) return <span className="faint">—</span>
  return (
    <span className="mchip">
      <span className="d" style={{ background: f.color }} />
      {f.label}
    </span>
  )
}

export function Projects({ sessions, focusProject }: any) {
  const roster = useMemo(() => LHA.projectRoster(sessions), [sessions])
  const [sort, setSort] = useState({ key: 'cost', dir: -1 })

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key)!
    const arr = roster.slice()
    arr.sort((a: any, b: any) => {
      const av = col.sort(a), bv = col.sort(b)
      if (av < bv) return -sort.dir
      if (av > bv) return sort.dir
      return 0
    })
    return arr
  }, [roster, sort])

  const setS = (c: any) => setSort((s) => (s.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: c.defDir || -1 }))

  const k = useMemo(() => {
    const totCost = roster.reduce((a: number, p: any) => a + p.cost, 0)
    const top = roster.slice().sort((a: any, b: any) => b.cost - a.cost)[0]
    const busiest = roster.slice().sort((a: any, b: any) => b.sessions - a.sessions)[0]
    return { count: roster.length, totCost, top, busiest }
  }, [roster])

  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {[
          { k: 'Projects', v: fmt.int(k.count), s: 'in range' },
          { k: 'Top Spender', v: k.top ? fmt.usd0(k.top.cost) : '—', s: k.top ? k.top.project : '' },
          { k: 'Busiest', v: k.busiest ? fmt.int(k.busiest.sessions) + ' ses' : '—', s: k.busiest ? k.busiest.project : '' },
          { k: 'Avg / Project', v: fmt.usd(k.count ? k.totCost / k.count : 0), s: 'this range' },
        ].map((x, i) => (
          <div className="kpi" key={i}>
            <div className="k">{x.k}</div>
            <div className="v tnum">{x.v}</div>
            <div className="vs" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.s}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <LHU.Card title="Project Roster" hint={roster.length + ' projects · click a row for its sessions'}>
          <div className="tablewrap" style={{ flex: 'none' }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 880 }}>
                <div className="tbl-head" style={{ borderRadius: 8, border: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-default)' }}>
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
                {sorted.length === 0 ? (
                  <div className="zero" style={{ padding: 28 }}>no projects in range</div>
                ) : (
                  sorted.map((p: any) => (
                    <div
                      key={p.project}
                      className="trow"
                      style={{ position: 'static', height: 42, cursor: 'pointer' }}
                      onClick={() => focusProject(p.project)}
                    >
                      <div className="td" style={{ flex: COLS[0].flex }}><span className="name">{p.project}</span></div>
                      <div className="td num mono tnum" style={{ flex: COLS[1].flex }}>{p.sessions}</div>
                      <div className="td num mono tnum" style={{ flex: COLS[2].flex }}><span className="u">{fmt.usd(p.cost)}</span></div>
                      <div className="td num mono tnum" style={{ flex: COLS[3].flex }}>{fmt.compact(p.tokens)}</div>
                      <div className="td num mono tnum" style={{ flex: COLS[4].flex }}>{fmt.usd(p.avgCost)}</div>
                      <div className="td num mono tnum" style={{ flex: COLS[5].flex }}>{fmt.dur(p.durSec)}</div>
                      <div className="td" style={{ flex: COLS[6].flex }}><ModelTag famKey={p.topFam} /></div>
                      <div className="td num mono tnum" style={{ flex: COLS[7].flex }}>{p.machines}</div>
                      <div className="td" style={{ flex: COLS[8].flex }}><span className="muted">{fmt.rel(p.last)}</span></div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </LHU.Card>
      </div>
    </>
  )
}
