// Angebote holen – läuft auf dem Supabase-Server, unabhängig von Claude und vom PC.
//  POST {mode:"refresh"}          -> Wochenangebote der Läden holen und in "offers" speichern (täglich per Zeitplan)
//  POST {mode:"search", q:"..."}  -> Live-Suche bei den Läden + gespeicherte Angebote
//  POST {mode:"probe"}            -> Testet, welche Läden vom Server aus erreichbar sind
// Es werden nur öffentlich sichtbare Seiten gelesen; gesperrte Seiten werden nicht umgangen.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

export type Offer = {
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
  kind: 'angebot' | 'preis'
}

const get = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(20000) })

const strip = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
const num = (s: string | null | undefined) => {
  if (!s) return null
  const m = s.replace(',', '.').match(/\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}
const cls = (chunk: string, c: string) => {
  const m = chunk.match(new RegExp(`class="${c}"[^>]*>([\\s\\S]*?)</div>`))
  return m ? strip(m[1]) || null : null
}

/** "gültig vom 24.11. bis 29.11." / "gültig am 24.11." -> letzter Tag als YYYY-MM-DD */
function validTo(t: string | null): string | null {
  if (!t) return null
  const all = [...t.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/g)]
  const m = all.at(-1)
  if (!m) return null
  const now = new Date()
  let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : now.getFullYear()
  const mo = Number(m[2])
  if (!m[3] && mo < now.getMonth() + 1 - 6) y++ // Jahreswechsel
  return `${y}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
}

// ---------- Kaufland: Wochenangebote (öffentliche Angebotsseite) ----------
async function kaufland(): Promise<Offer[]> {
  const out = new Map<string, Offer>()
  for (const week of ['current', 'next']) {
    const r = await get(`https://filiale.kaufland.de/angebote/uebersicht.html?kloffer-week=${week}`)
    if (!r.ok) {
      if (week === 'current') throw new Error(`Kaufland ${r.status}`)
      continue
    }
    const h = await r.text()
    // Gültigkeit je Abschnitt
    const heads = [...h.matchAll(/k-product-section__subheadline">([^<]*)</g)].map((m) => ({ at: m.index!, text: strip(m[1]) }))
    const parts = h.split('<a class="k-product-tile"')
    let pos = parts[0].length
    for (const p of parts.slice(1)) {
      const at = pos
      pos += p.length + 26
      const chunk = p.slice(0, 6000)
      const brand = cls(chunk, 'k-product-tile__title')
      const sub = cls(chunk, 'k-product-tile__subtitle')
      if (!brand && !sub) continue
      const normal = chunk.split('k-product-tile__pricetags-loyalty')[0]
      const loyalty = chunk.split('k-product-tile__pricetags-loyalty')[1] ?? ''
      const price = num(cls(normal, 'k-price-tag__price'))
      const old = num(normal.match(/old-price-line-through">([^<]*)</)?.[1])
      const card = num(cls(loyalty, 'k-price-tag__price'))
      const head = heads.filter((x) => x.at < at).at(-1)?.text ?? null
      const img = chunk.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? null
      const o: Offer = {
        store: 'Kaufland',
        title: [brand, sub].filter(Boolean).join(' '),
        subtitle: sub,
        price,
        old_price: old,
        discount: cls(normal, 'k-price-tag__discount'),
        card_price: card && card !== price ? card : null,
        unit: cls(chunk, 'k-product-tile__unit-price'),
        base_price: cls(chunk, 'k-product-tile__base-price'),
        image: img,
        url: 'https://filiale.kaufland.de/angebote/uebersicht.html',
        valid_text: head,
        valid_to: validTo(head),
        kind: 'angebot',
      }
      if (o.price == null) continue
      const key = `${o.title}|${o.price}|${o.valid_text}`
      if (!out.has(key)) out.set(key, o)
    }
  }
  return [...out.values()]
}

// ---------- dm: Produktsuche (öffentliche Suche der dm-Webseite) ----------
// deno-lint-ignore no-explicit-any
function dmPrice(p: any): { price: number | null; old: number | null } {
  const t = p.tileData ?? p
  const cand = [t?.price?.price?.current?.value, t?.price?.current?.value, t?.price?.value, p.price?.value, p.price]
  const price = cand.map((x) => (typeof x === 'number' ? x : num(typeof x === 'string' ? x : null))).find((x) => x != null) ?? null
  const oldC = [t?.price?.price?.previous?.value, t?.price?.strikethrough?.value, p.strikethroughPrice?.value]
  const old = oldC.map((x) => (typeof x === 'number' ? x : num(typeof x === 'string' ? x : null))).find((x) => x != null) ?? null
  return { price, old }
}
async function dm(q: string): Promise<Offer[]> {
  const r = await get(`https://product-search.services.dmtech.com/de/search?query=${encodeURIComponent(q)}&pageSize=12`, {
    Accept: 'application/json',
    Origin: 'https://www.dm.de',
    Referer: 'https://www.dm.de/',
  })
  if (!r.ok) throw new Error(`dm ${r.status}`)
  const j = await r.json()
  // deno-lint-ignore no-explicit-any
  return (j.products ?? []).map((p: any) => {
    const { price, old } = dmPrice(p)
    const t = p.tileData ?? {}
    const title = [p.brandName, p.title].filter(Boolean).join(' ')
    return {
      store: 'dm',
      title,
      subtitle: p.title ?? null,
      price,
      old_price: old && price && old > price ? old : null,
      discount: null,
      card_price: null,
      unit: null,
      base_price: t?.price?.infos?.join?.(' ') ?? null,
      image: t?.images?.[0]?.tileSrc ?? t?.images?.[0]?.src ?? p.imageUrlTemplates?.[0]?.replace('{transformations}', 'f_auto,q_auto,c_fit,h_200,w_200') ?? null,
      url: p.relativeProductUrl ? `https://www.dm.de${p.relativeProductUrl}` : t?.self ? `https://www.dm.de${t.self}` : `https://www.dm.de/search?query=${encodeURIComponent(q)}`,
      valid_text: null,
      valid_to: null,
      kind: old && price && old > price ? 'angebot' : 'preis',
    } as Offer
  }).filter((o: Offer) => o.title)
}

// ---------- Lidl: Online-Suche (vor allem Non-Food) ----------
async function lidl(q: string): Promise<Offer[]> {
  const r = await get(`https://www.lidl.de/q/api/search?q=${encodeURIComponent(q)}&fetchsize=12&locale=de_DE&assortment=DE&version=v2.0.0`, { Accept: 'application/json' })
  if (!r.ok) throw new Error(`Lidl ${r.status}`)
  const j = await r.json()
  // deno-lint-ignore no-explicit-any
  return (j.items ?? []).map((it: any) => it.gridbox?.data).filter(Boolean).map((d: any) => {
    const pr = d.price ?? {}
    const old = pr.discount?.deletedPrice ?? null
    return {
      store: 'Lidl',
      title: d.fullTitle ?? d.title,
      subtitle: d.category?.split('/').at(-1) ?? null,
      price: typeof pr.price === 'number' ? pr.price : null,
      old_price: old,
      discount: pr.discount?.discountText ?? null,
      card_price: null,
      unit: pr.packaging?.text ?? null,
      base_price: pr.basePrice?.text ?? null,
      image: d.image ?? null,
      url: d.canonicalUrl ? `https://www.lidl.de${d.canonicalUrl}` : null,
      valid_text: null,
      valid_to: null,
      kind: old ? 'angebot' : 'preis',
    } as Offer
  }).filter((o: Offer) => o.title && o.price != null)
}

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').split(/[^a-z0-9]+/).filter((w) => w.length >= 3)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const body = await req.json().catch(() => ({}))
    const mode = body.mode ?? 'refresh'

    if (mode === 'probe') {
      const tests: Record<string, string> = {
        kaufland: 'https://filiale.kaufland.de/angebote/uebersicht.html?kloffer-week=current',
        dm: 'https://product-search.services.dmtech.com/de/search?query=zahnpasta&pageSize=2',
        lidl: 'https://www.lidl.de/q/api/search?q=kaffee&fetchsize=2&locale=de_DE&assortment=DE&version=v2.0.0',
        penny: 'https://www.penny.de/angebote',
        norma: 'https://www.norma-online.de/de/angebote/',
        aldinord: 'https://www.aldi-nord.de/angebote.html',
        globus: 'https://www.globus.de/',
        rossmann: 'https://www.rossmann.de/de/search/?text=zahnpasta',
        rewe: 'https://www.rewe.de/angebote/',
        netto: 'https://www.netto-online.de/filialangebote',
      }
      const res: Record<string, string> = {}
      await Promise.all(Object.entries(tests).map(async ([k, u]) => {
        try {
          const r = await get(u, k === 'dm' ? { Accept: 'application/json', Origin: 'https://www.dm.de', Referer: 'https://www.dm.de/' } : {})
          const t = await r.text()
          res[k] = `${r.status} ${t.length}`
        } catch (e) {
          res[k] = 'Fehler ' + String(e).slice(0, 80)
        }
      }))
      return json(res)
    }

    if (mode === 'refresh') {
      const report: Record<string, string> = {}
      const sources: [string, () => Promise<Offer[]>][] = [['Kaufland', kaufland]]
      for (const [store, fn] of sources) {
        try {
          const offers = await fn()
          if (!offers.length) throw new Error('keine Angebote gefunden')
          await sb.from('offers').delete().eq('store', store)
          for (let i = 0; i < offers.length; i += 500) {
            const { error } = await sb.from('offers').insert(offers.slice(i, i + 500))
            if (error) throw error
          }
          report[store] = `${offers.length} Angebote`
        } catch (e) {
          report[store] = 'Fehler: ' + String((e as Error).message ?? e).slice(0, 200)
        }
      }
      await sb.from('offer_runs').insert({ report })
      return json(report)
    }

    if (mode === 'search') {
      const q = String(body.q ?? '').trim().slice(0, 80)
      if (q.length < 2) return json({ results: [], errors: {} })
      const errors: Record<string, string> = {}
      const live = await Promise.all(
        ([['dm', dm], ['Lidl', lidl]] as [string, (q: string) => Promise<Offer[]>][]).map(async ([n, fn]) => {
          try {
            return await fn(q)
          } catch (e) {
            errors[n] = String((e as Error).message ?? e).slice(0, 100)
            return []
          }
        }),
      )
      // gespeicherte Wochenangebote: alle Suchwörter müssen vorkommen
      const ws = words(q)
      const { data: stored } = await sb.from('offers').select('*').or(ws.map((w) => `title.ilike.%${w}%`).join(','))
      const fitting = (stored ?? []).filter((o: Offer) => {
        const t = words(o.title).join(' ')
        return ws.every((w) => t.includes(w.length > 4 ? w.slice(0, -1) : w))
      })
      const qa = ws.map((w) => (w.length > 4 ? w.slice(0, -1) : w))
      const liveFit = live.flat().filter((o) => {
        const t = words(o.title).join(' ')
        return qa.some((w) => t.includes(w))
      })
      return json({ results: [...fitting, ...liveFit], errors })
    }
    return json({ error: 'unbekannter Modus' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
