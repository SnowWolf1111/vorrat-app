import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Article, type Location, type ShoppingItem, type StockEntry } from './db'
import { sortFifo } from './actions'

export type ArticleStock = {
  article: Article
  total: number
  byLocation: Map<number, number>
  entries: StockEntry[] // FIFO-sortiert
  nextBestBefore: string | null
  belowMin: boolean
}

export type Data = {
  ready: boolean
  locations: Location[]
  locationById: Map<number, Location>
  articles: Article[]
  articleById: Map<number, Article>
  stock: Map<number, ArticleStock>
  shopping: ShoppingItem[]
  pending: number
}

export function useData(): Data {
  const res = useLiveQuery(async () => {
    const [locations, articles, stock, shopping, pending] = await Promise.all([
      db.locations.toArray(),
      db.articles.toArray(),
      db.stock.toArray(),
      db.shopping.toArray(),
      db.outbox.count(),
    ])
    return { locations, articles, stock, shopping, pending }
  })

  const locations = (res?.locations ?? []).sort((a, b) => a.sort - b.sort)
  const articles = (res?.articles ?? []).filter((a) => a.active).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const articleById = new Map(articles.map((a) => [a.id, a]))
  const entriesBy = new Map<number, StockEntry[]>()
  for (const e of res?.stock ?? []) {
    if (e.amount <= 0) continue
    entriesBy.set(e.article_id, [...(entriesBy.get(e.article_id) ?? []), e])
  }
  const stock = new Map<number, ArticleStock>()
  for (const a of articles) {
    const entries = (entriesBy.get(a.id) ?? []).sort(sortFifo)
    const byLocation = new Map<number, number>()
    let total = 0
    for (const e of entries) {
      total += e.amount
      byLocation.set(e.location_id, (byLocation.get(e.location_id) ?? 0) + e.amount)
    }
    const nextBestBefore = entries.map((e) => e.best_before).filter(Boolean).sort()[0] ?? null
    stock.set(a.id, { article: a, total, byLocation, entries, nextBestBefore, belowMin: total < a.min_stock })
  }

  return {
    ready: !!res && (res.articles.length > 0 || res.pending === 0),
    locations,
    locationById: new Map(locations.map((l) => [l.id, l])),
    articles,
    articleById,
    stock,
    shopping: res?.shopping ?? [],
    pending: res?.pending ?? 0,
  }
}

export function articlePrice(a: Article, source = a.source) {
  if (source === 'Amazon') return a.amazon_price
  if (source === 'Rewe') return a.rewe_price
  return a.rewe_price ?? a.amazon_price
}

/** Amazon-Aufpreis ggü. Rewe in Prozent (null, wenn nicht vergleichbar). */
export function amazonMarkup(a: Article) {
  if (!a.amazon_price || !a.rewe_price) return null
  return Math.round((a.amazon_price / a.rewe_price - 1) * 100)
}

export function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
}

export function searchArticles(articles: Article[], q: string) {
  const words = normalize(q).split(/\s+/).filter(Boolean)
  if (!words.length) return articles
  return articles
    .map((a) => {
      const hay = normalize([a.name, a.category, ...(a.aliases ?? [])].filter(Boolean).join(' '))
      const hits = words.filter((w) => hay.includes(w)).length
      const starts = normalize(a.name).startsWith(words[0]) ? 1 : 0
      return { a, score: hits * 2 + starts }
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name, 'de'))
    .map((x) => x.a)
}
