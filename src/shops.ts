import type { Article } from './db'

const clean = (s: string) => s.replace(/\(.*?\)/g, '').replace(/\s\/\s.*/, '').trim()

export const amazonSearchUrl = (a: Article) => `https://www.amazon.de/s?k=${encodeURIComponent(a.amazon_product ?? clean(a.name))}&i=grocery`
export const reweSearchUrl = (a: Pick<Article, 'name' | 'rewe_product'>) => `https://www.rewe.de/shop/productList?search=${encodeURIComponent(a.rewe_product ?? clean(a.name))}`

/** ASIN aus einem Amazon-Link oder geteiltem Text holen. */
export function extractAsin(s: string | null | undefined): string | null {
  if (!s) return null
  const m = s.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|[?&]asin=)([A-Z0-9]{10})/i) ?? s.match(/^\s*([B][0-9A-Z]{9})\s*$/i)
  return m ? m[1].toUpperCase() : null
}

export function amazonCartUrl(items: { asin: string; qty: number }[]) {
  const p = new URLSearchParams()
  items.forEach((it, i) => {
    p.set(`ASIN.${i + 1}`, it.asin)
    p.set(`Quantity.${i + 1}`, String(Math.max(1, Math.round(it.qty))))
  })
  return `https://www.amazon.de/gp/aws/cart/add.html?${p.toString()}`
}
