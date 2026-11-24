import { useState } from 'react'
import { SOURCES, type Article, type Source, type StockEntry } from '../db'
import { amazonMarkup, articleImage, entryImage, entryVariant, type Data } from '../data'
import { addShopping, consume, consumeEntry, deleteShopping, markRunningLow, removeBarcode, updateArticle, updateEntry } from '../actions'
import { fmtAmount, fmtDate, fmtEur, mhdLabel, mhdState, parseMhd, vibrate } from '../format'
import { Icon, Sheet, Stepper, Thumb, useToast } from './common'
import { categories } from './ArticlePicker'
import { amazonSearchUrl, extractAsin, reweSearchUrl } from '../shops'

export function ArticleSheet({ articleId, data, onClose, onStockIn }: { articleId: number | null; data: Data; onClose: () => void; onStockIn: (a: Article) => void }) {
  const article = articleId != null ? data.articleById.get(articleId) : undefined
  return (
    <Sheet open={!!article} onClose={onClose} title={article?.name ?? ''} tall>
      {article && <Detail key={article.id} article={article} data={data} onStockIn={onStockIn} onClose={onClose} />}
    </Sheet>
  )
}

function Detail({ article: a, data, onStockIn, onClose }: { article: Article; data: Data; onStockIn: (a: Article) => void; onClose: () => void }) {
  const toast = useToast()
  const s = data.stock.get(a.id)
  const total = s?.total ?? 0
  const [edit, setEdit] = useState(false)
  const [editEntry, setEditEntry] = useState<StockEntry | null>(null)
  const onList = data.shopping.find((x) => x.article_id === a.id && x.status === 'open')
  const markup = amazonMarkup(a)

  // Packungen nach Marke/Sorte gruppieren
  const groups = new Map<string, StockEntry[]>()
  for (const e of s?.entries ?? []) {
    const v = entryVariant(e, data) ?? ''
    groups.set(v, [...(groups.get(v) ?? []), e])
  }
  const multi = groups.size > 1 || (groups.size === 1 && !groups.has(''))

  async function minus(entry?: StockEntry) {
    const r = entry ? await consumeEntry(a, entry, 1) : await consume(a, 1)
    if (r.taken) {
      vibrate()
      toast(`−1 ${a.name}`, 'ok', { label: 'Rückgängig', run: r.undo })
    }
  }

  return (
    <div className="detail">
      <div className="detail-top">
        <Thumb src={articleImage(a, data)} name={a.name} size={72} />
        <div className="grow">
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
        [...groups.entries()].map(([variant, entries]) => (
          <div key={variant} className="variant-group">
            {multi && (
              <div className="variant-head">
                {entryImage(entries[0], data) && <Thumb src={entryImage(entries[0], data)} name={variant || '?'} size={28} />}
                <b>{variant || 'Ohne Marke'}</b>
                <span className="muted small">{fmtAmount(entries.reduce((n, e) => n + e.amount, 0))} Stk</span>
              </div>
            )}
            <ul className="entries">
              {entries.map((e) => (
                <li key={e.id}>
                  <button className="entry-main" onClick={() => setEditEntry(e)}>
                    <span className={`mhd-dot ${mhdState(e.best_before)}`} />
                    <span>
                      <b>{fmtAmount(e.amount)}×</b> {data.locationById.get(e.location_id)?.name}
                      <span className="muted small"> · {mhdLabel(e.best_before)}</span>
                    </span>
                    <span className="edit-hint"><Icon.edit /></span>
                  </button>
                  <button className="icon-btn" onClick={() => minus(e)} aria-label="Einen aus dieser Packung verbrauchen"><Icon.minus /></button>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p className="muted">Nichts im Bestand.</p>
      )}
      {s && s.entries.length > 0 && <p className="hint">Eintrag antippen = Menge, MHD, Ort oder Marke ändern.</p>}

      {onList ? (
        onList.origin === 'bald_leer' && !onList.carted_at ? (
          <div className="low-note">
            <span><b>Bald leer</b> – steht zum Nachkaufen auf der Liste. Wird beim nächsten Einlagern automatisch abgehakt.</span>
            <button className="link" onClick={() => (deleteShopping(onList), toast('Zurückgenommen', 'ok'))}>Zurücknehmen</button>
          </div>
        ) : (
          <button className="secondary" disabled>
            <Icon.cart /> {onList.carted_at ? 'Liegt schon im Warenkorb' : 'Steht schon auf der Einkaufsliste'}
          </button>
        )
      ) : (
        <div className="btn-row">
          {total > 0 && (
            <button
              className="secondary low-btn"
              onClick={async () => {
                await markRunningLow(a)
                vibrate()
                toast(`${a.name}: bald leer – steht auf der Einkaufsliste`, 'ok')
              }}
            >
              <Icon.clock /> Bald leer
            </button>
          )}
          <button
            className="secondary"
            onClick={async () => {
              await addShopping({ article: a })
              toast(`${a.name} steht auf der Einkaufsliste`, 'ok')
            }}
          >
            <Icon.cart /> Auf die Liste ({fmtAmount(a.reorder_qty)})
          </button>
        </div>
      )}

      <div className="info-grid">
        <div><span>Kauf bei</span><b>{a.source ?? '—'}</b></div>
        <a href={reweSearchUrl(a)} target="_blank" rel="noreferrer"><span>Rewe ↗</span><b>{a.rewe_price != null ? fmtEur(a.rewe_price) : 'suchen'}</b></a>
        <a href={a.amazon_asin ? `https://www.amazon.de/dp/${a.amazon_asin}` : amazonSearchUrl(a)} target="_blank" rel="noreferrer">
          <span>Amazon ↗</span>
          <b>
            {a.amazon_price != null ? fmtEur(a.amazon_price) : 'suchen'}
            {markup != null && <em className={markup <= 30 ? 'ok-text' : 'warn-text'}> {markup > 0 ? '+' : ''}{markup} %</em>}
          </b>
        </a>
      </div>
      {(a.rewe_product || a.amazon_product || a.note) && (
        <div className="notes muted small">
          {a.rewe_product && <div>Rewe: {a.rewe_product}</div>}
          {a.amazon_product && <div>Amazon: {a.amazon_product}</div>}
          {a.note && <div>{a.note}</div>}
        </div>
      )}

      <button className="link-row" onClick={() => setEdit(!edit)}>
        <span><Icon.edit /> Bearbeiten</span> <span className={`chev ${edit ? 'open' : ''}`}><Icon.chevron /></span>
      </button>
      {edit && <Settings article={a} data={data} onDeleted={onClose} />}

      <EntrySheet article={a} entry={editEntry} data={data} onClose={() => setEditEntry(null)} />
    </div>
  )
}

function EntrySheet({ article, entry, data, onClose }: { article: Article; entry: StockEntry | null; data: Data; onClose: () => void }) {
  return (
    <Sheet open={!!entry} onClose={onClose} title="Packung bearbeiten">
      {entry && <EntryForm key={entry.id} article={article} entry={entry} data={data} onDone={onClose} />}
    </Sheet>
  )
}

function EntryForm({ article, entry, data, onDone }: { article: Article; entry: StockEntry; data: Data; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState(entry.amount)
  const [mhdText, setMhdText] = useState(entry.best_before ? fmtDate(entry.best_before) : '')
  const [loc, setLoc] = useState(entry.location_id)
  const [variant, setVariant] = useState(entry.variant ?? entryVariant(entry, data) ?? '')
  const mhd = mhdText.trim() ? parseMhd(mhdText) : null
  const bad = !!mhdText.trim() && !mhd

  async function save() {
    await updateEntry(article, entry, { amount, best_before: mhd, location_id: loc, variant: variant.trim() || null })
    toast(amount <= 0 ? 'Packung entfernt' : 'Gespeichert', 'ok')
    onDone()
  }

  return (
    <div className="form">
      <div className="field inline">
        <span className="field-label">Menge</span>
        <Stepper value={amount} onChange={setAmount} min={0} />
      </div>
      <label className="field">
        <span className="field-label">MHD (TT.MM.JJ, leer = ohne)</span>
        <input inputMode="numeric" value={mhdText} onChange={(e) => setMhdText(e.target.value)} />
        {bad && <span className="hint warn-text">Datum nicht erkannt</span>}
      </label>
      <label className="field">
        <span className="field-label">Marke / Sorte</span>
        <input value={variant} onChange={(e) => setVariant(e.target.value)} />
      </label>
      <div className="field">
        <span className="field-label">Lagerort (umräumen)</span>
        <div className="seg">
          {data.locations.map((l) => (
            <button key={l.id} type="button" className={l.id === loc ? 'on' : ''} onClick={() => setLoc(l.id)}>{l.name}</button>
          ))}
        </div>
      </div>
      <div className="btn-row">
        <button className="secondary danger" onClick={async () => { await updateEntry(article, entry, { amount: 0 }); toast('Packung entfernt', 'ok'); onDone() }}>
          <Icon.trash /> Entfernen
        </button>
        <button className="primary" onClick={save} disabled={bad}>Speichern</button>
      </div>
    </div>
  )
}

function Settings({ article: a, data, onDeleted }: { article: Article; data: Data; onDeleted: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({
    name: a.name,
    unit: a.unit ?? '',
    category: a.category ?? '',
    asin: a.amazon_asin ?? '',
    amazon_product: a.amazon_product ?? '',
    rewe_product: a.rewe_product ?? '',
    amazon_price: a.amazon_price != null ? String(a.amazon_price).replace('.', ',') : '',
    rewe_price: a.rewe_price != null ? String(a.rewe_price).replace('.', ',') : '',
    note: a.note ?? '',
    aliases: (a.aliases ?? []).join(', '),
  })
  const set = (patch: Partial<Article>) => updateArticle(a.id, patch)
  const txt = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) })
  const price = (s: string) => (s.trim() ? Number(s.replace(',', '.')) || null : null)
  const barcodes = data.barcodes.filter((b) => b.article_id === a.id)

  function commit() {
    const asin = extractAsin(f.asin) ?? (f.asin.trim() ? f.asin.trim().toUpperCase() : null)
    const patch: Partial<Article> = {
      name: f.name.trim() || a.name,
      unit: f.unit.trim() || null,
      category: f.category.trim() || null,
      amazon_asin: asin,
      amazon_product: f.amazon_product.trim() || null,
      rewe_product: f.rewe_product.trim() || null,
      amazon_price: price(f.amazon_price),
      rewe_price: price(f.rewe_price),
      note: f.note.trim() || null,
      aliases: f.aliases.split(',').map((x) => x.trim()).filter(Boolean),
    }
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(a[k as keyof Article] ?? null)))
    if (Object.keys(changed).length) {
      set(changed)
      if (asin !== f.asin) setF({ ...f, asin: asin ?? '' })
      toast('Gespeichert', 'ok')
    }
  }

  return (
    <div className="form compact" onBlur={commit}>
      <label className="field">
        <span className="field-label">Name</span>
        <input {...txt('name')} />
      </label>
      <div className="two-col">
        <label className="field"><span className="field-label">Einheit</span><input {...txt('unit')} /></label>
        <label className="field">
          <span className="field-label">Kategorie</span>
          <input {...txt('category')} list="cats-edit" />
          <datalist id="cats-edit">{categories(data).map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      </div>
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
        <span className="field-label">Amazon: ASIN oder Produkt-Link einfügen</span>
        <input {...txt('asin')} placeholder="B07XYZ1234 oder https://amazon.de/…/dp/…" />
        <span className="hint">
          <a href={amazonSearchUrl(a)} target="_blank" rel="noreferrer">Bei Amazon suchen</a> → Produkt öffnen → Link aus der Adresszeile kopieren → hier einfügen.
          (Kurz-Links „amzn.eu/…“ enthalten die ASIN leider nicht.)
        </span>
      </label>
      <div className="two-col">
        <label className="field"><span className="field-label">Preis Amazon €</span><input inputMode="decimal" {...txt('amazon_price')} /></label>
        <label className="field"><span className="field-label">Preis Rewe €</span><input inputMode="decimal" {...txt('rewe_price')} /></label>
      </div>
      <label className="field"><span className="field-label">Rewe-Produkt (für die Suche)</span><input {...txt('rewe_product')} /></label>
      <label className="field"><span className="field-label">Amazon-Produkt (für die Suche)</span><input {...txt('amazon_product')} /></label>
      <label className="field">
        <span className="field-label">Andere Namen (für Sprachbefehle, mit Komma)</span>
        <input {...txt('aliases')} placeholder="z. B. Nuggets, Chicken" />
      </label>
      <label className="field"><span className="field-label">Notiz</span><input {...txt('note')} /></label>

      <div className="field">
        <span className="field-label">Bild</span>
        <div className="chips">
          {['🍗', '🍟', '🍝', '🥩', '🧀', '🥛', '🥚', '🥫', '🧂', '🌶️', '🧅', '🥬', '🍕', '🌭', '🍚', '🥤', '🍫', '🧊', '🛒'].map((e) => (
            <button key={e} className={`chip emoji-chip ${a.image_url === 'emoji:' + e ? 'on' : ''}`} onClick={() => set({ image_url: 'emoji:' + e })}>{e}</button>
          ))}
        </div>
        {a.image_url && (
          <button className="link" onClick={() => set({ image_url: null })}>Automatisch (Produktfoto vom Barcode bzw. passendes Symbol)</button>
        )}
      </div>

      {barcodes.length > 0 && (
        <div className="field">
          <span className="field-label">Bekannte Barcodes ({barcodes.length})</span>
          <ul className="entries">
            {barcodes.map((b) => (
              <li key={b.ean}>
                <Thumb src={b.off_image_url} name={b.off_brand ?? '#'} size={28} />
                <span className="entry-main static">
                  {[b.off_brand, b.off_name].filter(Boolean).join(' – ') || 'Unbekannt'}
                  <span className="muted small mono"> {b.ean}</span>
                </span>
                <button className="icon-btn" aria-label="Barcode entfernen" onClick={() => removeBarcode(b.ean)}><Icon.trash /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        className="secondary danger"
        onClick={() => {
          if (!confirm(`„${a.name}“ aus dem Katalog löschen? Bestand und Rezepte damit werden ausgeblendet.`)) return
          set({ active: false })
          toast(`${a.name} gelöscht`, 'ok')
          onDeleted()
        }}
      >
        <Icon.trash /> Artikel löschen
      </button>
    </div>
  )
}
