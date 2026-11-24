import Dexie, { type Table } from 'dexie'

// Lokale Kopie der Supabase-Daten (offline nutzbar) + Warteschlange für Änderungen

export type Source = 'Amazon' | 'Rewe' | 'Metro' | 'Vor Ort'
export const SOURCES: Source[] = ['Rewe', 'Amazon', 'Metro', 'Vor Ort']

export type Location = { id: number; name: string; is_frozen: boolean; sort: number }

export type Article = {
  id: number
  code: string | null
  name: string
  category: string | null
  default_location_id: number | null
  unit: string | null
  min_stock: number
  reorder_qty: number
  source: Source | null
  amazon_asin: string | null
  amazon_product: string | null
  amazon_price: number | null
  rewe_product: string | null
  rewe_price: number | null
  local_ref: string | null
  note: string | null
  aliases: string[]
  active: boolean
  image_url?: string | null
}

export type Barcode = {
  ean: string
  article_id: number
  off_name: string | null
  off_brand: string | null
  off_quantity: string | null
  off_image_url: string | null
}

export type StockEntry = {
  id: string
  article_id: number
  location_id: number
  amount: number
  best_before: string | null // YYYY-MM-DD
  purchased_at: string
  created_at: string
  ean?: string | null
  variant?: string | null // Marke/Sorte
}

export type ShoppingItem = {
  id: string
  article_id: number | null
  free_text: string | null
  amount: number
  source: Source | null
  origin: 'auto' | 'alexa' | 'manual' | 'bald_leer'
  status: 'open' | 'done'
  note: string | null
  created_at: string
  done_at: string | null
  carted_at?: string | null // in einen Warenkorb gelegt
  local_only?: boolean // nur Anzeige bis zum nächsten Abgleich
}

export type Dish = { id: number; name: string; hint: string | null; sort: number; servings: number; instructions: string | null; origin: string }
export type DishItem = {
  id: number
  dish_id: number
  article_id: number | null
  free_text: string | null
  optional: boolean
  alt_group: number | null
  amount: number | null
  unit: string | null
}

export type Op =
  | { kind: 'add_stock'; entry_id: string; article_id: number; amount: number; location_id: number; best_before: string | null; ean?: string | null; variant?: string | null }
  | { kind: 'consume_entry'; op_id: string; entry_id: string; amount: number }
  | { kind: 'stock_update'; id: string; patch: Partial<Pick<StockEntry, 'amount' | 'best_before' | 'location_id' | 'variant'>> }
  | { kind: 'barcode_delete'; ean: string }
  | { kind: 'consume'; op_id: string; article_id: number; amount: number; location_id: number | null }
  | { kind: 'barcode'; row: Barcode }
  | { kind: 'shopping_add'; row: Omit<ShoppingItem, 'local_only'> }
  | { kind: 'shopping_update'; id: string; patch: Partial<Pick<ShoppingItem, 'status' | 'done_at' | 'amount' | 'carted_at' | 'source'>> }
  | { kind: 'shopping_delete'; ids: string[] }
  | { kind: 'article_update'; id: number; patch: Partial<Article> }

export type OutboxRow = { seq?: number; op: Op; created_at: string; tries: number; error?: string }

class VorratDB extends Dexie {
  locations!: Table<Location, number>
  articles!: Table<Article, number>
  barcodes!: Table<Barcode, string>
  stock!: Table<StockEntry, string>
  shopping!: Table<ShoppingItem, string>
  dishes!: Table<Dish, number>
  dishItems!: Table<DishItem, number>
  outbox!: Table<OutboxRow, number>
  meta!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('vorrat')
    this.version(1).stores({
      locations: 'id',
      articles: 'id, name',
      barcodes: 'ean, article_id',
      stock: 'id, article_id, location_id',
      shopping: 'id, article_id, status',
      dishes: 'id',
      dishItems: 'id, dish_id',
      outbox: '++seq',
      meta: 'key',
    })
  }
}

export const db = new VorratDB()

export const uuid = () => crypto.randomUUID()
export const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD lokal
export const nowIso = () => new Date().toISOString()
