/* Agent Usage Stat session detail drawer. */
import { LH, modelShort } from './data'
import { LHI } from './icons'

const fmt = LH.fmt

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="sd-row">
      <span className="k">{label}</span>
      <span className="v">{String(value)}</span>
    </div>
  )
}

function SessionDetail({ session: s }: any) {
  return (
    <div className="session-detail">
      <div className="sd-top">
        <span className={'provider-badge ' + s.provider}>{s.provider === 'codex' ? 'Codex' : 'Claude Code'}</span>
        <span className="sd-cost">{fmt.usd(s.cost)}</span>
      </div>
      <h2>{s.slug}</h2>
      <p className="sd-project">{s.project}</p>

      <section>
        <h3>Session</h3>
        {s.branch && <Row label="Branch" value={s.branch} />}
        <Row label="Machine" value={s.machine} />
        <Row label="Started" value={fmt.datetime(s.start)} />
        <Row label="Duration" value={s.durHuman || fmt.dur(s.durSec)} />
      </section>

      <section>
        <h3>Tokens</h3>
        <Row label="Total" value={fmt.int(s.totalTokens)} />
        <Row label="Input" value={fmt.int(s.input)} />
        <Row label="Output" value={fmt.int(s.output)} />
        <Row label="Cache write" value={fmt.int(s.cacheCreate)} />
        <Row label="Cache read" value={fmt.int(s.cacheRead)} />
      </section>

      <section>
        <h3>Models</h3>
        <div className="sd-models">
          {s.models.length
            ? s.models.map((model: string) => <span key={model}>{modelShort(model)}</span>)
            : <span>Unknown</span>}
        </div>
      </section>

      <div className="sd-id">{s.sid}</div>
    </div>
  )
}

export function Drawer({ drill, onClose }: any) {
  const session = drill?.session
  return (
    <>
      <div className={'scrim' + (drill ? ' on' : '')} onClick={onClose} />
      <div className={'drawer' + (drill ? ' on' : '')}>
        {drill && (
          <>
            <div className="drawer-h">
              <span className="id">SESSION DETAIL</span>
              <span className="sp" />
              <button className="drawer-x" onClick={onClose}><LHI.Close s={14} /></button>
            </div>
            <div className="drawer-bd"><SessionDetail session={session} /></div>
          </>
        )}
      </div>
    </>
  )
}
