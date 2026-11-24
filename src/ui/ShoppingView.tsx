import { useState } from 'react'
import type { Article, ShoppingItem, Source } from '../db'
import { amazonMarkup, articleImage, articlePrice, searchArticles, type Data } from '../data'
import { addShopping, clearDoneShopping, deleteShopping, setCarted, toggleShopping } from '../actions'
import { fmtAmount, fmtEur, vibrate } from '../format'
import { Empty, Icon, Thumb, useToast } from './common'
import { amazonCartUrl, amazonSearchUrl, reweSearchUrl } from '../shops'

const ORDER: (Source | 'Ohne')[] = ['Rewe', 'Amazon', 'Metro', 'Vor Ort', 'Ohne']
const REWE_MBW = 50

type Row = { item: ShoppingItem; article?: Article; price: number | null }

export function ShoppingView({ data, onOpen, onStockIn }: { data: Data; onOpen: (a: Article) => void; onStockIn: (a: Article, amount: number) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [showDone, setShowDone] = useState(false)

  const rows: Row[] = data.shopping.map((item) => {
    const article = item.article_id != null ? data.articleById.get(item.article_id) : undefined
    const unit = article ? articlePrice(article, item.source ?? article.source) : null
    return { item, article, price: unit != null ? unit * item.amount : null }
  })
  const open = rows.filter((r) => r.item.status === 'open')
  const done = rows.filter((r) => r.item.status === 'done').sort((a, b) => (b.item.done_at ?? '').localeCompare(a.item.done_at ?? ''))
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
        const carted = g.rows.filter((r) => r.item.carted_at).length
        return (
          <section key={g.src} className="group">
            <h3>
              <span className={`store-dot ${g.src.replace(' ', '').toLowerCase()}`} />
              {g.src === 'Ohne' ? 'Ohne Laden' : g.src}
              <span className="muted"> {g.rows.length}{carted ? ` · ${carted} im Warenkorb` : ''}</span>
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
                  href={asinRows.length ? amazonCartUrl(asinRows.map((r) => ({ asin: r.article!.amazon_asin!, qty: r.item.amount }))) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!asinRows.length}
                  onClick={() => setCarted(asinRows.map((r) => r.item).filter((i) => !i.carted_at), true)}
                >
                  <Icon.cart /> In den Amazon-Warenkorb ({asinRows.length})
                </a>
                {asinRows.length < g.rows.length && (
                  <p className="muted small">
                    {g.rows.length - asinRows.length} ohne ASIN: Lupe öffnet die Amazon-Suche. ASIN eintragen unter Artikel → Bearbeiten, dann geht es per Knopf.
                  </p>
                )}
                <p className="muted small">Der Knopf legt nur in den Warenkorb und markiert die Artikel hier als „im Warenkorb“. Kaufen machst du selbst.</p>
              </div>
            )}
            {g.src === 'Rewe' && (
              <p className="muted small hint-pad">Lupe öffnet die Rewe-Suche. Danach den Korb-Knopf antippen, dann siehst du hier und im Vorrat, was schon im Warenkorb liegt.</p>
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
                  <ShopRow key={r.item.id} row={r} data={data} onOpen={onOpen} onStockIn={onStockIn} />
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

function ShopRow({ row: { item, article, price }, data, onOpen, onStockIn }: { row: Row; data: Data; onOpen: (a: Article) => void; onStockIn?: (a: Article, amount: number) => void }) {
  const toast = useToast()
  const markup = article && item.source === 'Rewe' ? amazonMarkup(article) : null
  const stock = article ? data.stock.get(article.id)?.total ?? 0 : null
  const isDone = item.status === 'done'
  return (
    <li className="shop-row">
      <button
        className={`check ${isDone ? 'on' : ''}`}
        onClick={() => {
          vibrate()
          toggleShopping(item)
          if (!isDone && article) toast(`${article.name} abgehakt`, 'ok', { label: 'Einlagern', run: () => onStockInFromToast(article, item.amount) })
        }}
        aria-label="abhaken"
      >
        <Icon.check />
      </button>
      {article && <Thumb src={articleImage(article, data)} name={article.name} size={34} />}
      <button className="row" onClick={() => article && onOpen(article)} disabled={!article}>
        <span className="row-main">
          <span className="row-title">
            {fmtAmount(item.amount)}× {article?.name ?? item.free_text}
          </span>
          <span className="row-sub">
            {item.carted_at && !isDone && <span className="pill cart">im Warenkorb</span>}
            {item.origin === 'auto' && <span className="pill">Mindestbestand</span>}
            {item.origin === 'alexa' && <span className="pill">Alexa</span>}
            {item.origin === 'bald_leer' && <span className="pill soon">bald leer</span>}
            {!article && <span className="pill warn">bitte zuordnen</span>}
            {stock != null && <span>da: {fmtAmount(stock)}</span>}
            {markup != null && markup <= 30 && <span className="ok-text">Amazon nur +{markup} %</span>}
          </span>
        </span>
        {price != null && <span className="row-amount price">{fmtEur(price)}</span>}
      </button>
      {isDone ? (
        article && onStockIn ? (
          <button className="icon-btn accent-text" onClick={() => onStockIn(article, item.amount)} aria-label="Einlagern"><Icon.box /></button>
        ) : (
          <button className="icon-btn" onClick={() => deleteShopping(item)} aria-label="Löschen"><Icon.trash /></button>
        )
      ) : (
        <>
          {article && (item.source === 'Rewe' || (item.source === 'Amazon' && !article.amazon_asin)) && (
            <a className="icon-btn" href={item.source === 'Rewe' ? reweSearchUrl(article) : amazonSearchUrl(article)} target="_blank" rel="noreferrer" aria-label="Im Shop suchen">
              <Icon.search />
            </a>
          )}
          {(item.source === 'Rewe' || item.source === 'Amazon') && (
            <button className={`icon-btn ${item.carted_at ? 'accent-text' : ''}`} onClick={() => setCarted([item], !item.carted_at)} aria-label="Im Warenkorb markieren">
              <Icon.cart />
            </button>
          )}
        </>
      )}
    </li>
  )
}

// Einlagern aus dem Toast heraus: App.tsx hört auf dieses Ereignis
function onStockInFromToast(article: Article, amount: number) {
  window.dispatchEvent(new CustomEvent('vorrat:stockin', { detail: { articleId: article.id, amount } }))
}
