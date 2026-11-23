import { useMemo, useState } from 'react'
import type { Article } from '../db'
import { articleImage, entryVariant, searchArticles, type ArticleStock, type Data } from '../data'
import { fmtAmount, mhdLabel, mhdState } from '../format'
import { Empty, Icon, Thumb } from './common'

type Filter = 'all' | 'low' | 'expiring'
type Sort = 'ort' | 'kategorie' | 'name' | 'mhd' | 'bestand'
type View = 'list' | 'grid'
type Prefs = { sort: Sort; view: View; onlyStock: boolean }

const SORTS: { id: Sort; label: string }[] = [
  { id: 'ort', label: 'Lagerort' },
  { id: 'kategorie', label: 'Kategorie' },
  { id: 'name', label: 'A–Z' },
  { id: 'mhd', label: 'MHD' },
  { id: 'bestand', label: 'Bestand' },
]

function loadPrefs(): Prefs {
  try {
    return { sort: 'ort', view: 'list', onlyStock: false, ...JSON.parse(localStorage.getItem('stock-prefs') ?? '{}') }
  } catch {
    return { sort: 'ort', view: 'list', onlyStock: false }
  }
}

type RowT = { s: ArticleStock; amount: number }
type Group = { id: string; name: string; frozen?: boolean; rows: RowT[] }

export function StockView({ data, onOpen }: { data: Data; onOpen: (a: Article) => void }) {
  const [q, setQ] = useState('')
  const [loc, setLoc] = useState<number | 'all'>('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [showOpts, setShowOpts] = useState(false)
  const setPrefs = (p: Partial<Prefs>) => {
    const n = { ...prefs, ...p }
    setPrefsState(n)
    try {
      localStorage.setItem('stock-prefs', JSON.stringify(n))
    } catch {
      /* egal */
    }
  }

  const all = [...data.stock.values()]
  const lowCount = all.filter((s) => s.belowMin).length
  const expiring = all.filter((s) => ['expired', 'soon'].includes(mhdState(s.nextBestBefore))).length
  const totalItems = all.reduce((n, s) => n + (s.total > 0 ? 1 : 0), 0)
  const openShop = new Map(data.shopping.filter((x) => x.status === 'open' && x.article_id != null).map((x) => [x.article_id!, x]))

  const groups = useMemo<Group[]>(() => {
    let list = q ? searchArticles(data.articles, q) : data.articles
    if (filter === 'low') list = list.filter((a) => data.stock.get(a.id)?.belowMin)
    if (filter === 'expiring') list = list.filter((a) => ['expired', 'soon'].includes(mhdState(data.stock.get(a.id)?.nextBestBefore ?? null)))
    let rows: RowT[] = list.map((a) => {
      const s = data.stock.get(a.id)!
      return { s, amount: loc === 'all' ? s.total : s.byLocation.get(loc) ?? 0 }
    })
    if (loc !== 'all') rows = rows.filter((r) => r.amount > 0 || r.s.article.default_location_id === loc)
    if (prefs.onlyStock) rows = rows.filter((r) => r.amount > 0)

    const byName = (a: RowT, b: RowT) => a.s.article.name.localeCompare(b.s.article.name, 'de')
    switch (prefs.sort) {
      case 'ort': {
        const res: Group[] = data.locations
          .map((l) => ({ id: 'l' + l.id, name: l.name, frozen: l.is_frozen, rows: rows.filter((r) => (r.s.article.default_location_id ?? -1) === l.id || (loc === l.id && r.amount > 0)) }))
          .filter((g) => (loc === 'all' || g.id === 'l' + loc) && g.rows.length)
        const known = new Set(data.locations.map((l) => l.id))
        const rest = rows.filter((r) => !known.has(r.s.article.default_location_id ?? -1))
        if (rest.length && loc === 'all') res.push({ id: 'none', name: 'Ohne Lagerort', rows: rest })
        return res
      }
      case 'kategorie': {
        const m = new Map<string, RowT[]>()
        for (const r of rows) {
          const c = r.s.article.category ?? 'Ohne Kategorie'
          m.set(c, [...(m.get(c) ?? []), r])
        }
        return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'de')).map(([c, rs]) => ({ id: c, name: c, rows: rs }))
      }
      case 'name':
        return [{ id: 'all', name: '', rows: rows.sort(byName) }]
      case 'mhd':
        return [{ id: 'all', name: '', rows: rows.sort((a, b) => (a.s.nextBestBefore ?? '9999').localeCompare(b.s.nextBestBefore ?? '9999') || byName(a, b)) }]
      case 'bestand':
        return [{ id: 'all', name: '', rows: rows.sort((a, b) => a.amount - a.s.article.min_stock - (b.amount - b.s.article.min_stock) || byName(a, b)) }]
    }
  }, [data, q, loc, filter, prefs])

  return (
    <div className="view">
      <div className="stats">
        <button className={`stat ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          <b>{totalItems}</b><span>vorrätig</span>
        </button>
        <button className={`stat low ${filter === 'low' ? 'on' : ''}`} onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}>
          <b>{lowCount}</b><span>zu wenig</span>
        </button>
        <button className={`stat soon ${filter === 'expiring' ? 'on' : ''}`} onClick={() => setFilter(filter === 'expiring' ? 'all' : 'expiring')}>
          <b>{expiring}</b><span>läuft ab</span>
        </button>
      </div>

      <div className="search-row">
        <div className="search grow">
          <Icon.search />
          <input placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="icon-btn" onClick={() => setQ('')} aria-label="Suche leeren"><Icon.close /></button>}
        </div>
        <button className={`square ${showOpts ? 'on' : ''}`} onClick={() => setShowOpts(!showOpts)} aria-label="Sortieren und Ansicht">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        </button>
        <button className="square" onClick={() => setPrefs({ view: prefs.view === 'list' ? 'grid' : 'list' })} aria-label="Ansicht wechseln">
          {prefs.view === 'list' ? <Icon.grid /> : <Icon.list />}
        </button>
      </div>

      {showOpts && (
        <div className="opts card">
          <div className="field">
            <span className="field-label">Sortieren nach</span>
            <div className="seg">
              {SORTS.map((s) => (
                <button key={s.id} className={prefs.sort === s.id ? 'on' : ''} onClick={() => setPrefs({ sort: s.id })}>{s.label}</button>
              ))}
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={prefs.onlyStock} onChange={(e) => setPrefs({ onlyStock: e.target.checked })} />
            Nur vorrätige Artikel zeigen
          </label>
        </div>
      )}

      <div className="chips scroll">
        <button className={`chip ${loc === 'all' ? 'on' : ''}`} onClick={() => setLoc('all')}>Alle Orte</button>
        {data.locations.map((l) => (
          <button key={l.id} className={`chip ${loc === l.id ? 'on' : ''}`} onClick={() => setLoc(l.id)}>{l.name}</button>
        ))}
      </div>

      {groups.length === 0 && <Empty title="Nichts gefunden">{filter !== 'all' ? 'Filter oben antippen, um alles zu sehen.' : 'Anderen Suchbegriff probieren.'}</Empty>}

      {groups.map((g) => (
        <section key={g.id} className="group">
          {g.name && (
            <h3>
              {g.frozen && <span className="frost"><Icon.snow /></span>}
              {g.name}
              <span className="muted"> {g.rows.filter((r) => r.amount > 0).length}/{g.rows.length}</span>
            </h3>
          )}
          {prefs.view === 'grid' ? (
            <ul className="tiles">
              {g.rows.map(({ s, amount }) => (
                <li key={s.article.id}>
                  <button className={`tile ${amount <= 0 ? 'empty-row' : ''}`} onClick={() => onOpen(s.article)}>
                    <Thumb src={articleImage(s.article, data)} name={s.article.name} size={64} />
                    <span className={`tile-amount ${s.belowMin ? 'low' : ''}`}>{fmtAmount(amount)}</span>
                    <span className="tile-title">{s.article.name}</span>
                    {s.nextBestBefore && <span className={`pill ${mhdState(s.nextBestBefore)}`}>{mhdLabel(s.nextBestBefore)}</span>}
                    {openShop.get(s.article.id)?.carted_at && <span className="pill cart">im Warenkorb</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="rows card-list">
              {g.rows.map(({ s, amount }) => {
                const st = mhdState(s.nextBestBefore)
                const shop = openShop.get(s.article.id)
                const brands = new Set(s.entries.map((e) => entryVariant(e, data)).filter(Boolean)).size
                return (
                  <li key={s.article.id}>
                    <button className={`row ${amount <= 0 ? 'empty-row' : ''}`} onClick={() => onOpen(s.article)}>
                      <Thumb src={articleImage(s.article, data)} name={s.article.name} size={40} />
                      <span className="row-main">
                        <span className="row-title">{s.article.name}</span>
                        <span className="row-sub">
                          {s.belowMin && <span className="pill low">zu wenig</span>}
                          {s.nextBestBefore && <span className={`pill ${st}`}>{mhdLabel(s.nextBestBefore)}</span>}
                          {shop && <span className={`pill ${shop.carted_at ? 'cart' : ''}`}>{shop.carted_at ? 'im Warenkorb' : 'auf der Liste'}</span>}
                          {brands > 1 && <span>{brands} Sorten</span>}
                          {!s.belowMin && !s.nextBestBefore && !shop && (s.article.unit ?? '')}
                        </span>
                      </span>
                      <span className={`row-amount ${s.belowMin ? 'low' : ''}`}>{fmtAmount(amount)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
