import { useState } from 'react'
import { db, type Article } from '../db'
import type { Data } from '../data'
import { assignBarcode, consume, lookupOff, type OffProduct } from '../actions'
import { fmtAmount, vibrate } from '../format'
import { ArticlePicker } from './ArticlePicker'
import { Icon, Sheet, useToast } from './common'
import { Scanner } from './Scanner'
import { StockInSheet } from './StockIn'

type Mode = 'in' | 'out'
type Unknown = { ean: string; off: OffProduct | null; loading: boolean }

export function ScanView({ data }: { data: Data }) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('in')
  const [stockIn, setStockIn] = useState<Article | null>(null)
  const [unknown, setUnknown] = useState<Unknown | null>(null)
  const [manual, setManual] = useState(false)
  const busy = !!stockIn || !!unknown || manual

  async function handleArticle(a: Article) {
    if (mode === 'in') return setStockIn(a)
    const taken = await consume(a, 1)
    if (taken) {
      vibrate()
      const rest = (data.stock.get(a.id)?.total ?? 1) - taken
      toast(<>−1 {a.name} · noch {fmtAmount(Math.max(0, rest))}</>, 'ok')
    } else {
      vibrate(120)
      toast(<>{a.name} ist laut App nicht im Bestand</>, 'warn')
    }
  }

  async function onCode(ean: string) {
    if (busy) return
    vibrate()
    const hit = await db.barcodes.get(ean)
    const a = hit && data.articleById.get(hit.article_id)
    if (a) return handleArticle(a)
    setUnknown({ ean, off: null, loading: true })
    const off = await lookupOff(ean)
    setUnknown((u) => (u && u.ean === ean ? { ...u, off, loading: false } : u))
  }

  async function assign(a: Article) {
    if (!unknown) return
    const { ean, off } = unknown
    await assignBarcode(ean, a.id, off ? { off_name: off.name, off_brand: off.brand, off_quantity: off.quantity, off_image_url: off.image } : undefined)
    setUnknown(null)
    toast(<>Barcode gemerkt für {a.name}</>, 'ok')
    handleArticle(a)
  }

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

      <p className="muted center small">
        {mode === 'in' ? 'Barcode scannen → Menge und MHD eingeben.' : 'Jeder Scan zieht 1 ab, älteste Packung zuerst.'}
      </p>
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
                  <span className="muted">Suche bei Open Food Facts …</span>
                ) : unknown.off ? (
                  <>
                    <b>{unknown.off.name ?? 'Unbenanntes Produkt'}</b>
                    <div className="muted small">{[unknown.off.brand, unknown.off.quantity].filter(Boolean).join(' · ')}</div>
                  </>
                ) : (
                  <span className="muted">Produkt unbekannt</span>
                )}
                <div className="muted small mono">{unknown.ean}</div>
              </div>
            </div>
            <p className="small">Zu welchem Artikel gehört das? Ab dann wird er automatisch erkannt.</p>
            <ArticlePicker key={unknown.ean + String(unknown.loading)} data={data} onPick={assign} suggestFrom={unknown.off?.name ?? null} />
          </>
        )}
      </Sheet>

      <StockInSheet article={stockIn} data={data} onClose={() => setStockIn(null)} />
    </div>
  )
}
