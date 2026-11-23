import { useState } from 'react'
import type { Article, Source } from '../db'
import { SOURCES } from '../db'
import { articleImage, searchArticles, type Data } from '../data'
import { createArticle } from '../actions'
import { fmtAmount } from '../format'
import { Icon, Stepper, Thumb, useToast } from './common'

/** Artikelsuche mit Option "Neuen Artikel anlegen". */
export function ArticlePicker({
  data,
  onPick,
  initialQuery = '',
  suggestFrom,
  suggestions,
  newImage,
}: {
  data: Data
  onPick: (a: Article) => void
  initialQuery?: string
  suggestFrom?: string | null
  suggestions?: Article[]
  newImage?: string | null
}) {
  const [q, setQ] = useState(initialQuery)
  const [creating, setCreating] = useState(false)
  const top = !q && suggestions?.length ? suggestions : []
  const list = q ? searchArticles(data.articles, q) : data.articles
  const shown = [...top, ...list.filter((a) => !top.includes(a))].slice(0, 80)

  if (creating) return <NewArticle data={data} name={q || suggestFrom || ''} image={newImage ?? null} onCreated={onPick} onCancel={() => setCreating(false)} />

  return (
    <div className="picker">
      <div className="search">
        <Icon.search />
        <input placeholder="Artikel suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <button className="secondary" onClick={() => setCreating(true)}>
        <Icon.plus /> Neuen Artikel anlegen{q ? `: „${q}“` : suggestFrom ? `: „${suggestFrom}“` : ''}
      </button>
      {top.length > 0 && <div className="hint">Passende Vorschläge oben</div>}
      <ul className="rows">
        {shown.map((a, i) => {
          const s = data.stock.get(a.id)
          return (
            <li key={a.id} className={i < top.length ? 'suggested' : ''}>
              <button className="row" onClick={() => onPick(a)}>
                <Thumb src={articleImage(a, data)} name={a.name} size={36} />
                <span className="row-main">
                  <span className="row-title">{a.name}</span>
                  <span className="row-sub">{data.locationById.get(a.default_location_id ?? -1)?.name ?? '—'}</span>
                </span>
                <span className="row-amount">{fmtAmount(s?.total ?? 0)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function categories(data: Data) {
  return [...new Set(data.articles.map((a) => a.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'de'))
}

function NewArticle({ data, name: initial, image, onCreated, onCancel }: { data: Data; name: string; image: string | null; onCreated: (a: Article) => void; onCancel: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(initial)
  const [loc, setLoc] = useState<number>(data.locations.find((l) => l.name === 'Vorratsschrank')?.id ?? data.locations[0]?.id)
  const [source, setSource] = useState<Source>('Rewe')
  const [unit, setUnit] = useState('')
  const [category, setCategory] = useState('')
  const [min, setMin] = useState(0)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const a = await createArticle({
        name: name.trim(),
        default_location_id: loc,
        source,
        unit: unit.trim() || null,
        category: category.trim() || null,
        min_stock: min,
        // Produktfoto kommt automatisch über den Barcode; ohne Barcode ein KI-Bild
        image_url: image ? null : undefined,
      })
      toast(`„${a.name}“ angelegt`, 'ok')
      onCreated(a)
    } catch (e) {
      toast((e as Error).message, 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form">
      <label className="field">
        <span className="field-label">Name (allgemein, ohne Marke – z. B. „Chicken Nuggets“)</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Kidneybohnen" />
      </label>
      <div className="two-col">
        <label className="field">
          <span className="field-label">Einheit</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Packung, Dose …" />
        </label>
        <label className="field">
          <span className="field-label">Kategorie</span>
          <input value={category} onChange={(e) => setCategory(e.target.value)} list="cats" placeholder="z. B. TK" />
          <datalist id="cats">{categories(data).map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      </div>
      <div className="field">
        <span className="field-label">Lagerort</span>
        <div className="seg">
          {data.locations.map((l) => (
            <button key={l.id} type="button" className={l.id === loc ? 'on' : ''} onClick={() => setLoc(l.id)}>{l.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Kauf bei</span>
        <div className="seg">
          {SOURCES.map((s) => (
            <button key={s} type="button" className={s === source ? 'on' : ''} onClick={() => setSource(s)}>{s}</button>
          ))}
        </div>
      </div>
      <div className="field inline">
        <span className="field-label">Mindestbestand</span>
        <Stepper value={min} onChange={setMin} />
      </div>
      <div className="btn-row">
        <button className="secondary" onClick={onCancel}>Zurück</button>
        <button className="primary" onClick={save} disabled={busy || name.trim().length < 2}>{busy ? 'Lege an …' : 'Anlegen'}</button>
      </div>
    </div>
  )
}
