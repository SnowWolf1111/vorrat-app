import { useState } from 'react'
import { SOURCES, type Article, type Source } from '../db'
import { amazonMarkup, type Data } from '../data'
import { addShopping, consume, updateArticle } from '../actions'
import { fmtAmount, fmtEur, mhdLabel, mhdState, vibrate } from '../format'
import { Icon, Sheet, Stepper, useToast } from './common'

export function ArticleSheet({ articleId, data, onClose, onStockIn }: { articleId: number | null; data: Data; onClose: () => void; onStockIn: (a: Article) => void }) {
  const article = articleId != null ? data.articleById.get(articleId) : undefined
  return (
    <Sheet open={!!article} onClose={onClose} title={article?.name ?? ''} tall>
      {article && <Detail key={article.id} article={article} data={data} onStockIn={onStockIn} />}
    </Sheet>
  )
}

function Detail({ article: a, data, onStockIn }: { article: Article; data: Data; onStockIn: (a: Article) => void }) {
  const toast = useToast()
  const s = data.stock.get(a.id)
  const total = s?.total ?? 0
  const [edit, setEdit] = useState(false)
  const onList = data.shopping.some((x) => x.article_id === a.id && x.status === 'open')
  const markup = amazonMarkup(a)

  async function minus(locationId: number | null = null) {
    const taken = await consume(a, 1, locationId)
    if (taken) {
      vibrate()
      toast(`−1 ${a.name}`, 'ok')
    }
  }

  return (
    <div className="detail">
      <div className="detail-top">
        <div>
          <div className={`big-number ${s?.belowMin ? 'low' : ''}`}>{fmtAmount(total)}</div>
          <div className="muted small">
            {a.unit ?? 'Stück'} · Mindestbestand {fmtAmount(a.min_stock)}
            {s?.belowMin && <span className="pill low">zu wenig</span>}
          </div>
        </div>
        <div className="detail-actions">
          <button className="round" onClick={() => minus()} disabled={!total} aria-label="Einen verbrauchen"><Icon.minus /></button>
          <button className="round accent" onClick={() => onStockIn(a)} aria-label="Einlagern"><Icon.plus /></button>
        </div>
      </div>

      {s && s.entries.length > 0 ? (
        <ul className="entries">
          {s.entries.map((e) => (
            <li key={e.id}>
              <span className={`mhd-dot ${mhdState(e.best_before)}`} />
              <span className="entry-main">
                <b>{fmtAmount(e.amount)}×</b> {data.locationById.get(e.location_id)?.name}
                <span className="muted small"> · {mhdLabel(e.best_before)}</span>
              </span>
              <button className="icon-btn" onClick={() => minus(e.location_id)} aria-label="Einen aus diesem Lagerort verbrauchen"><Icon.minus /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nichts im Bestand.</p>
      )}

      <button
        className="secondary"
        disabled={onList}
        onClick={async () => {
          await addShopping({ article: a })
          toast(`${a.name} steht auf der Einkaufsliste`, 'ok')
        }}
      >
        <Icon.cart /> {onList ? 'Steht schon auf der Einkaufsliste' : `Auf die Einkaufsliste (${fmtAmount(a.reorder_qty)})`}
      </button>

      <div className="info-grid">
        <div><span>Kauf bei</span><b>{a.source ?? '—'}</b></div>
        <div><span>Rewe</span><b>{a.rewe_price != null ? fmtEur(a.rewe_price) : '—'}</b></div>
        <div>
          <span>Amazon</span>
          <b>
            {a.amazon_price != null ? fmtEur(a.amazon_price) : '—'}
            {markup != null && <em className={markup <= 30 ? 'ok-text' : 'warn-text'}> {markup > 0 ? '+' : ''}{markup} %</em>}
          </b>
        </div>
      </div>
      {(a.rewe_product || a.amazon_product || a.note) && (
        <div className="notes muted small">
          {a.rewe_product && <div>Rewe: {a.rewe_product}</div>}
          {a.amazon_product && <div>Amazon: {a.amazon_product}</div>}
          {a.note && <div>{a.note}</div>}
        </div>
      )}

      <button className="link-row" onClick={() => setEdit(!edit)}>
        Einstellungen <span className={`chev ${edit ? 'open' : ''}`}><Icon.chevron /></span>
      </button>
      {edit && <Settings article={a} data={data} />}
    </div>
  )
}

function Settings({ article: a, data }: { article: Article; data: Data }) {
  const [asin, setAsin] = useState(a.amazon_asin ?? '')
  const set = (patch: Partial<Article>) => updateArticle(a.id, patch)
  return (
    <div className="form compact">
      <div className="field inline">
        <span className="field-label">Mindestbestand</span>
        <Stepper value={a.min_stock} onChange={(v) => set({ min_stock: v })} />
      </div>
      <div className="field inline">
        <span className="field-label">Nachkauf-Menge</span>
        <Stepper value={a.reorder_qty} min={1} onChange={(v) => set({ reorder_qty: Math.max(1, v) })} />
      </div>
      <div className="field">
        <span className="field-label">Kauf bei</span>
        <div className="seg">
          {SOURCES.map((s: Source) => (
            <button key={s} className={a.source === s ? 'on' : ''} onClick={() => set({ source: s })}>{s}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Standard-Lagerort</span>
        <div className="seg">
          {data.locations.map((l) => (
            <button key={l.id} className={a.default_location_id === l.id ? 'on' : ''} onClick={() => set({ default_location_id: l.id })}>{l.name}</button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="field-label">Amazon-ASIN (für den Warenkorb-Knopf)</span>
        <input
          value={asin}
          placeholder="z. B. B07XYZ1234"
          onChange={(e) => setAsin(e.target.value.toUpperCase().trim())}
          onBlur={() => asin !== (a.amazon_asin ?? '') && set({ amazon_asin: asin || null })}
        />
      </label>
    </div>
  )
}
