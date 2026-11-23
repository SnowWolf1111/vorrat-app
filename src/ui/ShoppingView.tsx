import { useState } from 'react'
import type { Article, ShoppingItem, Source } from '../db'
import { amazonMarkup, articlePrice, searchArticles, type Data } from '../data'
import { addShopping, clearDoneShopping, toggleShopping } from '../actions'
import { fmtAmount, fmtEur, vibrate } from '../format'
import { Empty, Icon, useToast } from './common'

const ORDER: (Source | 'Ohne')[] = ['Rewe', 'Amazon', 'Metro', 'Vor Ort', 'Ohne']
const REWE_MBW = 50

type Row = { item: ShoppingItem; article?: Article; price: number | null }

export function ShoppingView({ data, onOpen }: { data: Data; onOpen: (a: Article) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [showDone, setShowDone] = useState(false)

  const rows: Row[] = data.shopping.map((item) => {
    const article = item.article_id != null ? data.articleById.get(item.article_id) : undefined
    const unit = article ? articlePrice(article, item.source ?? article.source) : null
    return { item, article, price: unit != null ? unit * item.amount : null }
  })
  const open = rows.filter((r) => r.item.status === 'open')
  const done = rows.filter((r) => r.item.status === 'done')
  const groups = ORDER.map((src) => ({
    src,
    rows: open
      .filter((r) => (r.item.source ?? 'Ohne') === src)
      .sort((a, b) => (a.article?.name ?? a.item.free_text ?? '').localeCompare(b.article?.name ?? b.item.free_text ?? '', 'de')),
  })).filter((g) => g.rows.length)

  const suggestions = q.trim().length >= 2 ? searchArticles(data.articles, q).slice(0, 5) : []

  async function add(article?: Article) {
    if (!article && !q.trim()) return
    await addShopping(article ? { article } : { text: q })
    vibrate()
    toast(`${article?.name ?? q.trim()} hinzugefügt`, 'ok')
    setQ('')
  }

  return (
    <div className="view">
      <form
        className="search add"
        onSubmit={(e) => {
          e.preventDefault()
          add(suggestions[0])
        }}
      >
        <Icon.plus />
        <input placeholder="Hinzufügen …" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      {q.trim().length >= 2 && (
        <ul className="suggest">
          {suggestions.map((a) => (
            <li key={a.id}><button onClick={() => add(a)}>{a.name}<span className="muted small"> · {a.source}</span></button></li>
          ))}
          <li><button onClick={() => add()}>„{q.trim()}“ als Freitext</button></li>
        </ul>
      )}

      {open.length === 0 && <Empty title="Alles da">Fällt ein Artikel unter den Mindestbestand, landet er automatisch hier.</Empty>}

      {groups.map((g) => {
        const sum = g.rows.reduce((s, r) => s + (r.price ?? 0), 0)
        const asinRows = g.rows.filter((r) => r.article?.amazon_asin)
        return (
          <section key={g.src} className="group">
            <h3>
              <span className={`store-dot ${g.src.replace(' ', '').toLowerCase()}`} />
              {g.src === 'Ohne' ? 'Ohne Laden' : g.src}
              <span className="muted"> {g.rows.length}</span>
              {sum > 0 && <span className="group-sum">{fmtEur(sum)}</span>}
            </h3>

            {g.src === 'Rewe' && (
              <div className="mbw">
                <div className="bar"><span style={{ width: `${Math.min(100, (sum / REWE_MBW) * 100)}%` }} /></div>
                <span className="small">
                  {sum >= REWE_MBW ? 'Mindestbestellwert 50 € erreicht' : `noch ${fmtEur(REWE_MBW - sum)} bis 50 € Mindestbestellwert`}
                </span>
              </div>
            )}

            <ul className="rows card-list">
              {g.rows.map((r) => (
                <ShopRow key={r.item.id} row={r} data={data} onOpen={onOpen} />
              ))}
            </ul>

            {g.src === 'Amazon' && (
              <div className="amazon-box">
                <a
                  className={`primary amazon ${asinRows.length ? '' : 'disabled'}`}
                  href={asinRows.length ? amazonCartUrl(asinRows) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!asinRows.length}
                >
                  <Icon.cart /> In den Amazon-Warenkorb ({asinRows.length})
                </a>
                {asinRows.length < g.rows.length && (
                  <p className="muted small">
                    {g.rows.length - asinRows.length} Artikel ohne ASIN – Artikel antippen → Einstellungen → ASIN eintragen. Bis dahin: Lupe
                    öffnet die Amazon-Suche.
                  </p>
                )}
                <p className="muted small">Der Knopf legt nur in den Warenkorb. Kaufen machst du selbst.</p>
              </div>
            )}
          </section>
        )
      })}

      {done.length > 0 && (
        <section className="group">
          <button className="link-row" onClick={() => setShowDone(!showDone)}>
            Erledigt ({done.length}) <span className={`chev ${showDone ? 'open' : ''}`}><Icon.chevron /></span>
          </button>
          {showDone && (
            <>
              <ul className="rows card-list done">
                {done.map((r) => (
                  <ShopRow key={r.item.id} row={r} data={data} onOpen={onOpen} />
                ))}
              </ul>
              <button className="secondary" onClick={clearDoneShopping}>Erledigte entfernen</button>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function ShopRow({ row: { item, article, price }, data, onOpen }: { row: Row; data: Data; onOpen: (a: Article) => void }) {
  const markup = article && item.source === 'Rewe' ? amazonMarkup(article) : null
  const stock = article ? data.stock.get(article.id)?.total ?? 0 : null
  return (
    <li className="shop-row">
      <button className={`check ${item.status === 'done' ? 'on' : ''}`} onClick={() => (vibrate(), toggleShopping(item))} aria-label="abhaken">
        <Icon.check />
      </button>
      <button className="row" onClick={() => article && onOpen(article)} disabled={!article}>
        <span className="row-main">
          <span className="row-title">
            {fmtAmount(item.amount)}× {article?.name ?? item.free_text}
          </span>
          <span className="row-sub">
            {item.origin === 'auto' && <span className="pill">Mindestbestand</span>}
            {item.origin === 'alexa' && <span className="pill">Alexa</span>}
            {!article && <span className="pill warn">bitte zuordnen</span>}
            {stock != null && <span>da: {fmtAmount(stock)}</span>}
            {markup != null && markup <= 30 && <span className="ok-text">Amazon nur +{markup} %</span>}
          </span>
        </span>
        {price != null && <span className="row-amount price">{fmtEur(price)}</span>}
      </button>
      {item.source === 'Amazon' && article && !article.amazon_asin && (
        <a className="icon-btn" href={`https://www.amazon.de/s?k=${encodeURIComponent(article.amazon_product ?? article.name)}`} target="_blank" rel="noreferrer" aria-label="Bei Amazon suchen">
          <Icon.search />
        </a>
      )}
    </li>
  )
}

function amazonCartUrl(rows: Row[]) {
  const p = new URLSearchParams()
  rows.forEach((r, i) => {
    p.set(`ASIN.${i + 1}`, r.article!.amazon_asin!)
    p.set(`Quantity.${i + 1}`, String(Math.max(1, Math.round(r.item.amount))))
  })
  return `https://www.amazon.de/gp/aws/cart/add.html?${p.toString()}`
}
