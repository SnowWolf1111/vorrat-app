import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { db, type Op } from './db'

// Abgleich: erst lokale Änderungen hochladen (Warteschlange), dann alles frisch holen.
// Die Datenmenge ist klein (< 1000 Zeilen), deshalb wird komplett neu geladen.

type SyncState = { state: 'idle' | 'syncing' | 'offline' | 'error'; lastSync: number | null; message?: string }

let status: SyncState = { state: navigator.onLine ? 'idle' : 'offline', lastSync: null }
const listeners = new Set<() => void>()
function setStatus(s: Partial<SyncState>) {
  status = { ...status, ...s }
  listeners.forEach((l) => l())
}
export function useSyncStatus() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  )
}

const isNetworkError = (e: { message?: string; code?: string } | null) =>
  !!e && !e.code && /fetch|network|load failed/i.test(e.message ?? '')

async function pushOp(op: Op) {
  switch (op.kind) {
    case 'add_stock':
      return (
        await supabase.rpc('add_stock', {
          p_entry_id: op.entry_id,
          p_article_id: op.article_id,
          p_amount: op.amount,
          p_location_id: op.location_id,
          p_best_before: op.best_before,
        })
      ).error
    case 'consume':
      return (
        await supabase.rpc('consume_stock', {
          p_article_id: op.article_id,
          p_amount: op.amount,
          p_op_id: op.op_id,
          p_location_id: op.location_id,
        })
      ).error
    case 'barcode':
      return (await supabase.from('barcodes').upsert(op.row)).error
    case 'shopping_add':
      return (await supabase.from('shopping_list').upsert(op.row)).error
    case 'shopping_update':
      return (await supabase.from('shopping_list').update(op.patch).eq('id', op.id)).error
    case 'shopping_delete':
      return (await supabase.from('shopping_list').delete().in('id', op.ids)).error
    case 'article_update':
      return (await supabase.from('articles').update(op.patch).eq('id', op.id)).error
  }
}

async function pull() {
  const q = await Promise.all([
    supabase.from('locations').select('*').order('sort'),
    supabase.from('articles').select('*').eq('active', true),
    supabase.from('barcodes').select('ean, article_id, off_name, off_brand, off_quantity, off_image_url'),
    supabase.from('stock_entries').select('id, article_id, location_id, amount, best_before, purchased_at, created_at').gt('amount', 0),
    supabase.from('shopping_list').select('*'),
    supabase.from('dishes').select('*'),
    supabase.from('dish_items').select('*'),
  ])
  const err = q.find((r) => r.error)?.error
  if (err) throw err
  const [locations, articles, barcodes, stock, shopping, dishes, dishItems] = q.map((r) => r.data ?? [])
  const num = <T extends Record<string, unknown>>(rows: T[], keys: string[]) =>
    rows.map((r) => {
      const o: Record<string, unknown> = { ...r }
      for (const k of keys) if (o[k] != null) o[k] = Number(o[k])
      return o as T
    })

  return db.transaction('rw', [db.locations, db.articles, db.barcodes, db.stock, db.shopping, db.dishes, db.dishItems, db.outbox], async () => {
    // Neue lokale Änderungen während des Ladens? Dann nicht überschreiben, nächste Runde.
    if ((await db.outbox.count()) > 0) return false
    await Promise.all([db.locations.clear(), db.articles.clear(), db.barcodes.clear(), db.stock.clear(), db.shopping.clear(), db.dishes.clear(), db.dishItems.clear()])
    await db.locations.bulkPut(locations as never[])
    await db.articles.bulkPut(num(articles, ['min_stock', 'reorder_qty', 'amazon_price', 'rewe_price']) as never[])
    await db.barcodes.bulkPut(barcodes as never[])
    await db.stock.bulkPut(num(stock, ['amount']) as never[])
    await db.shopping.bulkPut(num(shopping, ['amount']) as never[])
    await db.dishes.bulkPut(dishes as never[])
    await db.dishItems.bulkPut(dishItems as never[])
    return true
  })
}

let running = false
let again = false

export async function sync(): Promise<void> {
  if (running) {
    again = true
    return
  }
  if (!navigator.onLine) return setStatus({ state: 'offline' })
  const { data } = await supabase.auth.getSession()
  if (!data.session) return
  running = true
  setStatus({ state: 'syncing' })
  try {
    for (let round = 0; round < 3; round++) {
      const rows = await db.outbox.orderBy('seq').toArray()
      for (const row of rows) {
        const error = await pushOp(row.op)
        if (error && isNetworkError(error)) throw error
        if (error) {
          // Server lehnt ab (z. B. Artikel gelöscht): nach 3 Versuchen verwerfen
          const tries = row.tries + 1
          if (tries >= 3) {
            console.warn('Änderung verworfen', row.op, error)
            await db.outbox.delete(row.seq!)
          } else {
            await db.outbox.update(row.seq!, { tries, error: error.message })
            throw error
          }
        } else {
          await db.outbox.delete(row.seq!)
        }
      }
      if (await pull()) break
    }
    setStatus({ state: 'idle', lastSync: Date.now(), message: undefined })
  } catch (e) {
    const err = e as { message?: string; code?: string }
    setStatus(isNetworkError(err) || !navigator.onLine ? { state: 'offline' } : { state: 'error', message: err.message })
  } finally {
    running = false
    if (again) {
      again = false
      setTimeout(sync, 200)
    }
  }
}

let timer: number | undefined
export function requestSync(delay = 400) {
  clearTimeout(timer)
  timer = window.setTimeout(sync, delay)
}

export function startAutoSync() {
  window.addEventListener('online', () => requestSync(0))
  window.addEventListener('offline', () => setStatus({ state: 'offline' }))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && requestSync(0))
  setInterval(() => document.visibilityState === 'visible' && requestSync(0), 60_000)
  requestSync(0)
}
