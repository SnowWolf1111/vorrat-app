import { useState } from 'react'
import { type Article } from '../db'
import { confidentMatch, matchArticles, type Data, type Match } from '../data'
import { assignBarcode, consume, lookupOff, offVariant, type OffProduct } from '../actions'
import { fmtAmount, vibrate } from '../format'
import { ArticlePicker } from './ArticlePicker'
import { Icon, Sheet, Stepper, Thumb, useToast } from './common'
import { Scanner } from './Scanner'
import { StockInSheet, type StockInRequest } from './StockIn'
import { articleImage } from '../data'

type Mode = 'in' | 'out'
type Unknown = { ean: string; off: OffProduct | null; loading: boolean; matches: Match[] }

export function ScanView({ data }: { data: Data }) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('in')
  const [outAmount, setOutAmount] = useState(1)
  const [stockIn, setStockIn] = useState<StockInRequest | null>(null)
  const [unknown, setUnknown] = useState<Unknown | null>(null)
  const [choose, setChoose] = useState(false)
  const [manual, setManual] = useState(false)
  const busy = !!stockIn || !!unknown || manual

  async function handleArticle(a: Article, ean?: string, variant?: string | null) {
    if (mode === 'in') return setStockIn({ article: a, ean: ean ?? null, variant: variant ?? null })
    const r = await consume(a, outAmount)
    if (r.taken) {
      vibrate()
      const rest = (data.stock.get(a.id)?.total ?? r.taken) - r.taken
      toast(<>−{fmtAmount(r.taken)} {a.name} · noch {fmtAmount(Math.max(0, rest))}</>, 'ok', { label: 'Rückgängig', run: r.undo })
    } else {
      vibrate(120)
      toast(<>{a.name} ist laut App nicht im Bestand</>, 'warn')
    }
  }

  async function onCode(ean: string) {
    if (busy) return
    vibrate()
    const hit = data.barcodeByEan.get(ean)
    const a = hit && data.articleById.get(hit.article_id)
    if (a) return handleArticle(a, ean)
    setChoose(false)
    setUnknown({ ean, off: null, loading: true, matches: [] })
    const off = await lookupOff(ean)
    const matches = matchArticles(off, data)
    setUnknown((u) => (u && u.ean === ean ? { ...u, off, loading: false, matches } : u))
  }

  async function assign(a: Article) {
    if (!unknown) return
    const { ean, off } = unknown
    await assignBarcode(ean, a.id, off ? { off_name: off.name, off_brand: off.brand, off_quantity: off.quantity, off_image_url: off.image } : undefined)
    setUnknown(null)
    toast(<>Gemerkt: {off?.brand ? `${off.brand} → ` : ''}{a.name}</>, 'ok')
    handleArticle(a, ean, offVariant(off))
  }

  const sure = unknown && !unknown.loading ? confidentMatch(unknown.matches) : null

  return (
    <div className="scan-view">
      <div className="seg big mode">
        <button className={mode === 'in' ? 'on in' : ''} onClick={() => setMode('in')}>
          <Icon.plus /> Einlagern
        </button>
        <button className={mode === 'out' ? 'on out' : ''} onClick={() => setMode('out')}>
          <Icon.minus /> Verbrauchen
        </button>
      </div>

      <Scanner onCode={onCode} paused={busy} />

      {mode === 'out' ? (
        <div className="field inline">
          <span className="field-label">Pro Scan abziehen</span>
          <Stepper value={outAmount} onChange={(v) => setOutAmount(Math.max(0.5, v))} min={0.5} />
        </div>
      ) : (
        <p className="muted center small">Barcode scannen → Menge, MHD (auch per Foto) und Lagerort wählen.</p>
      )}
      <button className="secondary" onClick={() => setManual(true)}>
        <Icon.search /> Ohne Barcode: Artikel suchen
      </button>

      <Sheet open={manual} onClose={() => setManual(false)} title={mode === 'in' ? 'Was lagerst du ein?' : 'Was hast du verbraucht?'} tall>
        <ArticlePicker
          data={data}
          onPick={(a) => {
            setManual(false)
            handleArticle(a)
          }}
        />
      </Sheet>

      <Sheet open={!!unknown} onClose={() => setUnknown(null)} title="Neuer Barcode" tall>
        {unknown && (
          <>
            <div className="off-card">
              {unknown.off?.image && <img src={unknown.off.image} alt="" />}
              <div>
                {unknown.loading ? (
                  <span className="muted">Suche das Produkt …</span>
                ) : unknown.off ? (
                  <>
                    <b>{unknown.off.name ?? 'Unbenanntes Produkt'}</b>
                    <div className="muted small">{[unknown.off.brand, unknown.off.quantity].filter(Boolean).join(' · ')}</div>
                  </>
                ) : (
                  <span className="muted">Produkt in der Datenbank nicht gefunden</span>
                )}
                <div className="muted small mono">{unknown.ean}</div>
              </div>
            </div>

            {sure && !choose ? (
              <div className="match-card">
                <span className="muted small">Gehört wahrscheinlich zu</span>
                <div className="match-main">
                  <Thumb src={articleImage(sure.article, data)} name={sure.article.name} size={48} />
                  <b>{sure.article.name}</b>
                </div>
                <p className="small muted">Marke und Sorte merkt sich die App. Im Vorrat steht es dann unter „{sure.article.name}“, im Detail siehst du welche Marke mit welchem MHD.</p>
                <button className="primary" onClick={() => assign(sure.article)}>
                  <Icon.check /> Ja, passt
                </button>
                <button className="secondary" onClick={() => setChoose(true)}>Anderer Artikel / neu anlegen</button>
              </div>
            ) : (
              !unknown.loading && (
                <>
                  <p className="small">Zu welchem Artikel gehört das? Ab dann wird es automatisch erkannt, auch andere Marken landen unter demselben Artikel.</p>
                  <ArticlePicker
                    key={unknown.ean}
                    data={data}
                    onPick={assign}
                    suggestions={unknown.matches.map((m) => m.article)}
                    suggestFrom={unknown.off?.generic ?? unknown.off?.name ?? null}
                    newImage={unknown.off?.image ?? null}
                  />
                </>
              )
            )}
          </>
        )}
      </Sheet>

      <StockInSheet req={stockIn} data={data} onClose={() => setStockIn(null)} />
    </div>
  )
}
