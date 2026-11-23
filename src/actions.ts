import { db, nowIso, today, uuid, type Article, type Barcode, type DishItem, type Op, type ShoppingItem, type Source, type StockEntry } from './db'
import { requestSync, sync } from './sync'
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

async function closeAutoIfEnough(article: Article) {
  if ((await stockTotal(article.id)) < article.min_stock) return
  const open = await db.shopping.where('article_id').equals(article.id).filter((s) => s.status === 'open' && s.origin === 'auto').toArray()
  for (const s of open) await db.shopping.update(s.id, { status: 'done', done_at: nowIso() })
}

async function openAutoIfLow(article: Article) {
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
}

export type StockOpts = { ean?: string | null; variant?: string | null; purchasedAt?: string }

export async function addStock(article: Article, amount: number, locationId: number, bestBefore: string | null, opts: StockOpts = {}) {
  const entry: StockEntry = {
    id: uuid(),
    article_id: article.id,
    location_id: locationId,
    amount,
    best_before: bestBefore,
    purchased_at: opts.purchasedAt ?? today(),
    created_at: nowIso(),
    ean: opts.ean ?? null,
    variant: opts.variant?.trim() || null,
  }
  await db.transaction('rw', db.stock, db.shopping, db.outbox, async () => {
    await db.stock.put(entry)
    await db.outbox.add({
      op: { kind: 'add_stock', entry_id: entry.id, article_id: article.id, amount, location_id: locationId, best_before: bestBefore, ean: entry.ean, variant: entry.variant },
      created_at: nowIso(),
      tries: 0,
    })
    await closeAutoIfEnough(article)
  })
  requestSync()
  return entry
}

type Taken = { entry: StockEntry; amount: number }
export type ConsumeResult = { taken: number; undo: () => Promise<void> }

function undoer(article: Article, parts: Taken[]) {
  return async () => {
    for (const p of parts) {
      await addStock(article, p.amount, p.entry.location_id, p.entry.best_before, { ean: p.entry.ean, variant: p.entry.variant, purchasedAt: p.entry.purchased_at })
    }
  }
}

/** Zieht vom Eintrag mit dem ältesten MHD ab. */
export async function consume(article: Article, amount = 1, locationId: number | null = null): Promise<ConsumeResult> {
  const parts: Taken[] = []
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
      parts.push({ entry: r, amount: t })
    }
    const taken = parts.reduce((s, p) => s + p.amount, 0)
    if (taken === 0) return
    await db.outbox.add({
      op: { kind: 'consume', op_id: uuid(), article_id: article.id, amount: taken, location_id: locationId },
      created_at: nowIso(),
      tries: 0,
    })
    await openAutoIfLow(article)
  })
  requestSync()
  return { taken: parts.reduce((s, p) => s + p.amount, 0), undo: undoer(article, parts) }
}

/** Verbrauch aus genau dieser Packung. */
export async function consumeEntry(article: Article, entry: StockEntry, amount = 1): Promise<ConsumeResult> {
  const t = Math.min(entry.amount, amount)
  if (t <= 0) return { taken: 0, undo: async () => {} }
  await db.transaction('rw', db.stock, db.shopping, db.outbox, async () => {
    if (entry.amount - t <= 0) await db.stock.delete(entry.id)
    else await db.stock.update(entry.id, { amount: entry.amount - t })
    await db.outbox.add({ op: { kind: 'consume_entry', op_id: uuid(), entry_id: entry.id, amount: t }, created_at: nowIso(), tries: 0 })
    await openAutoIfLow(article)
  })
  requestSync()
  return { taken: t, undo: undoer(article, [{ entry, amount: t }]) }
}

/** Packung korrigieren (Menge, MHD, Ort, Sorte). Menge 0 = entfernen. */
export async function updateEntry(article: Article, entry: StockEntry, patch: Partial<Pick<StockEntry, 'amount' | 'best_before' | 'location_id' | 'variant'>>) {
  await db.transaction('rw', db.stock, db.shopping, db.outbox, async () => {
    if (patch.amount != null && patch.amount <= 0) await db.stock.delete(entry.id)
    else await db.stock.update(entry.id, patch)
    await db.outbox.add({ op: { kind: 'stock_update', id: entry.id, patch: { ...patch, amount: patch.amount != null ? Math.max(0, patch.amount) : undefined } }, created_at: nowIso(), tries: 0 })
    if (patch.amount != null) {
      await openAutoIfLow(article)
      await closeAutoIfEnough(article)
    }
  })
  requestSync()
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

export async function removeBarcode(ean: string) {
  await db.barcodes.delete(ean)
  await enqueue({ kind: 'barcode_delete', ean })
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
    carted_at: null,
  }
  await db.shopping.put(row)
  await enqueue({ kind: 'shopping_add', row })
}

export async function updateShopping(item: ShoppingItem, patch: Partial<Pick<ShoppingItem, 'status' | 'done_at' | 'amount' | 'carted_at' | 'source'>>) {
  if (item.local_only) {
    // vorläufiger Eintrag: als echten Eintrag anlegen
    const { local_only: _l, ...row } = { ...item, ...patch, origin: 'manual' as const }
    await db.shopping.put(row)
    await enqueue({ kind: 'shopping_add', row })
    return
  }
  await db.shopping.update(item.id, patch)
  await enqueue({ kind: 'shopping_update', id: item.id, patch })
}

export async function toggleShopping(item: ShoppingItem) {
  const patch = item.status === 'open' ? { status: 'done' as const, done_at: nowIso() } : { status: 'open' as const, done_at: null }
  if (item.local_only) return void (await db.shopping.update(item.id, patch))
  await updateShopping(item, patch)
}

export async function setCarted(items: ShoppingItem[], on: boolean) {
  for (const it of items) await updateShopping(it, { carted_at: on ? nowIso() : null })
}

export async function clearDoneShopping() {
  const done = await db.shopping.where('status').equals('done').toArray()
  if (!done.length) return
  await db.shopping.bulkDelete(done.map((d) => d.id))
  const ids = done.filter((d) => !d.local_only).map((d) => d.id)
  if (ids.length) await enqueue({ kind: 'shopping_delete', ids })
}

export async function deleteShopping(item: ShoppingItem) {
  await db.shopping.delete(item.id)
  if (!item.local_only) await enqueue({ kind: 'shopping_delete', ids: [item.id] })
}

export async function updateArticle(id: number, patch: Partial<Article>) {
  await db.articles.update(id, patch)
  await enqueue({ kind: 'article_update', id, patch })
}

/** Neuer Katalogartikel – braucht Netz, weil die ID vom Server kommt. */
export async function createArticle(
  fields: Pick<Article, 'name' | 'default_location_id' | 'source' | 'unit' | 'category'> & { min_stock?: number; reorder_qty?: number; aliases?: string[]; image_url?: string | null },
) {
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

// ---------- Rezepte (brauchen Netz, IDs kommen vom Server) ----------
export type DishDraft = { id?: number; name: string; servings: number; hint: string | null; instructions: string | null; origin: string }
export type DishItemDraft = Pick<DishItem, 'article_id' | 'free_text' | 'optional' | 'alt_group' | 'amount' | 'unit'>

export async function saveDish(d: DishDraft, items: DishItemDraft[]) {
  const fields = { name: d.name.trim(), servings: d.servings, hint: d.hint, instructions: d.instructions, origin: d.origin }
  let id = d.id
  if (id) {
    const r = await supabase.from('dishes').update(fields).eq('id', id)
    if (r.error) throw r.error
    const del = await supabase.from('dish_items').delete().eq('dish_id', id)
    if (del.error) throw del.error
  } else {
    const r = await supabase.from('dishes').insert(fields).select('id').single()
    if (r.error) throw new Error(/duplicate/.test(r.error.message) ? 'Ein Rezept mit dem Namen gibt es schon.' : r.error.message)
    id = r.data.id as number
  }
  if (items.length) {
    const r = await supabase.from('dish_items').insert(items.map((i) => ({ ...i, dish_id: id })))
    if (r.error) throw r.error
  }
  await sync()
  return id
}

export async function deleteDish(id: number) {
  const r = await supabase.from('dishes').delete().eq('id', id)
  if (r.error) throw r.error
  await db.dishes.delete(id)
  await db.dishItems.where('dish_id').equals(id).delete()
  await sync()
}

// ---------- Open Food Facts ----------
export type OffProduct = { name: string | null; brand: string | null; quantity: string | null; image: string | null; generic: string | null; categories: string | null }

export async function lookupOff(ean: string): Promise<OffProduct | null> {
  try {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=product_name,product_name_de,generic_name_de,generic_name,brands,quantity,image_front_small_url,categories`,
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
      generic: p.generic_name_de || p.generic_name || null,
      categories: p.categories || null,
    }
  } catch {
    return null
  }
}

export const offVariant = (off: OffProduct | null) => (off ? [off.brand, off.name].filter(Boolean).join(' – ') || null : null)
