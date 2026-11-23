import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Article, type Barcode, type Dish, type DishItem, type Location, type ShoppingItem, type StockEntry } from './db'
import { sortFifo, type OffProduct } from './actions'

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
  barcodes: Barcode[]
  barcodeByEan: Map<string, Barcode>
  stock: Map<number, ArticleStock>
  shopping: ShoppingItem[]
  dishes: Dish[]
  dishItems: DishItem[]
  pending: number
}

export function useData(): Data {
  const res = useLiveQuery(async () => {
    const [locations, articles, stock, shopping, pending, barcodes, dishes, dishItems] = await Promise.all([
      db.locations.toArray(),
      db.articles.toArray(),
      db.stock.toArray(),
      db.shopping.toArray(),
      db.outbox.count(),
      db.barcodes.toArray(),
      db.dishes.toArray(),
      db.dishItems.toArray(),
    ])
    return { locations, articles, stock, shopping, pending, barcodes, dishes, dishItems }
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
  const barcodes = res?.barcodes ?? []

  return {
    ready: !!res && (res.articles.length > 0 || res.pending === 0),
    locations,
    locationById: new Map(locations.map((l) => [l.id, l])),
    articles,
    articleById,
    barcodes,
    barcodeByEan: new Map(barcodes.map((b) => [b.ean, b])),
    stock,
    shopping: res?.shopping ?? [],
    dishes: (res?.dishes ?? []).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    dishItems: res?.dishItems ?? [],
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

// ---------- Bilder ----------
// Produktfoto (über den Barcode von Open Food Facts) oder ein passendes Symbol.
// image_url kann ein Foto-Link sein oder "emoji:🍗" (selbst gewähltes Symbol).

/** Foto des Artikels oder ein Symbol ("emoji:…"). */
export function articleImage(a: Article, data?: Pick<Data, 'barcodes'>): string {
  if (a.image_url) return a.image_url
  const bc = data?.barcodes.find((b) => b.article_id === a.id && b.off_image_url)
  if (bc) return bc.off_image_url!
  return 'emoji:' + articleEmoji(a)
}

const EMOJI: [RegExp, string][] = [
  [/kase|mozzarella|gouda/, '🧀'],
  [/nugget|hahnchen|chicken|stripes|chunks|huhn/, '🍗'],
  [/pommes|frites|kartoffel/, '🍟'],
  [/pizza/, '🍕'],
  [/burger/, '🍔'],
  [/hot-?dog|wurstchen|bockwurst|wurst/, '🌭'],
  [/hack|fleisch|rind|schwein/, '🥩'],
  [/thunfisch|fisch|lachs/, '🐟'],
  [/nudel|rigatoni|pasta|spaghetti|penne|mie/, '🍝'],
  [/maultasche|ravioli|tortellini/, '🥟'],
  [/fruhlingsrolle/, '🥠'],
  [/reis/, '🍚'],
  [/tomate/, '🍅'],
  [/milch|sahne|kochcreme/, '🥛'],
  [/brotchen|brot|toast/, '🥖'],
  [/\beier?\b/, '🥚'],
  [/zwiebel/, '🧅'],
  [/knoblauch/, '🧄'],
  [/brokkoli/, '🥦'],
  [/gemuse|porree|lauch/, '🥬'],
  [/mais/, '🌽'],
  [/paprika|chili|curry/, '🌶️'],
  [/salz|pfeffer|gewurz/, '🧂'],
  [/ketchup|sauce|sosse|senf|bbq/, '🥫'],
  [/ol\b|speiseol|essig/, '🫒'],
  [/zucker|honig/, '🍯'],
  [/bruhe|suppe/, '🍲'],
  [/mehl|paniermehl|saucenbinder/, '🌾'],
  [/cola|limo|saft|wasser|sirup|getrank/, '🥤'],
  [/bier/, '🍺'],
  [/kaffee/, '☕'],
  [/schoko|keks|chips|suss/, '🍫'],
  [/apfel|obst/, '🍎'],
  [/banane/, '🍌'],
]
const CAT_EMOJI: [RegExp, string][] = [[/tk/, '🧊'], [/konserve|dose/, '🥫'], [/kuhl/, '🧀'], [/sauce/, '🥫'], [/trocken/, '🌾'], [/frisch/, '🥬']]

export function articleEmoji(a: Pick<Article, 'name' | 'category'>) {
  const n = normalize(a.name)
  for (const [re, e] of EMOJI) if (re.test(n)) return e
  const c = normalize(a.category ?? '')
  for (const [re, e] of CAT_EMOJI) if (re.test(c)) return e
  return '🛒'
}

// ---------- Sorten / Marken ----------
export function entryVariant(e: StockEntry, data: Pick<Data, 'barcodeByEan'>) {
  if (e.variant) return e.variant
  const b = e.ean ? data.barcodeByEan.get(e.ean) : undefined
  return b ? [b.off_brand, b.off_name].filter(Boolean).join(' – ') || null : null
}

export function entryImage(e: StockEntry, data: Pick<Data, 'barcodeByEan'>) {
  return (e.ean && data.barcodeByEan.get(e.ean)?.off_image_url) || null
}

/** Bekannte Sorten eines Artikels (aus Barcodes und früheren Einlagerungen). */
export function knownVariants(a: Article, data: Data) {
  const set = new Set<string>()
  for (const b of data.barcodes) if (b.article_id === a.id) {
    const v = [b.off_brand, b.off_name].filter(Boolean).join(' – ')
    if (v) set.add(v)
  }
  for (const e of data.stock.get(a.id)?.entries ?? []) if (e.variant) set.add(e.variant)
  return [...set]
}

// ---------- Automatische Zuordnung eines neuen Barcodes ----------
const STOP = new Set(['und', 'oder', 'mit', 'ohne', 'der', 'die', 'das', 'aus', 'fur', 'tk', 'packung', 'dose', 'stk', 'frisch', 'basis', 'classic', 'original', 'de', 'la', 'le'])
const SYN: Record<string, string[]> = {
  pommes: ['frites', 'fries', 'pommes', 'kartoffelstabchen'],
  hackfleisch: ['hack', 'gehacktes', 'hackfleisch', 'faschiertes'],
  nudeln: ['pasta', 'nudeln', 'penne', 'fusilli', 'spaghetti'],
  rigatoni: ['rigatoni'],
  hahnchen: ['hahnchen', 'chicken', 'huhn', 'geflugel'],
  nuggets: ['nuggets', 'nugget'],
  wurstchen: ['wurstchen', 'wiener', 'frankfurter'],
  sahne: ['sahne', 'cuisine', 'kochcreme', 'creme'],
  reibekase: ['gerieben', 'reibekase', 'pizzakase', 'gouda', 'mozzarella'],
  ol: ['ol', 'speiseol', 'rapsol', 'sonnenblumenol'],
  reis: ['reis', 'rice', 'basmati'],
  milch: ['milch', 'h-milch', 'vollmilch'],
  bruhe: ['bruhe', 'bouillon', 'fond'],
}

function tokens(s: string) {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
}

export type Match = { article: Article; score: number }

/** Bewertet, welcher Katalogartikel zu einem Open-Food-Facts-Produkt passt. */
export function matchArticles(off: OffProduct | null, data: Data): Match[] {
  if (!off) return []
  const main = normalize([off.name, off.generic].filter(Boolean).join(' '))
  const cat = normalize(off.categories ?? '')
  // Synonyme in beide Richtungen: "chicken" findet auch "Hähnchen" usw.
  const group = (w: string) => {
    const g = new Set([w])
    for (const list of Object.values(SYN)) if (list.includes(w) || list.some((x) => w.includes(x) && x.length >= 4)) list.forEach((x) => g.add(x))
    return [...g]
  }
  const hit = (w: string) => {
    const g = group(w)
    if (g.some((x) => main.includes(x))) return 1
    if (g.some((x) => cat.includes(x))) return 0.4
    return 0
  }
  const score = (t: string[]) => t.reduce((s, w) => s + hit(w), 0) / t.length

  const res: Match[] = []
  for (const a of data.articles) {
    // Name in Teile ("Rigatoni / Nudeln" -> Alternativen), jeweils Wörter prüfen
    const parts = [a.name, ...(a.aliases ?? [])].flatMap((n) => n.split(/\s\/\s|\(|\)/)).map(tokens).filter((t) => t.length)
    let best = 0
    for (const t of parts) best = Math.max(best, score(t))
    // andere Marken desselben Artikels (Barcode-Namen) ähneln?
    for (const b of data.barcodes) {
      if (b.article_id !== a.id || !b.off_name) continue
      const bt = tokens(b.off_name)
      if (bt.length) best = Math.max(best, score(bt) * 0.9)
    }
    if (best > 0) res.push({ article: a, score: best })
  }
  return res.sort((x, y) => y.score - x.score).slice(0, 5)
}

/** Sicher genug für einen Vorschlag mit "Ja"-Knopf? */
export function confidentMatch(m: Match[]) {
  if (!m.length || m[0].score < 0.66) return null
  if (m[1] && m[1].score >= m[0].score) return null
  return m[0]
}
