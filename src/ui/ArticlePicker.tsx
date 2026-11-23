import { useState } from 'react'
import type { Article, Source } from '../db'
import { SOURCES } from '../db'
import { searchArticles, type Data } from '../data'
import { createArticle } from '../actions'
import { fmtAmount } from '../format'
import { Icon, useToast } from './common'

/** Artikelsuche mit Option "Neuen Artikel anlegen". */
export function ArticlePicker({ data, onPick, initialQuery = '', suggestFrom }: { data: Data; onPick: (a: Article) => void; initialQuery?: string; suggestFrom?: string | null }) {
  const [q, setQ] = useState(initialQuery)
  const [creating, setCreating] = useState(false)
  const list = q ? searchArticles(data.articles, q) : suggestFrom ? searchArticles(data.articles, suggestFrom) : data.articles
  const shown = (list.length ? list : data.articles).slice(0, 60)

  if (creating) return <NewArticle data={data} name={q || suggestFrom || ''} onCreated={onPick} onCancel={() => setCreating(false)} />

  return (
    <div className="picker">
      <div className="search">
        <Icon.search />
        <input autoFocus placeholder="Artikel suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!q && suggestFrom && list.length > 0 && <div className="hint">Passende Vorschläge zu „{suggestFrom}“</div>}
      <ul className="rows">
        {shown.map((a) => {
          const s = data.stock.get(a.id)
          return (
            <li key={a.id}>
              <button className="row" onClick={() => onPick(a)}>
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
      <button className="secondary" onClick={() => setCreating(true)}>
        <Icon.plus /> Neuen Artikel anlegen{q ? `: „${q}“` : ''}
      </button>
    </div>
  )
}

function NewArticle({ data, name: initial, onCreated, onCancel }: { data: Data; name: string; onCreated: (a: Article) => void; onCancel: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(initial)
  const [loc, setLoc] = useState<number>(data.locations.find((l) => l.name === 'Vorratsschrank')?.id ?? data.locations[0]?.id)
  const [source, setSource] = useState<Source>('Rewe')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const a = await createArticle({ name: name.trim(), default_location_id: loc, source, unit: null, category: null })
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
        <span className="field-label">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Kidneybohnen" />
      </label>
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
      <div className="btn-row">
        <button className="secondary" onClick={onCancel}>Zurück</button>
        <button className="primary" onClick={save} disabled={busy || name.trim().length < 2}>{busy ? 'Lege an …' : 'Anlegen'}</button>
      </div>
    </div>
  )
}
