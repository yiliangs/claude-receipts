/* Claude Receipts — session drill-in rendered as a paper thermal receipt. */
import { LH, modelShort } from './data'
import { LHI } from './icons'

const fmt = LH.fmt

function Row({ k, v }: any) {
  return (
    <div className="rc-row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  )
}
function Line({ k, v, bold }: any) {
  return (
    <div className="rc-line" style={bold ? { fontWeight: 600 } : undefined}>
      <span>{k}</span>
      <span className="v">{v}</span>
    </div>
  )
}

function Receipt({ s }: any) {
  return (
    <div className="receipt">
      <div className="rc-logo">CLAUDE RECEIPTS</div>
      <div className="rc-sub">usage ledger</div>
      <hr className="rc-rule" />
      <Row k="Session" v={s.slug} />
      <Row k="Project" v={s.project} />
      {s.branch && <Row k="Branch" v={s.branch} />}
      <Row k="Machine" v={s.machine} />
      {s.location && <Row k="Location" v={s.location} />}
      <Row k="Started" v={fmt.datetime(s.start)} />
      <Row k="Duration" v={s.durHuman || fmt.dur(s.durSec)} />
      <hr className="rc-rule" />
      <div className="rc-row"><span className="k">Tokens</span><span className="k">{fmt.int(s.totalTokens)}</span></div>
      <Line k="Input" v={fmt.int(s.input)} />
      <Line k="Output" v={fmt.int(s.output)} />
      <Line k="Cache Write" v={fmt.int(s.cacheCreate)} />
      <Line k="Cache Read" v={fmt.int(s.cacheRead)} />
      <hr className="rc-rule" />
      <div className="rc-row"><span className="k">Models</span></div>
      <div className="rc-models">
        {s.models.length ? (
          s.models.map((m: string, i: number) => (
            <span className="rc-mtag" key={i}>{modelShort(m)}</span>
          ))
        ) : (
          <span className="rc-mtag">—</span>
        )}
      </div>
      <hr className="rc-rule" />
      <div className="rc-total">
        <span className="k">TOTAL</span>
        <span className="v">{fmt.usd(s.cost)}</span>
      </div>
      <div className="rc-barcode" />
      <div className="rc-foot">Thank you for building!</div>
      <div className="rc-foot" style={{ letterSpacing: '.04em', marginTop: 4 }}>{s.sid}</div>
    </div>
  )
}

export function Drawer({ drill, onClose }: any) {
  const s = drill?.session
  return (
    <>
      <div className={'scrim' + (drill ? ' on' : '')} onClick={onClose} />
      <div className={'drawer' + (drill ? ' on' : '')}>
        {drill && (
          <>
            <div className="drawer-h">
              <span className="id">SESSION <b>{s.slug}</b></span>
              <span className="sp" />
              <button className="drawer-x" onClick={onClose}><LHI.Close s={14} /></button>
            </div>
            <div className="drawer-bd">
              <Receipt s={s} />
            </div>
          </>
        )}
      </div>
    </>
  )
}
