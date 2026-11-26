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
  valid_from?: string | null
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

/** erstes Datum im Text -> YYYY-MM-DD */
function validFrom(t: string | null): string | null {
  if (!t) return null
  const m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/)
  if (!m) return null
  return validTo(m[0])
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

// ---------- Penny: Angebotsseite enthält strukturierte Daten (schema.org) ----------
async function penny(): Promise<Offer[]> {
  const r = await get('https://www.penny.de/angebote')
  if (!r.ok) throw new Error(`Penny ${r.status}`)
  const h = await r.text()
  const out = new Map<string, Offer>()
  for (const m of h.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let j
    try { j = JSON.parse(m[1]) } catch { continue }
    for (const g of j['@graph'] ?? []) {
      if (g['@type'] !== 'OfferCatalog') continue
      for (const el of g.itemListElement ?? []) {
        const p = el.item ?? {}
        const of = p.offers ?? {}
        const price = num(String(of.price ?? ''))
        if (!p.name || price == null) continue
        const app = /app/i.test(of.description ?? '')
        const o: Offer = {
          store: 'Penny', title: p.name, subtitle: null, price, old_price: null,
          discount: app ? 'nur mit App' : null, card_price: null,
          unit: p.description ?? null, base_price: null, image: p.image ?? null, url: p.url ?? null,
          valid_text: of.validFrom && of.validThrough ? `${of.validFrom.slice(8, 10)}.${of.validFrom.slice(5, 7)}. bis ${of.validThrough.slice(8, 10)}.${of.validThrough.slice(5, 7)}.` : null,
          valid_from: of.validFrom ?? null, valid_to: of.validThrough ?? of.priceValidUntil ?? null, kind: 'angebot',
        }
        out.set(`${o.title}|${o.price}|${o.valid_from}`, o)
      }
    }
  }
  return [...out.values()]
}

// ---------- Norma: Tagesseiten "ab Montag, 23.11.26" usw. ----------
async function norma(): Promise<Offer[]> {
  const base = 'https://www.norma-online.de'
  const r = await get(base + '/de/angebote/')
  if (!r.ok) throw new Error(`Norma ${r.status}`)
  const h = await r.text()
  const days = [...new Set([...h.matchAll(/href="(\/de\/angebote\/ab-[a-z]+,-(\d{2})\.(\d{2})\.(\d{2})\/)"/g)].map((m) => m[1]))].slice(0, 6)
  const out = new Map<string, Offer>()
  for (const path of days) {
    const dm = path.match(/(\d{2})\.(\d{2})\.(\d{2})/)!
    const from = new Date(`20${dm[3]}-${dm[2]}-${dm[1]}T12:00:00Z`)
    const to = new Date(from)
    to.setUTCDate(from.getUTCDate() + ((6 - from.getUTCDay() + 7) % 7)) // bis Samstag
    const rr = await get(base + path)
    if (!rr.ok) continue
    const t = await rr.text()
    for (const p of t.split('<article class="').slice(1)) {
      const c = p.slice(0, 4000)
      const head = c.match(/produktBox-txt-headline">([^<]*)/)?.[1]?.trim()
      const price = num(c.match(/produktBox-cont-wrapper-price">\s*<span aria-label="([^"]*)"/)?.[1])
      if (!head || price == null) continue
      let desc = c.match(/produktBox-txt-description">([^<]*)/)?.[1]?.trim() ?? null
      if (desc && /aus unserem sortiment/i.test(desc)) desc = null
      const old = num(c.match(/produktBox-cont-wrapper-uvp">[^0-9<]*([0-9.,]+)/)?.[1])
      const href = c.match(/<a href="([^"]+)"/)?.[1]
      const img = c.match(/<img src="([^"]+)"/)?.[1]
      const appPrice = /mit App/.test(c)
      const o: Offer = {
        store: 'Norma', title: [head, desc].filter(Boolean).join(' – '), subtitle: desc, price,
        old_price: old && old > price ? old : null, discount: null, card_price: null,
        unit: strip(c.match(/produktBox-txt-(?:inh|ref)">([^<]*)/)?.[1] ?? '') || null,
        base_price: [...c.matchAll(/produktBox-txt-price">([^<]+)/g)].map((m) => strip(m[1])).filter(Boolean).join(' / ') || null,
        image: img ? base + img : null, url: href ? base + href : base + path,
        valid_text: `${dm[1]}.${dm[2]}. bis ${iso(to).slice(8, 10)}.${iso(to).slice(5, 7)}.${appPrice ? ' (Preis mit App)' : ''}`,
        valid_from: iso(from), valid_to: iso(to), kind: 'angebot',
      }
      out.set(`${o.title}|${o.price}|${o.valid_from}`, o)
    }
  }
  return [...out.values()]
}

// ---------- Lidl: Aktionsprospekte über Lidls eigenen Prospekt-Viewer (enthält v. a. Non-Food/Drogerie) ----------
async function lidlFlyer(): Promise<Offer[]> {
  // Übersicht aller Prospekte; nur die bundesweiten (Region 0), keine Filial-/Regional-Varianten
  const r = await get('https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl/de-DE', { Accept: 'application/json' })
  if (!r.ok) throw new Error(`Lidl ${r.status}`)
  const h = await r.text()
  const ids = [...new Set([...h.matchAll(/prospekte\/(aktionsprospekt-[a-z0-9-]+)\/ar\/0[?"]/g)].map((m) => m[1]))]
  const out = new Map<string, Offer>()
  for (const id of ids.slice(0, 6)) {
    const fr = await get(`https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${id}&region_id=0`, { Accept: 'application/json' })
    if (!fr.ok) continue
    const f = (await fr.json()).flyer
    if (!f) continue
    const from = (f.offerStartDate ?? f.startDate ?? '').slice(0, 10) || null
    const to = (f.offerEndDate ?? f.endDate ?? '').slice(0, 10) || null
    // deno-lint-ignore no-explicit-any
    for (const p of Object.values(f.products ?? {}) as any[]) {
      const price = num(String(p.price ?? ''))
      if (!p.title || price == null) continue
      const o: Offer = {
        store: 'Lidl', title: p.title, subtitle: (p.categoryPrimary ?? '').split('/').at(-1) || null, price,
        old_price: null, discount: null, card_price: null, unit: null, base_price: null,
        image: p.image ?? null, url: p.canonicalUrl ? 'https://www.lidl.de' + p.canonicalUrl : p.url ?? null,
        valid_text: f.title ?? null, valid_from: from, valid_to: to, kind: 'angebot',
      }
      out.set(`${o.title}|${o.price}|${from}`, o)
    }
  }
  return [...out.values()]
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
        valid_from: validFrom(head),
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
        lidlflyer: 'https://www.lidl.de/c/online-prospekte/s10005610',
        penny: 'https://www.penny.de/angebote',
        norma: 'https://www.norma-online.de/de/angebote/',
        aldisued: 'https://www.aldi-sued.de/de/angebote.html',
        rossmann: 'https://www.rossmann.de/de/search/?text=zahnpasta',
        rewe: 'https://www.rewe.de/angebote/',
        netto: 'https://www.netto-online.de/filialangebote',
        edeka: 'https://www.edeka.de/eh/angebote.jsp',
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
      const sources: [string, () => Promise<Offer[]>][] = [['Kaufland', kaufland], ['Penny', penny], ['Norma', norma], ['Lidl', lidlFlyer]]
      await Promise.all(sources.map(async ([store, fn]) => {
        try {
          const offers = await fn()
          if (!offers.length) throw new Error('keine Angebote gefunden')
          // nur die von hier stammenden Angebote ersetzen (Prospekt-/Preischeck-Angebote bleiben)
          await sb.from('offers').delete().eq('store', store).eq('source', 'web')
          for (let i = 0; i < offers.length; i += 500) {
            const { error } = await sb.from('offers').insert(offers.slice(i, i + 500))
            if (error) throw error
          }
          report[store] = `${offers.length} Angebote`
        } catch (e) {
          report[store] = 'Fehler: ' + String((e as Error).message ?? e).slice(0, 200)
        }
      }))
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
