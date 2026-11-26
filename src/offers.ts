// Angebote: kommen vom Supabase-Server (Funktion "angebote", holt jeden Morgen selbstständig).
// Live-Suche fragt zusätzlich direkt bei dm und Lidl nach.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Article } from './db'
import { normalize, synGroup, type Data } from './data'

export type Offer = {
  id?: number
  store: string
  title: string
  subtitle: string | null
  price: number | null
  old_price: number | null
  discount: string | null
  card_price: number | null
  unit: string | null
  base_price: string | null
  image: string | null
  url: string | null
  valid_text: string | null
  valid_to: string | null
  valid_from?: string | null
  source?: 'web' | 'pdf' | 'preischeck'
  article_id?: number | null
  kind: 'angebot' | 'preis'
  fetched_at?: string
}

const CACHE = 'offers-cache'
let mem: Offer[] | null = null

/** Gleiches Angebot taucht in mehreren Abschnitten auf -> das mit der längsten Gültigkeit behalten. */
function dedupe(list: Offer[]) {
  const by = new Map<string, Offer>()
  for (const o of list) {
    const k = `${o.store}|${o.title}|${o.price}`
    const old = by.get(k)
    if (!old || (o.valid_to ?? '') > (old.valid_to ?? '')) by.set(k, o)
  }
  const today = new Date().toLocaleDateString('sv-SE')
  return [...by.values()].filter((o) => !o.valid_to || o.valid_to >= today)
}

export async function loadOffers(force = false): Promise<Offer[]> {
  if (mem && !force) return mem
  try {
    const all: Offer[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('offers').select('*').range(from, from + 999)
      if (error) throw error
      all.push(...(data as Offer[]))
      if (!data || data.length < 1000) break
    }
    mem = dedupe(all.map((o) => ({ ...o, price: num(o.price), old_price: num(o.old_price), card_price: num(o.card_price) })))
    try { localStorage.setItem(CACHE, JSON.stringify(mem)) } catch { /* egal */ }
  } catch {
    try { mem = dedupe(JSON.parse(localStorage.getItem(CACHE) ?? '[]')) } catch { mem = [] }
  }
  return mem!
}
const num = (x: unknown) => (x == null ? null : Number(x))

export function useOffers() {
  const [offers, setOffers] = useState<Offer[] | null>(mem)
  useEffect(() => {
    let alive = true
    loadOffers().then((o) => alive && setOffers(o))
    return () => { alive = false }
  }, [])
  return offers
}

/** Rabatt-Text nur, wenn er wirklich etwas aussagt ("-38%", "2 € billiger"). */
export function discountLabel(o: Offer) {
  if (o.discount && /%|€/.test(o.discount)) return o.discount
  if (o.old_price && o.price && o.old_price > o.price) return `-${Math.round((1 - o.price / o.old_price) * 100)}%`
  return null
}

const GENERIC = new Set(['packung', 'beutel', 'flasche', 'dose', 'glas', 'tk', 'stk', 'stuck', 'frisch', 'basis', 'und', 'oder', 'mit', 'fur'])
const words = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w))
const stem = (w: string) => (w.length > 5 ? w.replace(/(en|er|n|s|e)$/, '') : w)

/** Passt ein Angebot zu einem Artikel? Alle Wörter eines Namens (oder Alias) müssen vorkommen, Synonyme zählen. */
export function offerMatches(a: Article, o: Offer) {
  const text = normalize(`${o.title} ${o.subtitle ?? ''}`)
  const names = [...a.name.split(/\s*[/,(]\s*/), ...(a.aliases ?? [])].map(words).filter((w) => w.length)
  // nur am Wortanfang zählen ("Pommes" soll nicht "Pommersche" finden), keine Mini-Synonyme wie "ol"
  const hit = (x: string) => x.length >= 3 && new RegExp(`(^|[^a-z])${stem(x)}(?![a-z]{4,})`).test(text)
  return names.some((ws) => ws.every((w) => synGroup(w).some(hit)))
}

export function offersFor(a: Article, offers: Offer[]) {
  return offers.filter((o) => (o.article_id != null ? o.article_id === a.id : offerMatches(a, o))).sort((x, y) => (x.price ?? 99) - (y.price ?? 99))
}

/** Artikel, die gerade gebraucht werden: Einkaufsliste, bald leer, unter Mindestbestand. */
export function neededArticles(data: Data) {
  const ids = new Set<number>()
  for (const s of data.shopping) if (s.status === 'open' && s.article_id != null) ids.add(s.article_id)
  for (const s of data.stock.values()) if (s.article.min_stock > 0 && s.total < s.article.min_stock) ids.add(s.article.id)
  return data.articles.filter((a) => ids.has(a.id))
}

export async function searchOffers(q: string): Promise<{ results: Offer[]; errors: Record<string, string> }> {
  const { data, error } = await supabase.functions.invoke<{ results: Offer[]; errors: Record<string, string> }>('angebote', { body: { mode: 'search', q } })
  if (error || !data) throw new Error('Die Suche klappt gerade nicht. Internet an?')
  return { results: data.results.map((o) => ({ ...o, price: num(o.price), old_price: num(o.old_price), card_price: num(o.card_price) })), errors: data.errors ?? {} }
}

// ---------- Einstellungen (pro Gerät) ----------
export type StoreInfo = { name: string; how: 'auto' | 'live' | 'ki' | 'gesperrt'; note: string }
export const STORES: StoreInfo[] = [
  { name: 'Kaufland', how: 'auto', note: 'Wochenangebote, jeden Morgen' },
  { name: 'Lidl', how: 'auto', note: 'Aktionsprospekt; Lebensmittel liest die KI aus dem Prospekt' },
  { name: 'Penny', how: 'auto', note: 'Wochenangebote, jeden Morgen' },
  { name: 'Norma', how: 'auto', note: 'Wochenangebote, jeden Morgen' },
  { name: 'dm', how: 'auto', note: 'Preischeck für deine Artikel (mehrmals täglich) + Suche (➤)' },
  { name: 'Aldi Süd', how: 'ki', note: 'Prospekt wird von der Gratis-KI ausgelesen' },
  { name: 'Rewe', how: 'gesperrt', note: 'Webseite blockt automatische Abrufe' },
  { name: 'Edeka', how: 'gesperrt', note: 'Webseite blockt automatische Abrufe' },
  { name: 'Netto', how: 'gesperrt', note: 'Webseite blockt automatische Abrufe' },
  { name: 'Rossmann', how: 'gesperrt', note: 'Webseite und Prospekt blocken automatische Abrufe' },
]
export type OfferPrefs = { plz: string; off: string[]; next: boolean }
const PREFS = 'offer-prefs'
export function getPrefs(): OfferPrefs {
  try {
    return { plz: '70378', off: [], next: true, ...JSON.parse(localStorage.getItem(PREFS) ?? '{}') }
  } catch {
    return { plz: '70378', off: [], next: true }
  }
}
export function savePrefs(p: OfferPrefs) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)) } catch { /* egal */ }
}
export const isFuture = (o: Offer) => !!o.valid_from && o.valid_from > new Date().toLocaleDateString('sv-SE')
/** Nach gewählten Läden filtern; künftige Angebote (ab nächster Woche) optional ausblenden. */
export function applyPrefs(list: Offer[], p: OfferPrefs) {
  return list.filter((o) => !p.off.includes(o.store) && (p.next || !isFuture(o)))
}
