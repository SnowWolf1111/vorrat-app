import { db, nowIso, today, uuid, type Article, type Barcode, type Op, type ShoppingItem, type Source, type StockEntry } from './db'
import { requestSync } from './sync'
import { supabase } from './supabase'

// Jede Aktion ändert sofort die lokale Kopie (läuft auch offline) und reiht die
// Änderung in die Warteschlange ein. Der Abgleich schickt sie später an Supabase.

async function enqueue(op: Op) {
  await db.outbox.add({ op, created_at: nowIso(), tries: 0 })
  requestSync()
}

export const sortFifo = (a: StockEntry, b: StockEntry) =>
  (a.best_before ?? '9999-12-31').localeCompare(b.best_before ?? '9999-12-31') ||
  a.purchased_at.localeCompare(b.purchased_at) ||
  a.created_at.localeCompare(b.created_at)

async function stockTotal(articleId: number) {
  const rows = await db.stock.where('article_id').equals(articleId).toArray()
  return rows.reduce((s, r) => s + r.amount, 0)
}

export async function addStock(article: Article, amount: number, locationId: number, bestBefore: string | null) {
  const entry: StockEntry = {
    id: uuid(),
    article_id: article.id,
    location_id: locationId,
    amount,
    best_before: bestBefore,
    purchased_at: today(),
    created_at: nowIso(),
  }
  await db.transaction('rw', db.stock, db.shopping, db.outbox, async () => {
    await db.stock.put(entry)
    await db.outbox.add({
      op: { kind: 'add_stock', entry_id: entry.id, article_id: article.id, amount, location_id: locationId, best_before: bestBefore },
      created_at: nowIso(),
      tries: 0,
    })
    // wieder genug da -> automatischen Einkaufslisten-Eintrag abhaken (macht der Server genauso)
    if ((await stockTotal(article.id)) >= article.min_stock) {
      const open = await db.shopping.where('article_id').equals(article.id).filter((s) => s.status === 'open' && s.origin === 'auto').toArray()
      for (const s of open) await db.shopping.update(s.id, { status: 'done', done_at: nowIso() })
    }
  })
  requestSync()
  return entry
}

/** Zieht vom Eintrag mit dem ältesten MHD ab. Gibt die abgezogene Menge zurück. */
export async function consume(article: Article, amount = 1, locationId: number | null = null) {
  let taken = 0
  await db.transaction('rw', db.stock, db.shopping, db.outbox, async () => {
    const rows = (await db.stock.where('article_id').equals(article.id).toArray())
      .filter((r) => r.amount > 0 && (locationId == null || r.location_id === locationId))
      .sort(sortFifo)
    let rest = amount
    for (const r of rows) {
      if (rest <= 0) break
      const t = Math.min(r.amount, rest)
      if (r.amount - t <= 0) await db.stock.delete(r.id)
      else await db.stock.update(r.id, { amount: r.amount - t })
      rest -= t
      taken += t
    }
    if (taken === 0) return
    await db.outbox.add({
      op: { kind: 'consume', op_id: uuid(), article_id: article.id, amount: taken, location_id: locationId },
      created_at: nowIso(),
      tries: 0,
    })
    // unter Mindestbestand -> vorläufig auf die Einkaufsliste (der Server legt den echten Eintrag an)
    const total = await stockTotal(article.id)
    const hasOpen = await db.shopping.where('article_id').equals(article.id).filter((s) => s.status === 'open').count()
    if (total < article.min_stock && !hasOpen) {
      await db.shopping.put({
        id: uuid(),
        article_id: article.id,
        free_text: null,
        amount: article.reorder_qty,
        source: article.source,
        origin: 'auto',
        status: 'open',
        note: null,
        created_at: nowIso(),
        done_at: null,
        local_only: true,
      })
    }
  })
  requestSync()
  return taken
}

export async function assignBarcode(ean: string, articleId: number, off?: Partial<Barcode>) {
  const row: Barcode = {
    ean,
    article_id: articleId,
    off_name: off?.off_name ?? null,
    off_brand: off?.off_brand ?? null,
    off_quantity: off?.off_quantity ?? null,
    off_image_url: off?.off_image_url ?? null,
  }
  await db.barcodes.put(row)
  await enqueue({ kind: 'barcode', row })
}

export async function addShopping(input: { article?: Article; text?: string; amount?: number; source?: Source | null }) {
  const a = input.article
  if (a) {
    const open = await db.shopping.where('article_id').equals(a.id).filter((s) => s.status === 'open').first()
    if (open) {
      const amount = open.amount + (input.amount ?? a.reorder_qty)
      await db.shopping.update(open.id, { amount })
      if (!open.local_only) await enqueue({ kind: 'shopping_update', id: open.id, patch: { amount } })
      return
    }
  }
  const row: Omit<ShoppingItem, 'local_only'> = {
    id: uuid(),
    article_id: a?.id ?? null,
    free_text: a ? null : (input.text ?? '').trim(),
    amount: input.amount ?? a?.reorder_qty ?? 1,
    source: input.source ?? a?.source ?? null,
    origin: 'manual',
    status: 'open',
    note: null,
    created_at: nowIso(),
    done_at: null,
  }
  await db.shopping.put(row)
  await enqueue({ kind: 'shopping_add', row })
}

export async function toggleShopping(item: ShoppingItem) {
  const patch = item.status === 'open' ? { status: 'done' as const, done_at: nowIso() } : { status: 'open' as const, done_at: null }
  await db.shopping.update(item.id, patch)
  if (item.local_only) return
  await enqueue({ kind: 'shopping_update', id: item.id, patch })
}

export async function clearDoneShopping() {
  const done = await db.shopping.where('status').equals('done').toArray()
  if (!done.length) return
  await db.shopping.bulkDelete(done.map((d) => d.id))
  const ids = done.filter((d) => !d.local_only).map((d) => d.id)
  if (ids.length) await enqueue({ kind: 'shopping_delete', ids })
}

export async function updateArticle(id: number, patch: Partial<Article>) {
  await db.articles.update(id, patch)
  await enqueue({ kind: 'article_update', id, patch })
}

/** Neuer Katalogartikel – braucht Netz, weil die ID vom Server kommt. */
export async function createArticle(fields: Pick<Article, 'name' | 'default_location_id' | 'source' | 'unit' | 'category'> & { min_stock?: number; reorder_qty?: number }) {
  const { data, error } = await supabase
    .from('articles')
    .insert({ min_stock: 0, reorder_qty: 1, ...fields })
    .select('*')
    .single()
  if (error) throw new Error(navigator.onLine ? error.message : 'Neue Artikel brauchen Internet. Bitte später anlegen.')
  const a = { ...data, min_stock: Number(data.min_stock), reorder_qty: Number(data.reorder_qty) } as Article
  await db.articles.put(a)
  return a
}

// ---------- Open Food Facts ----------
export type OffProduct = { name: string | null; brand: string | null; quantity: string | null; image: string | null }

export async function lookupOff(ean: string): Promise<OffProduct | null> {
  try {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=product_name,product_name_de,brands,quantity,image_front_small_url`,
    )
    if (!r.ok) return null
    const j = await r.json()
    if (j.status !== 1 || !j.product) return null
    const p = j.product
    return {
      name: p.product_name_de || p.product_name || null,
      brand: p.brands ? String(p.brands).split(',')[0].trim() : null,
      quantity: p.quantity || null,
      image: p.image_front_small_url || null,
    }
  } catch {
    return null
  }
}
