/* Claude Receipts — Tokens: composition, cache efficiency, where they go. */
import { useState, useMemo } from 'react'
import { LH } from './data'
import { LHA } from './agg'
import { LHC } from './charts'
import { LHU } from './ui'

const fmt = LH.fmt

export function Tokens({ sessions, prevSessions, win, bks, openProject }: any) {
  const [hidden, setHidden] = useState<any>({})
  const toggleHide = (k: string) => setHidden((h: any) => ({ ...h, [k]: !h[k] }))

  const t = useMemo(() => LHA.totals(sessions), [sessions])
  const pt = useMemo(() => LHA.totals(prevSessions), [prevSessions])
  const tokStack = useMemo(() => LHA.tokensOverTime(sessions, bks), [sessions, bks])
  const tokSpark = useMemo(() => LHA.tokenSeries(sessions, bks), [sessions, bks])
  const mix = useMemo(() => LHA.tokenMix(sessions), [sessions])
  const cacheRate = useMemo(() => LHA.cacheHitSeries(sessions, bks), [sessions, bks])
  const projs = useMemo(() => LHA.topProjects(sessions, 'tokens').slice(0, 14), [sessions])

  const tokPerUsd = t.cost ? t.tokens / t.cost : 0
  const ptPerUsd = pt.cost ? pt.tokens / pt.cost : 0
  const totMix = mix.reduce((a, m) => a + m.value, 0)

  const kpis = [
    { k: 'Total Tokens', v: fmt.compact(t.tokens), cur: t.tokens, prev: pt.tokens, spark: tokSpark, sparkColor: '#7FC6B5' },
    { k: 'Output', v: fmt.compact(t.output), cur: t.output, prev: pt.output, sparkColor: '#C88754' },
    { k: 'Cache Read', v: fmt.compact(t.cacheRead), cur: t.cacheRead, prev: pt.cacheRead },
    { k: 'Cache Hit', v: fmt.pct0(t.cacheHit), cur: t.cacheHit, prev: pt.cacheHit },
    { k: 'Tokens / $', v: fmt.compact(tokPerUsd), cur: tokPerUsd, prev: ptPerUsd },
  ]

  return (
    <>
      <LHU.KpiStrip items={kpis} />

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginTop: 14 }}>
        <LHU.Card
          title="Token Composition Over Time"
          hint={'tokens · per ' + (win.unit === 'day' ? 'day' : 'week')}
          right={<LHU.Legend feats={tokStack} hidden={hidden} onToggle={toggleHide} />}
        >
          <LHC.StackedBars series={tokStack} labels={bks.map((b: any) => b.label)} height={250} hidden={hidden} yFmt={fmt.compact} />
        </LHU.Card>
        <LHU.Card title="Token Mix" hint="share of all tokens">
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 16px' }}>
            <LHC.Donut segments={mix.map((m) => ({ value: m.value, color: m.color }))} centerTop={fmt.compact(totMix)} centerBot="TOKENS" />
          </div>
          <div className="fmix">
            {mix.map((m) => (
              <div className="fmrow" key={m.key}>
                <span className="sw" style={{ background: m.color }} />
                <span className="nm">{m.label}</span>
                <span className="q tnum">{fmt.pct0(m.share)}<i>{fmt.compact(m.value)}</i></span>
                <span className="bar"><span className="f" style={{ width: 100 * m.share + '%', background: m.color, opacity: 0.85 }} /></span>
              </div>
            ))}
          </div>
        </LHU.Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.1fr 1.7fr', marginTop: 14 }}>
        <LHU.Card title="Cache Hit Rate" hint="cache-read share of tokens, over time">
          <LHC.MultiLine
            labels={bks.map((b: any) => b.label)}
            height={232}
            pct
            series={[{ key: 'hit', label: 'Cache Hit', color: '#7FC6B5', values: cacheRate, w: 2 }]}
          />
        </LHU.Card>
        <LHU.Card title="Tokens by Project" hint="top 14 · click a bar to filter">
          <LHC.VBars
            data={projs.map((p: any) => ({
              label: p.project.length > 16 ? p.project.slice(0, 15) + '…' : p.project,
              full: p.project, value: p.tokens, sub: 'tokens',
              color: LH.FAM_BY[p.topFam]?.color || 'var(--txt1)',
            }))}
            height={232}
            yFmt={fmt.compact}
            onPick={(d: any) => openProject(d.full)}
          />
        </LHU.Card>
      </div>
    </>
  )
}
