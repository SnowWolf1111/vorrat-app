import { useState } from 'react'
import type { Article } from '../db'
import type { Data } from '../data'
import { addStock } from '../actions'
import { fmtDate, parseMhd, vibrate } from '../format'
import { Sheet, Stepper, useToast } from './common'

const QUICK: { label: string; months?: number; days?: number }[] = [
  { label: '+1 Woche', days: 7 },
  { label: '+3 Monate', months: 3 },
  { label: '+6 Monate', months: 6 },
  { label: '+1 Jahr', months: 12 },
]

function plus({ months = 0, days = 0 }: { months?: number; days?: number }) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('sv-SE')
}

export function StockInSheet({ article, data, onClose, onDone }: { article: Article | null; data: Data; onClose: () => void; onDone?: () => void }) {
  return (
    <Sheet open={!!article} onClose={onClose} title={article ? `Einlagern: ${article.name}` : ''}>
      {article && <StockInForm key={article.id} article={article} data={data} onDone={() => (onDone ?? onClose)()} />}
    </Sheet>
  )
}

function StockInForm({ article, data, onDone }: { article: Article; data: Data; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState(1)
  const [mhdText, setMhdText] = useState('')
  const [mhd, setMhd] = useState<string | null>(null)
  const [loc, setLoc] = useState<number>(article.default_location_id ?? data.locations[0]?.id)
  const parsed = mhdText ? parseMhd(mhdText) : null
  const bestBefore = mhd ?? parsed

  async function save() {
    if (amount <= 0) return
    await addStock(article, amount, loc, bestBefore)
    vibrate()
    toast(
      <>+{amount} {article.name} → {data.locationById.get(loc)?.name}</>,
      'ok',
    )
    onDone()
  }

  return (
    <div className="form">
      <div className="field">
        <span className="field-label">Menge{article.unit ? ` (${article.unit})` : ''}</span>
        <Stepper value={amount} onChange={setAmount} min={0} big />
      </div>

      <div className="field">
        <span className="field-label">Mindesthaltbar bis</span>
        <input
          className="mhd-input"
          inputMode="numeric"
          placeholder="z. B. 0326 oder 150326"
          value={mhd ? fmtDate(mhd) : mhdText}
          onChange={(e) => {
            setMhd(null)
            setMhdText(e.target.value)
          }}
        />
        <div className="hint">
          {mhd ? (
            <>Gewählt: {fmtDate(mhd)}</>
          ) : mhdText && !parsed ? (
            <span className="warn-text">Format: MMJJ (0326) oder TTMMJJ (150326)</span>
          ) : parsed ? (
            <>= {fmtDate(parsed)}</>
          ) : (
            <>Leer lassen = ohne MHD</>
          )}
        </div>
        <div className="chips">
          {QUICK.map((q) => (
            <button key={q.label} type="button" className="chip" onClick={() => (setMhd(plus(q)), setMhdText(''))}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Lagerort</span>
        <div className="seg">
          {data.locations.map((l) => (
            <button key={l.id} type="button" className={l.id === loc ? 'on' : ''} onClick={() => setLoc(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
      </div>

      <button className="primary" onClick={save} disabled={amount <= 0 || (!!mhdText && !parsed && !mhd)}>
        Einlagern
      </button>
    </div>
  )
}
