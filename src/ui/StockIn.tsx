import { useRef, useState } from 'react'
import type { Article } from '../db'
import { knownVariants, type Data } from '../data'
import { addStock } from '../actions'
import { fmtDate, parseMhd, vibrate } from '../format'
import { Icon, Sheet, Stepper, useToast } from './common'

const QUICK: { label: string; months?: number; days?: number }[] = [
  { label: '+1 Woche', days: 7 },
  { label: '+3 Monate', months: 3 },
  { label: '+6 Monate', months: 6 },
  { label: '+1 Jahr', months: 12 },
]
const AMOUNTS = [1, 2, 3, 4, 6, 10]

function plus({ months = 0, days = 0 }: { months?: number; days?: number }) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('sv-SE')
}

export type StockInRequest = { article: Article; amount?: number; ean?: string | null; variant?: string | null }

export function StockInSheet({ req, data, onClose, onDone }: { req: StockInRequest | null; data: Data; onClose: () => void; onDone?: () => void }) {
  return (
    <Sheet open={!!req} onClose={onClose} title={req ? `Einlagern: ${req.article.name}` : ''} tall>
      {req && <StockInForm key={req.article.id + (req.ean ?? '')} req={req} data={data} onDone={() => (onDone ?? onClose)()} />}
    </Sheet>
  )
}

function StockInForm({ req, data, onDone }: { req: StockInRequest; data: Data; onDone: () => void }) {
  const { article } = req
  const toast = useToast()
  const [amount, setAmount] = useState(req.amount ?? 1)
  const [mhdText, setMhdText] = useState('')
  const [mhd, setMhd] = useState<string | null>(null)
  const [ocr, setOcr] = useState<'idle' | 'busy' | 'found' | 'none'>('idle')
  const [variant, setVariant] = useState(req.variant ?? '')
  const [loc, setLoc] = useState<number>(article.default_location_id ?? data.locations[0]?.id)
  const photo = useRef<HTMLInputElement>(null)
  const parsed = mhdText ? parseMhd(mhdText) : null
  const bestBefore = mhd ?? parsed
  const variants = knownVariants(article, data)

  async function save() {
    if (amount <= 0) return
    await addStock(article, amount, loc, bestBefore, { ean: req.ean, variant: variant || null })
    vibrate()
    toast(<>+{amount} {article.name} → {data.locationById.get(loc)?.name}</>, 'ok')
    onDone()
  }

  async function readPhoto(file: File | undefined) {
    if (!file) return
    setOcr('busy')
    try {
      const { readMhdFromImage } = await import('../ocr')
      const r = await readMhdFromImage(file)
      if (r.date) {
        setMhd(r.date)
        setMhdText('')
        setOcr('found')
        vibrate()
      } else setOcr('none')
    } catch {
      setOcr('none')
    }
  }

  return (
    <div className="form">
      <div className="field">
        <span className="field-label">Menge{article.unit ? ` (${article.unit})` : ''}</span>
        <div className="amount-row">
          <Stepper value={amount} onChange={setAmount} min={0} big />
        </div>
        <div className="chips">
          {AMOUNTS.map((n) => (
            <button key={n} type="button" className={`chip ${amount === n ? 'on' : ''}`} onClick={() => setAmount(n)}>{n}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Mindesthaltbar bis</span>
        <div className="mhd-row">
          <input
            className="mhd-input"
            inputMode="numeric"
            placeholder="z. B. 0326 oder 150326"
            value={mhd ? fmtDate(mhd) : mhdText}
            onChange={(e) => {
              setMhd(null)
              setOcr('idle')
              setMhdText(e.target.value)
            }}
          />
          <button type="button" className="round" onClick={() => photo.current?.click()} aria-label="MHD fotografieren" disabled={ocr === 'busy'}>
            <Icon.camera />
          </button>
          <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => readPhoto(e.target.files?.[0])} />
        </div>
        <div className="hint">
          {ocr === 'busy' ? (
            <>Lese das Datum … (beim ersten Mal dauert es etwas)</>
          ) : ocr === 'found' && mhd ? (
            <span className="ok-text">Erkannt: {fmtDate(mhd)} – bitte kurz prüfen</span>
          ) : ocr === 'none' ? (
            <span className="warn-text">Kein Datum erkannt. Näher ran, gerade halten, oder eintippen.</span>
          ) : mhd ? (
            <>Gewählt: {fmtDate(mhd)}</>
          ) : mhdText && !parsed ? (
            <span className="warn-text">Format: MMJJ (0326) oder TTMMJJ (150326)</span>
          ) : parsed ? (
            <>= {fmtDate(parsed)}</>
          ) : (
            <>Leer lassen = ohne MHD · Kamera-Knopf liest das Datum vom Foto</>
          )}
        </div>
        <div className="chips">
          {QUICK.map((q) => (
            <button key={q.label} type="button" className="chip" onClick={() => (setMhd(plus(q)), setMhdText(''), setOcr('idle'))}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Marke / Sorte (optional)</span>
        <input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="z. B. Rewe Beste Wahl, Kaufland K-Classic" list={`v-${article.id}`} />
        <datalist id={`v-${article.id}`}>{variants.map((v) => <option key={v} value={v} />)}</datalist>
        {variants.length > 0 && !req.variant && (
          <div className="chips">
            {variants.slice(0, 6).map((v) => (
              <button key={v} type="button" className={`chip ${variant === v ? 'on' : ''}`} onClick={() => setVariant(variant === v ? '' : v)}>{v}</button>
            ))}
          </div>
        )}
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
        {amount > 0 ? `${amount}× einlagern` : 'Einlagern'}
      </button>
    </div>
  )
}
