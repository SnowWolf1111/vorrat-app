// Nur für lokale Tests (npm run dev, Adresse mit ?demo): Testdaten ohne Login.
import { db, nowIso, type Article } from './db'

export async function seedDemo() {
  if ((await db.articles.count()) > 0) return
  await db.locations.bulkPut([
    { id: 1, name: 'TK Keller', is_frozen: true, sort: 1 },
    { id: 2, name: 'TK Küche', is_frozen: true, sort: 2 },
    { id: 3, name: 'Kühlschrank', is_frozen: false, sort: 3 },
    { id: 4, name: 'Vorratsschrank', is_frozen: false, sort: 4 },
  ])
  const base = { code: null, category: null, amazon_asin: null, amazon_product: null, rewe_product: null, local_ref: null, note: null, aliases: [], active: true }
  const arts: Article[] = [
    { ...base, id: 1, name: 'Tomatenmark', default_location_id: 4, unit: 'Tube/Dose', min_stock: 2, reorder_qty: 3, source: 'Amazon', amazon_price: 1.07, rewe_price: 0.95, amazon_asin: 'B07TESTASIN' },
    { ...base, id: 2, name: 'Rigatoni / Nudeln', default_location_id: 4, unit: 'Packung 500 g', min_stock: 2, reorder_qty: 4, source: 'Amazon', amazon_price: 0.79, rewe_price: 0.69 },
    { ...base, id: 3, name: 'Chicken Nuggets', default_location_id: 1, unit: 'Packung', min_stock: 1, reorder_qty: 2, source: 'Metro', amazon_price: null, rewe_price: null },
    { ...base, id: 4, name: 'Pommes', default_location_id: 1, unit: 'Beutel', min_stock: 1, reorder_qty: 2, source: 'Rewe', amazon_price: null, rewe_price: 1.49 },
    { ...base, id: 5, name: 'Kochcreme / H-Sahne 15 %', default_location_id: 4, unit: 'Packung', min_stock: 3, reorder_qty: 6, source: 'Rewe', amazon_price: 0.89, rewe_price: 0.69 },
    { ...base, id: 6, name: 'Hackfleisch gemischt', default_location_id: 1, unit: 'Packung 500 g', min_stock: 1, reorder_qty: 2, source: 'Rewe', amazon_price: null, rewe_price: 4.49 },
    { ...base, id: 7, name: 'Reibekäse (Pizza/Gouda)', default_location_id: 3, unit: 'Packung 250 g', min_stock: 1, reorder_qty: 2, source: 'Rewe', amazon_price: null, rewe_price: 1.79 },
    { ...base, id: 8, name: 'Zwiebelwürfel (TK)', default_location_id: 2, unit: 'Beutel', min_stock: 1, reorder_qty: 1, source: 'Metro', amazon_price: null, rewe_price: null },
  ]
  await db.articles.bulkPut(arts)
  const d = (days: number) => {
    const x = new Date()
    x.setDate(x.getDate() + days)
    return x.toLocaleDateString('sv-SE')
  }
  await db.stock.bulkPut([
    { id: 's1', article_id: 2, location_id: 4, amount: 3, best_before: d(200), purchased_at: d(-10), created_at: nowIso() },
    { id: 's2', article_id: 3, location_id: 1, amount: 2, best_before: d(5), purchased_at: d(-30), created_at: nowIso() },
    { id: 's3', article_id: 6, location_id: 1, amount: 2, best_before: d(-2), purchased_at: d(-60), created_at: nowIso() },
    { id: 's4', article_id: 7, location_id: 3, amount: 1, best_before: d(12), purchased_at: d(-3), created_at: nowIso() },
  ])
  await db.shopping.bulkPut([
    { id: 'l1', article_id: 1, free_text: null, amount: 3, source: 'Amazon', origin: 'auto', status: 'open', note: null, created_at: nowIso(), done_at: null },
    { id: 'l2', article_id: 5, free_text: null, amount: 6, source: 'Rewe', origin: 'auto', status: 'open', note: null, created_at: nowIso(), done_at: null },
    { id: 'l3', article_id: 2, free_text: null, amount: 4, source: 'Amazon', origin: 'manual', status: 'open', note: null, created_at: nowIso(), done_at: null },
    { id: 'l4', article_id: null, free_text: 'Sirup Waldmeister', amount: 1, source: null, origin: 'alexa', status: 'open', note: null, created_at: nowIso(), done_at: null },
  ])
}
