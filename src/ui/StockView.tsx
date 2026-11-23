import { useMemo, useState } from 'react'
import type { Article } from '../db'
import { searchArticles, type ArticleStock, type Data } from '../data'
import { fmtAmount, mhdLabel, mhdState } from '../format'
import { Empty, Icon } from './common'

type Filter = 'all' | 'low' | 'expiring'

export function StockView({ data, onOpen }: { data: Data; onOpen: (a: Article) => void }) {
  const [q, setQ] = useState('')
  const [loc, setLoc] = useState<number | 'all'>('all')
  const [filter, setFilter] = useState<Filter>('all')

  const all = [...data.stock.values()]
  const lowCount = all.filter((s) => s.belowMin).length
  const expiring = all.filter((s) => ['expired', 'soon'].includes(mhdState(s.nextBestBefore))).length
  const totalItems = all.reduce((n, s) => n + (s.total > 0 ? 1 : 0), 0)

  const groups = useMemo(() => {
    let list = q ? searchArticles(data.articles, q) : data.articles
    if (filter === 'low') list = list.filter((a) => data.stock.get(a.id)?.belowMin)
    if (filter === 'expiring') list = list.filter((a) => ['expired', 'soon'].includes(mhdState(data.stock.get(a.id)?.nextBestBefore ?? null)))

    const result: { id: number; name: string; frozen: boolean; rows: { s: ArticleStock; amount: number }[] }[] = []
    for (const l of data.locations) {
      if (loc !== 'all' && loc !== l.id) continue
      const rows = list
        .map((a) => data.stock.get(a.id)!)
        .filter((s) => (loc === 'all' ? (s.article.default_location_id ?? -1) === l.id : s.article.default_location_id === l.id || s.byLocation.has(l.id)))
        .map((s) => ({ s, amount: loc === 'all' ? s.total : s.byLocation.get(l.id) ?? 0 }))
      if (rows.length) result.push({ id: l.id, name: l.name, frozen: l.is_frozen, rows })
    }
    if (loc === 'all') {
      const known = new Set(data.locations.map((l) => l.id))
      const rest = list.filter((a) => !known.has(a.default_location_id ?? -1)).map((a) => ({ s: data.stock.get(a.id)!, amount: data.stock.get(a.id)!.total }))
      if (rest.length) result.push({ id: -1, name: 'Ohne Lagerort', frozen: false, rows: rest })
    }
    return result
  }, [data, q, loc, filter])

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

      <div className="search">
        <Icon.search />
        <input placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="icon-btn" onClick={() => setQ('')} aria-label="Suche leeren"><Icon.close /></button>}
      </div>

      <div className="chips scroll">
        <button className={`chip ${loc === 'all' ? 'on' : ''}`} onClick={() => setLoc('all')}>Alle</button>
        {data.locations.map((l) => (
          <button key={l.id} className={`chip ${loc === l.id ? 'on' : ''}`} onClick={() => setLoc(l.id)}>{l.name}</button>
        ))}
      </div>

      {groups.length === 0 && <Empty title="Nichts gefunden">{filter !== 'all' ? 'Filter oben antippen, um alles zu sehen.' : 'Anderen Suchbegriff probieren.'}</Empty>}

      {groups.map((g) => (
        <section key={g.id} className="group">
          <h3>
            {g.frozen && <span className="frost"><Icon.snow /></span>}
            {g.name}
            <span className="muted"> {g.rows.filter((r) => r.amount > 0).length}/{g.rows.length}</span>
          </h3>
          <ul className="rows card-list">
            {g.rows.map(({ s, amount }) => {
              const st = mhdState(s.nextBestBefore)
              return (
                <li key={s.article.id}>
                  <button className={`row ${amount <= 0 ? 'empty-row' : ''}`} onClick={() => onOpen(s.article)}>
                    <span className="row-main">
                      <span className="row-title">{s.article.name}</span>
                      <span className="row-sub">
                        {s.belowMin && <span className="pill low">zu wenig</span>}
                        {s.nextBestBefore && <span className={`pill ${st}`}>{mhdLabel(s.nextBestBefore)}</span>}
                        {!s.belowMin && !s.nextBestBefore && (s.article.unit ?? '')}
                      </span>
                    </span>
                    <span className={`row-amount ${s.belowMin ? 'low' : ''}`}>{fmtAmount(amount)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
