import { useMemo, useState } from 'react'
import type { Article } from '../db'
import type { Data } from '../data'
import { normalize } from '../data'
import { addShopping } from '../actions'
import { fmtEur } from '../format'
import { STORES, applyPrefs, discountLabel, getPrefs, isFuture, loadOffers, neededArticles, offersFor, savePrefs, searchOffers, useOffers, type Offer, type OfferPrefs } from '../offers'
import { Icon, Thumb, useToast } from './common'

const fmtDay = (d: string | null) => (d ? new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '')

export function OfferCard({ o, article }: { o: Offer; article?: Article }) {
  const toast = useToast()
  const disc = discountLabel(o)
  return (
    <li className="offer">
      <Thumb src={o.image} name={o.title} size={52} />
      <div className="grow offer-text">
        <b>{o.title}</b>
        <span className="muted small">{[o.unit, o.base_price].filter(Boolean).join(' · ')}</span>
        <span className="small">
          <span className={`pill store-${normalize(o.store)}`}>{o.store}</span>
          {isFuture(o) ? <span className="warn-text"> ab {fmtDay(o.valid_from!)}</span> : o.valid_to ? <span className="muted"> bis {fmtDay(o.valid_to)}</span> : o.kind === 'preis' ? <span className="muted"> Normalpreis</span> : null}
        </span>
      </div>
      <div className="offer-price">
        {disc && <span className="pill soon">{disc}</span>}
        <b>{o.price != null ? fmtEur(o.price) : '—'}</b>
        {o.old_price != null && o.old_price !== o.price && <s className="muted small">{fmtEur(o.old_price)}</s>}
        {o.card_price != null && <span className="small ok-text">Card {fmtEur(o.card_price)}</span>}
        <span className="offer-actions">
          {article && (
            <button className="icon-btn" aria-label="Auf die Liste" onClick={async () => { await addShopping({ article, amount: article.reorder_qty || 1 }); toast(`${article.name} auf der Liste`, 'ok') }}>
              <Icon.cart />
            </button>
          )}
          {o.url && <a className="icon-btn" href={o.url} target="_blank" rel="noreferrer" aria-label="Im Laden ansehen">↗</a>}
        </span>
      </div>
    </li>
  )
}

export function OffersView({ data, onOpen }: { data: Data; onOpen: (a: Article) => void }) {
  const all = useOffers()
  const [prefs, setPrefs] = useState<OfferPrefs>(getPrefs)
  const [settings, setSettings] = useState(false)
  const offers = useMemo(() => (all ? applyPrefs(all, prefs) : null), [all, prefs])
  const upd = (p: OfferPrefs) => { setPrefs(p); savePrefs(p) }
  const [q, setQ] = useState('')
  const [live, setLive] = useState<{ q: string; results: Offer[]; errors: Record<string, string> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [store, setStore] = useState<string>('alle')
  const [showAll, setShowAll] = useState(60)

  const { forYou, mine } = useMemo(() => {
    if (!offers) return { forYou: [], mine: [] }
    const needed = new Set(neededArticles(data).map((a) => a.id))
    const forYou: { a: Article; list: Offer[] }[] = []
    const mine: { a: Article; list: Offer[] }[] = []
    for (const a of data.articles) {
      const list = offersFor(a, offers)
      if (!list.length) continue
      ;(needed.has(a.id) ? forYou : mine).push({ a, list })
    }
    return { forYou, mine }
  }, [offers, data])

  const stores = useMemo(() => [...new Set((offers ?? []).map((o) => o.store))], [offers])
  const filtered = useMemo(() => {
    const t = normalize(q.trim())
    return (offers ?? []).filter((o) => (store === 'alle' || o.store === store) && (!t || normalize(o.title).includes(t)))
  }, [offers, q, store])

  async function search(e?: React.FormEvent) {
    e?.preventDefault()
    const t = q.trim()
    if (t.length < 2) return
    setBusy(true)
    setErr(null)
    try {
      setLive({ q: t, ...(await searchOffers(t)) })
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!offers) return <div className="center-screen muted">Lade Angebote …</div>

  return (
    <div className="offers-view">
      <form className="search" onSubmit={search}>
        <input placeholder="Produkt suchen, z. B. Nuggets, Zahnpasta …" value={q} onChange={(e) => { setQ(e.target.value); setLive(null) }} />
        <button className="icon-btn" aria-label="Live-Preise suchen" disabled={busy || q.trim().length < 2}>{busy ? '…' : <Icon.send />}</button>
      </form>
      <div className="offers-info">
        <p className="muted small">Angebote holt der Server jeden Morgen selbst (bundesweite Aktionen, keine Filial-Sonderangebote). Mit ➤ fragt die App zusätzlich live bei dm nach.</p>
        <button className="chip" onClick={() => setSettings(!settings)}>⚙ Läden &amp; Ort</button>
      </div>
      {settings && (
        <div className="offer-settings card">
          <label className="field"><span className="field-label">Postleitzahl</span>
            <input inputMode="numeric" maxLength={5} value={prefs.plz} onChange={(e) => upd({ ...prefs, plz: e.target.value.replace(/\D/g, '') })} />
          </label>
          <p className="muted small">Für die allgemeinen Aktionen spielt der Ort keine Rolle. Die PLZ ist für später vorgemerkt (z. B. Markt in der Nähe).</p>
          <span className="field-label">Läden</span>
          <ul className="store-list">
            {STORES.map((s) => (
              <li key={s.name}>
                <label>
                  <input type="checkbox" disabled={s.how === 'gesperrt'} checked={s.how !== 'gesperrt' && !prefs.off.includes(s.name)}
                    onChange={(e) => upd({ ...prefs, off: e.target.checked ? prefs.off.filter((x) => x !== s.name) : [...prefs.off, s.name] })} />
                  <b>{s.name}</b>
                </label>
                <span className="muted small">{s.how === 'gesperrt' ? '🚫 ' : s.how === 'live' ? '🔎 ' : '✅ '}{s.note}</span>
              </li>
            ))}
          </ul>
          <label className="check-line"><input type="checkbox" checked={prefs.next} onChange={(e) => upd({ ...prefs, next: e.target.checked })} /> Angebote der nächsten Woche schon zeigen</label>
        </div>
      )}
      {err && <p className="error small">{err}</p>}

      {live && (
        <section>
          <h3>Live-Preise für „{live.q}“</h3>
          {Object.entries(live.errors).map(([k, v]) => <p key={k} className="muted small">{k}: gerade nicht erreichbar ({v})</p>)}
          {live.results.length === 0 ? <p className="muted">Nichts gefunden.</p> : (
            <ul className="rows card-list">{applyPrefs(live.results, prefs).sort((a, b) => (a.price ?? 99) - (b.price ?? 99)).map((o, i) => <OfferCard key={i} o={o} />)}</ul>
          )}
        </section>
      )}

      {!q && forYou.length > 0 && (
        <section>
          <h3>Für dich <span className="muted small">(Einkaufsliste, bald leer, zu wenig)</span></h3>
          {forYou.map(({ a, list }) => <Group key={a.id} a={a} list={list} data={data} onOpen={onOpen} />)}
        </section>
      )}
      {!q && mine.length > 0 && (
        <section>
          <h3>Deine Artikel im Angebot</h3>
          {mine.map(({ a, list }) => <Group key={a.id} a={a} list={list} data={data} onOpen={onOpen} />)}
        </section>
      )}

      <section>
        <h3>Alle Angebote <span className="muted small">({filtered.length})</span></h3>
        <div className="chips">
          {['alle', ...stores].map((s) => <button key={s} className={`chip ${store === s ? 'on' : ''}`} onClick={() => setStore(s)}>{s === 'alle' ? 'Alle Läden' : s}</button>)}
          <button className="chip" onClick={() => loadOffers(true).then(() => location.reload())}><Icon.refresh /> Neu laden</button>
        </div>
        <ul className="rows card-list">{filtered.slice(0, showAll).map((o, i) => <OfferCard key={o.id ?? i} o={o} />)}</ul>
        {filtered.length > showAll && <button className="secondary wide" onClick={() => setShowAll(showAll + 100)}>Mehr anzeigen</button>}
        {offers.length === 0 && <p className="muted">Noch keine Angebote geladen. Der Server holt sie jeden Morgen.</p>}
      </section>
    </div>
  )
}

function Group({ a, list, data, onOpen }: { a: Article; list: Offer[]; data: Data; onOpen: (a: Article) => void }) {
  const s = data.stock.get(a.id)
  return (
    <div className="offer-group">
      <button className="offer-group-head" onClick={() => onOpen(a)}>
        <b>{a.name}</b> <span className="muted small">da: {s?.total ?? 0}</span>
      </button>
      <ul className="rows card-list">{list.slice(0, 3).map((o, i) => <OfferCard key={o.id ?? i} o={o} article={a} />)}</ul>
    </div>
  )
}
