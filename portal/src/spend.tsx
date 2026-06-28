/* Claude Receipts — Spend: where the money goes. */
import { useState, useMemo } from 'react'
import { LH } from './data'
import { LHA } from './agg'
import { LHC } from './charts'
import { LHU } from './ui'

const fmt = LH.fmt
const DIM = ['#8FB0D4', '#C88754', '#A8DDB8', '#B6A0CE', '#7FC6B5', '#BFBBB0']

function pctile(arr: number[], p: number) {
  if (!arr.length) return 0
  const s = arr.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

function DimDonut({ title, hint, rows, center }: any) {
  const tot = rows.reduce((a: number, r: any) => a + r.cost, 0)
  return (
    <LHU.Card title={title} hint={hint}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '4px 0 6px' }}>
        <LHC.Donut segments={rows.map((r: any, i: number) => ({ value: r.cost, color: DIM[i % DIM.length] }))} centerTop={fmt.usdC(tot)} centerBot={center} size={120} />
        <div style={{ flex: 1, minWidth: 0 }} className="fmix">
          {rows.map((r: any, i: number) => (
            <div className="fmrow" key={r.key}>
              <span className="sw" style={{ background: DIM[i % DIM.length] }} />
              <span className="nm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key || '—'}</span>
              <span className="q tnum">{fmt.pct0(tot ? r.cost / tot : 0)}<i>{fmt.usdC(r.cost)}</i></span>
            </div>
          ))}
        </div>
      </div>
    </LHU.Card>
  )
}

export function Spend({ sessions, prevSessions, win, bks, openProject, openSession }: any) {
  const [hidden, setHidden] = useState<any>({})
  const toggleHide = (k: string) => setHidden((h: any) => ({ ...h, [k]: !h[k] }))

  const t = useMemo(() => LHA.totals(sessions), [sessions])
  const pt = useMemo(() => LHA.totals(prevSessions), [prevSessions])
  const costStack = useMemo(() => LHA.costOverTime(sessions, bks), [sessions, bks])
  const costSpark = useMemo(() => LHA.costSeries(sessions, bks), [sessions, bks])
  const cumSpend = useMemo(() => LHA.cumulative(costSpark), [costSpark])
  const projs = useMemo(() => LHA.topProjects(sessions, 'cost').slice(0, 14), [sessions])
  const byMachine = useMemo(() => LHA.byDimCost(sessions, 'machine'), [sessions])
  const byLoc = useMemo(() => LHA.byDimCost(sessions, 'location'), [sessions])
  const big = useMemo(() => LHA.biggestSessions(sessions, 8), [sessions])
  const costs = useMemo(() => sessions.map((s: any) => s.cost), [sessions])

  const p50 = pctile(costs, 0.5), p95 = pctile(costs, 0.95), maxC = Math.max(0, ...costs)
  const activeDays = new Set(sessions.map((s: any) => new Date(s.start).toDateString())).size
  const perDay = activeDays ? t.cost / activeDays : 0

  const kpis = [
    { k: 'Total Spend', v: fmt.usd0(t.cost), cur: t.cost, prev: pt.cost, invert: true, spark: costSpark, sparkColor: '#C88754' },
    { k: 'Avg / Session', v: fmt.usd(t.avgCost), cur: t.avgCost, prev: pt.avgCost, invert: true },
    { k: 'Spend / Active Day', v: fmt.usd(perDay) },
    { k: 'Most Expensive', v: fmt.usd(maxC) },
  ]

  return (
    <>
      <LHU.KpiStrip items={kpis} />

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginTop: 14 }}>
        <LHU.Card
          title="Spend Over Time"
          hint={'usd · per ' + (win.unit === 'day' ? 'day' : 'week') + ' · by primary model'}
          right={<LHU.Legend feats={costStack} hidden={hidden} onToggle={toggleHide} />}
        >
          <LHC.StackedBars series={costStack} labels={bks.map((b: any) => b.label)} height={250} hidden={hidden} yFmt={fmt.usdC} />
        </LHU.Card>
        <LHU.Card title="Cumulative Spend" hint="running total">
          <LHC.MultiLine
            labels={bks.map((b: any) => b.label)}
            height={250}
            yFmt={fmt.usdC}
            series={[{ key: 'cum', label: 'Cumulative', color: '#D2FE05', values: cumSpend, w: 2 }]}
          />
        </LHU.Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr', marginTop: 14 }}>
        <LHU.Card title="Cost by Project" hint="top 14 · click a bar to filter">
          <LHC.VBars
            data={projs.map((p: any) => ({
              label: p.project.length > 16 ? p.project.slice(0, 15) + '…' : p.project,
              full: p.project, value: p.cost, sub: 'spend',
              color: LH.FAM_BY[p.topFam]?.color || 'var(--txt1)',
            }))}
            height={250}
            yFmt={fmt.usdC}
            onPick={(d: any) => openProject(d.full)}
          />
        </LHU.Card>
        <LHU.Card title="Receipt Size Distribution" hint="per-session cost · p50 / p95">
          <div style={{ paddingTop: 18 }}>
            <LHC.Histogram
              values={costs}
              height={232}
              color="#C88754"
              xFmt={fmt.usdC}
              markers={[
                { v: p50, label: 'P50 ' + fmt.usdC(p50), color: '#8FB0D4', dash: '3 3' },
                { v: p95, label: 'P95 ' + fmt.usdC(p95), color: '#dd6a3d' },
              ]}
            />
          </div>
        </LHU.Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1.1fr', marginTop: 14 }}>
        <DimDonut title="Spend by Machine" hint="which box" rows={byMachine} center="SPEND" />
        <DimDonut title="Spend by Location" hint="where" rows={byLoc} center="SPEND" />
        <LHU.Card title="Biggest Receipts" hint="by cost · click to open">
          <LHU.HList
            rows={big.map((s: any, i: number) => ({
              key: s._i, rank: String(i + 1).padStart(2, '0'), name: s.project, sub: fmt.date(s.start),
              swatch: LH.FAM_BY[s.fam]?.color, value: s.cost, valLabel: fmt.usd(s.cost), onClick: () => openSession(s),
            }))}
          />
        </LHU.Card>
      </div>
    </>
  )
}
