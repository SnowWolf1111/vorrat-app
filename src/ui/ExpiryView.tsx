import { useState } from 'react'
import type { Article, StockEntry } from '../db'
import { articleImage, entryVariant, type Data } from '../data'
import { consumeEntry } from '../actions'
import { daysUntil, fmtAmount, fmtDate, mhdLabel, mhdState, vibrate } from '../format'
import { Empty, Icon, Thumb, useToast } from './common'

type Bucket = { id: string; title: string; test: (d: number | null) => boolean; open: boolean }
const BUCKETS: Bucket[] = [
  { id: 'exp', title: 'Abgelaufen', test: (d) => d != null && d < 0, open: true },
  { id: 'week', title: 'Diese Woche', test: (d) => d != null && d >= 0 && d <= 7, open: true },
  { id: 'month', title: 'In den nächsten 30 Tagen', test: (d) => d != null && d > 7 && d <= 30, open: true },
  { id: 'q', title: 'In 1–3 Monaten', test: (d) => d != null && d > 30 && d <= 90, open: false },
  { id: 'later', title: 'Später', test: (d) => d != null && d > 90, open: false },
  { id: 'none', title: 'Ohne MHD', test: (d) => d == null, open: false },
]

export function expiringCount(data: Data) {
  let n = 0
  for (const s of data.stock.values()) for (const e of s.entries) if (e.best_before && daysUntil(e.best_before) <= 7) n++
  return n
}

export function ExpiryView({ data, onOpen }: { data: Data; onOpen: (a: Article) => void }) {
  const toast = useToast()
  const [openIds, setOpenIds] = useState(() => new Set(BUCKETS.filter((b) => b.open).map((b) => b.id)))
  const [loc, setLoc] = useState<number | 'all'>('all')

  const entries: { e: StockEntry; a: Article; days: number | null }[] = []
  for (const s of data.stock.values())
    for (const e of s.entries) if (loc === 'all' || e.location_id === loc) entries.push({ e, a: s.article, days: e.best_before ? daysUntil(e.best_before) : null })
  entries.sort((x, y) => (x.days ?? 1e9) - (y.days ?? 1e9) || x.a.name.localeCompare(y.a.name, 'de'))

  async function minus(a: Article, e: StockEntry) {
    const r = await consumeEntry(a, e, 1)
    if (r.taken) {
      vibrate()
      toast(`−1 ${a.name}`, 'ok', { label: 'Rückgängig', run: r.undo })
    }
  }

  const toggle = (id: string) => setOpenIds((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  if (!entries.length && loc === 'all') return <div className="view"><Empty title="Noch nichts eingelagert">Beim Einlagern das MHD eintragen, dann siehst du hier, was bald weg muss.</Empty></div>

  return (
    <div className="view">
      <div className="stats">
        {BUCKETS.slice(0, 3).map((b) => (
          <div key={b.id} className={`stat ${b.id === 'exp' ? 'expired' : b.id === 'week' ? 'soon' : ''}`}>
            <b>{entries.filter((x) => b.test(x.days)).length}</b>
            <span>{b.id === 'exp' ? 'abgelaufen' : b.id === 'week' ? '≤ 7 Tage' : '≤ 30 Tage'}</span>
          </div>
        ))}
      </div>
      <div className="chips scroll">
        <button className={`chip ${loc === 'all' ? 'on' : ''}`} onClick={() => setLoc('all')}>Alle Orte</button>
        {data.locations.map((l) => (
          <button key={l.id} className={`chip ${loc === l.id ? 'on' : ''}`} onClick={() => setLoc(l.id)}>{l.name}</button>
        ))}
      </div>

      {BUCKETS.map((b) => {
        const rows = entries.filter((x) => b.test(x.days))
        if (!rows.length) return null
        const open = openIds.has(b.id)
        return (
          <section key={b.id} className="group">
            <button className="link-row" onClick={() => toggle(b.id)}>
              <span>{b.title} <span className="muted">{rows.length}</span></span>
              <span className={`chev ${open ? 'open' : ''}`}><Icon.chevron /></span>
            </button>
            {open && (
              <ul className="rows card-list">
                {rows.map(({ e, a }) => {
                  const v = entryVariant(e, data)
                  return (
                    <li key={e.id} className="shop-row">
                      <button className="row" onClick={() => onOpen(a)}>
                        <Thumb src={articleImage(a, data)} name={a.name} size={40} />
                        <span className="row-main">
                          <span className="row-title">{fmtAmount(e.amount)}× {a.name}</span>
                          <span className="row-sub">
                            <span className={`pill ${mhdState(e.best_before)}`}>{e.best_before ? `${mhdLabel(e.best_before)}` : 'ohne MHD'}</span>
                            {e.best_before && <span>{fmtDate(e.best_before)}</span>}
                            <span>{data.locationById.get(e.location_id)?.name}</span>
                            {v && <span className="ellipsis">{v}</span>}
                          </span>
                        </span>
                      </button>
                      <button className="icon-btn" onClick={() => minus(a, e)} aria-label="Einen verbrauchen"><Icon.minus /></button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
