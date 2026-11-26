// Automatische Angebots-Jobs – laufen auf dem Supabase-Server per Zeitplan, unabhängig von Claude und vom PC.
//  POST {mode:"dm"}   -> sucht bei dm nach allen eigenen Artikeln, merkt sich Preise, erkennt Preissenkungen
//  POST {mode:"pdf"}  -> Prospekte (Aldi Süd, Lidl-Lebensmittel) finden, Text holen und seitenweise von der Gratis-KI auslesen
// Nur offizielle, öffentlich erreichbare Quellen; gesperrte Seiten werden nicht umgangen.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const get = (url: string, headers: Record<string, string> = {}, ms = 20000) =>
  fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(ms) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const today = () => new Date().toISOString().slice(0, 10)
const num = (x: unknown) => {
  if (typeof x === 'number') return x
  const m = String(x ?? '').replace(',', '.').match(/\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
const STOP = new Set(['und', 'oder', 'mit', 'ohne', 'der', 'die', 'das', 'fur', 'packung', 'dose', 'stk', 'frisch', 'basis', 'je', 'von'])
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w))
const stem = (w: string) => (w.length > 5 ? w.replace(/(en|er|n|s|e)$/, '') : w)
/** Alle Wörter müssen in einem Titel am Wortanfang vorkommen ("Zewa" passt zu "ZEWA Toilettenpapier"). */
const fits = (ws: string[], title: string) => {
  const t = norm(title)
  return ws.length > 0 && ws.every((w) => new RegExp(`(^|[^a-z])${stem(w)}`).test(t))
}

type Sb = ReturnType<typeof createClient>

// ======================= dm: Preischeck für eigene Artikel =======================
async function dmSearch(q: string) {
  const r = await get(`https://product-search.services.dmtech.com/de/search?query=${encodeURIComponent(q)}&pageSize=20`, {
    Accept: 'application/json', Origin: 'https://www.dm.de', Referer: 'https://www.dm.de/',
  })
  if (!r.ok) throw new Error(`dm ${r.status}`)
  const j = await r.json()
  // deno-lint-ignore no-explicit-any
  return (j.products ?? []).map((p: any) => {
    const t = p.tileData ?? {}
    return {
      title: [p.brandName, p.title].filter(Boolean).join(' '),
      price: num(t?.price?.price?.current?.value),
      info: (t?.price?.tileInfos ?? []).join(' · ') || null,
      image: t?.images?.[0]?.src ?? t?.images?.[0]?.tileSrc ?? null,
      url: t?.self ? `https://www.dm.de${t.self}` : `https://www.dm.de/search?query=${encodeURIComponent(q)}`,
    }
  }).filter((x: { title: string; price: number | null }) => x.title && x.price != null)
}

async function runDm(sb: Sb) {
  // Portionsweise: je Lauf die 12 am längsten nicht geprüften Artikel (schont dm, Zeitplan alle 30 Minuten)
  const { data: arts, error } = await sb.from('articles').select('id,name,aliases').eq('active', true)
  if (error) throw new Error(error.message)
  const { data: checks } = await sb.from('dm_checks').select('article_id,checked_at')
  const last = new Map<number, string>((checks ?? []).map((c: { article_id: number; checked_at: string }) => [c.article_id, c.checked_at]))
  const todo = (arts ?? []).sort((x: { id: number }, y: { id: number }) => (last.get(x.id) ?? '').localeCompare(last.get(y.id) ?? '')).slice(0, 12)

  let fails = 0
  let checked = 0
  let found = 0
  for (const a of todo) {
    const query = a.name.split(/\s*[/(,]\s*/)[0].replace(/\d+([.,]\d+)?\s*%/g, '').trim()
    const ws = words(query)
    try {
      const res = ws.length ? await dmSearch(query) : []
      fails = 0
      checked++
      const alts = [ws, ...((a.aliases ?? []) as string[]).map(words)].filter((x) => x.length)
      // Babynahrung/Zubehör nur, wenn der Artikel selbst danach klingt ("HiPP Rigatoni ab dem 8. Monat" ist keine Rigatoni-Packung)
      const special = /baby|kinder|hipp|portionierer/.test(norm(a.name))
      const hits = res.filter((p: { title: string }) => alts.some((w) => fits(w, p.title)))
        .filter((p: { title: string }) => special || !/ab dem \d+\. monat|ab \d+ jahren|\bbaby|babylove|hipp\b|portionierer|alete|bebivita/i.test(p.title))
        .sort((x: { price: number }, y: { price: number }) => x.price - y.price).slice(0, 3)
      const { data: prev } = await sb.from('offers').select('title,price,old_price').eq('store', 'dm').eq('source', 'preischeck').eq('article_id', a.id)
      const before = new Map<string, { price: number; old: number | null }>()
      for (const p of prev ?? []) before.set(p.title, { price: Number(p.price), old: p.old_price != null ? Number(p.old_price) : null })
      const rows = hits.map((h: { title: string; price: number; info: string | null; image: string | null; url: string }) => {
        const was = before.get(h.title)
        // Preissenkung gegenüber der letzten Prüfung merken (bleibt stehen, solange der Preis niedriger ist)
        const ref = was ? Math.max(was.price, was.old ?? 0) : null
        const cheaper = ref != null && h.price < ref - 0.001
        return {
          store: 'dm', source: 'preischeck', article_id: a.id, title: h.title, subtitle: null, price: h.price,
          old_price: cheaper ? ref : null, discount: cheaper ? `-${Math.round((1 - h.price / ref!) * 100)}% ggü. letzter Prüfung` : null,
          card_price: null, unit: null, base_price: h.info, image: h.image, url: h.url,
          valid_text: 'dm-Preis, täglich geprüft', valid_from: null, valid_to: null, kind: cheaper ? 'angebot' : 'preis',
        }
      })
      await sb.from('offers').delete().eq('store', 'dm').eq('source', 'preischeck').eq('article_id', a.id)
      if (rows.length) await sb.from('offers').insert(rows)
      found += rows.length
      await sb.from('dm_checks').upsert({ article_id: a.id, checked_at: new Date().toISOString(), hits: rows.length })
    } catch {
      if (++fails >= 2) break // dm bremst gerade -> nächster Lauf
      await sleep(8000)
    }
    await sleep(2500)
  }
  if (checked === 0 && todo.length) throw new Error('dm gerade nicht erreichbar')
  return `${checked} Artikel geprüft, ${found} dm-Preise`
}

// ======================= Prospekte =======================
type Found = { store: string; key: string; title: string; url: string; from: string | null; to: string | null; pages?: string[]; pdf?: string }

/** "Mo. 23.11. – Sa. 28.11." -> [von, bis] */
function dates(t: string): [string | null, string | null] {
  const m = [...t.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/g)].slice(0, 2)
  const y = new Date().getFullYear()
  const d = (x: RegExpMatchArray) => `${x[3] ? (x[3].length === 2 ? '20' + x[3] : x[3]) : y}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}`
  return [m[0] ? d(m[0]) : null, m[1] ? d(m[1]) : null]
}
// Preise sind im Text oft zerteilt ("2.\n\n49") -> wieder zusammenfügen
const tidy = (t: string) => t.replace(/(\d)\.\s*\n+\s*(\d{2})\b/g, '$1.$2').replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim()

async function findAldiSued(): Promise<Found[]> {
  const r = await get('https://prospekt.aldi-sued.de/')
  if (!r.ok) throw new Error(`Aldi Süd ${r.status}`)
  const base = r.url.endsWith('/') ? r.url : r.url + '/'
  const html = await r.text()
  const pdf = html.match(/"downloadPdfUrl":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, '&').split('?')[0]
  const sp = await (await get(base + 'spreads.json', { Accept: 'application/json' })).json()
  // deno-lint-ignore no-explicit-any
  const pages: string[] = (sp as any[]).flatMap((s) => (s.pages ?? []).map((p: any) => tidy(String(p.text ?? ''))))
  const [from, to] = dates(pages.find((p) => /\d{1,2}\.\d{1,2}\.\s*[–-]/.test(p)) ?? '')
  return [{ store: 'Aldi Süd', key: base, title: 'ALDI SÜD Prospekt', url: base, from, to, pages, pdf }]
}

async function findLidlFood(): Promise<Found[]> {
  const r = await get('https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl/de-DE', { Accept: 'application/json' })
  if (!r.ok) throw new Error(`Lidl ${r.status}`)
  const h = await r.text()
  const ids = [...new Set([...h.matchAll(/prospekte\/(aktionsprospekt-[a-z0-9-]+)\/ar\/0[?"]/g)].map((m) => m[1]))]
  const out: Found[] = []
  for (const id of ids.slice(0, 6)) {
    const f = (await (await get(`https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${id}&region_id=0`, { Accept: 'application/json' })).json()).flyer
    if (!f?.pdfUrl) continue
    // Prospekte mit vielen Produktdaten (Non-Food) holt schon die Funktion "angebote"; hier nur die Lebensmittel-Prospekte
    if (Object.keys(f.products ?? {}).length > 40) continue
    out.push({
      store: 'Lidl', key: f.pdfUrl, title: `Lidl ${f.title ?? ''}`.trim(), url: `https://www.lidl.de/l/prospekte/${id}/ar/0`,
      from: (f.offerStartDate ?? f.startDate ?? '').slice(0, 10) || null, to: (f.offerEndDate ?? f.endDate ?? '').slice(0, 10) || null, pdf: f.pdfUrl,
    })
  }
  return out
}

async function pdfPages(url: string): Promise<string[]> {
  const r = await get(url, {}, 60000)
  if (!r.ok) throw new Error(`PDF ${r.status}`)
  const pdf = await getDocumentProxy(new Uint8Array(await r.arrayBuffer()))
  const { text } = await extractText(pdf, { mergePages: false })
  return (text as string[]).map(tidy)
}

const PROMPT =
  'Du liest Text aus einem deutschen Supermarkt-Prospekt und listest die Angebote. Antworte NUR mit einem JSON-Array, ohne Erklärungen: ' +
  '[{"title":"MARKE Produktname","price":1.99,"old_price":2.49,"unit":"je 500 g","discount":"-20%","note":"nur mit App"}]. ' +
  'Regeln: nur Produkte, bei denen ein Preis im Text steht; price = Angebotspreis als Zahl (meist mit * markiert, z. B. "2.49*"); ' +
  'Angaben wie "kg-Preis 1.25", "1 kg = 6.33" oder "100 g = 0.65" sind Grundpreise und NIE der price; ' +
  'old_price = durchgestrichener/vorheriger Preis bzw. "UVP"/"statt"-Preis (höher als price), sonst null; unit = Packungsangabe wie "2-kg-Netz", "je 150 g"; ' +
  'discount/note nur wenn im Text, sonst null; nichts erfinden; Werbetexte, Rechtliches und Rezepte weglassen. ' +
  'Der Text kann durcheinander sein: ordne Preise dem Produkt zu, zu dem sie am wahrscheinlichsten gehören, und lass das Produkt im Zweifel weg. Wenn keine Angebote vorkommen: [].'

async function askAI(text: string): Promise<Record<string, unknown>[]> {
  const r = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(70000),
    body: JSON.stringify({ model: 'openai', messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text }] }),
  })
  if (!r.ok) throw new Error(`KI ${r.status}`)
  const c: string = (await r.json()).choices?.[0]?.message?.content ?? ''
  const s = c.replace(/```(json)?/g, '')
  const a = s.indexOf('['), b = s.lastIndexOf(']')
  if (a >= 0 && b > a) {
    try {
      const arr = JSON.parse(s.slice(a, b + 1))
      if (Array.isArray(arr)) return arr
    } catch { /* unten retten */ }
  }
  // Antwort abgeschnitten o. Ä.: alle vollständigen {...}-Einträge einzeln retten
  const out: Record<string, unknown>[] = []
  for (const m of s.matchAll(/\{[^{}]*\}/g)) {
    try { out.push(JSON.parse(m[0])) } catch { /* kaputter Eintrag */ }
  }
  return out
}

async function runPdf(sb: Sb, started: number) {
  const log: string[] = []
  const left = () => 115000 - (Date.now() - started)

  // 1) Einmal am Tag neue Prospekte suchen
  const { data: anyOpen } = await sb.from('offer_pdf_jobs').select('id').in('status', ['open', 'extract']).limit(1)
  const lastFind = (await sb.from('offer_runs').select('ran_at').eq('report->>kind', 'pdf-find').order('ran_at', { ascending: false }).limit(1)).data?.[0]?.ran_at
  if (!anyOpen?.length && (!lastFind || Date.now() - new Date(lastFind).getTime() > 20 * 3600e3)) {
    const found: Found[] = []
    for (const [n, fn] of [['Aldi Süd', findAldiSued], ['Lidl', findLidlFood]] as const) {
      try { found.push(...(await fn())) } catch (e) { log.push(`${n}: ${String(e).slice(0, 120)}`) }
    }
    for (const f of found) {
      const { data: ex } = await sb.from('offer_pdf_jobs').select('id').eq('source_key', f.key).limit(1)
      if (ex?.length) continue
      await sb.from('offer_pdf_jobs').insert({
        store: f.store, source_key: f.key, title: f.title, url: f.url, valid_from: f.from, valid_to: f.to,
        pages: f.pages ?? [], pdf_url: f.pdf ?? null, status: f.pdf ? 'extract' : 'open',
      })
      log.push(`neu: ${f.title}`)
    }
    await sb.from('offer_runs').insert({ report: { kind: 'pdf-find', log } })
  }

  // 2) Einen PDF-Text herausziehen (eigener Schritt, damit es den Speicher nicht sprengt)
  const { data: ext } = await sb.from('offer_pdf_jobs').select('id,pdf_url,title,pages').eq('status', 'extract').limit(1)
  if (ext?.length) {
    try {
      const pages = await pdfPages(ext[0].pdf_url)
      await sb.from('offer_pdf_jobs').update({ pages, status: 'open', updated_at: new Date().toISOString() }).eq('id', ext[0].id)
      log.push(`${ext[0].title}: ${pages.length} Seiten Text`)
    } catch (e) {
      // PDF zu groß o. Ä.: vorhandenen Seitentext (z. B. aus dem Online-Blätterkatalog) nehmen, sonst Fehler
      const fallback = (ext[0].pages ?? []).length > 0
      await sb.from('offer_pdf_jobs').update({ status: fallback ? 'open' : 'error', error: String(e).slice(0, 300) }).eq('id', ext[0].id)
      log.push(`${ext[0].title}: Fehler ${String(e).slice(0, 120)}`)
    }
    return log
  }

  // 3) Seiten von der KI auslesen lassen, solange Zeit ist
  let calls = 0
  while (left() > 70000) {
    if (calls++ > 0) {
      if (left() < 70000 + 47000) break
      await sleep(47000) // Gratis-KI: höchstens eine Antwort alle 45 Sekunden
    }
    const { data: jobs } = await sb.from('offer_pdf_jobs').select('*').eq('status', 'open').order('id').limit(1)
    const job = jobs?.[0]
    if (!job) break
    const pages: string[] = job.pages ?? []
    if (job.next_page === 0) {
      // neuer Prospekt -> abgelaufene Prospekt-Angebote dieses Ladens entfernen
      await sb.from('offers').delete().eq('store', job.store).eq('source', 'pdf').lt('valid_to', today())
    }
    let end = job.next_page
    let chunk = ''
    while (end < pages.length && (chunk.length < 4000 || end === job.next_page)) chunk += `\n--- Seite ${end + 1} ---\n` + pages[end++]
    let items: Record<string, unknown>[] = []
    try {
      items = chunk.trim().length > 80 ? await askAI(chunk.slice(0, 8000)) : []
    } catch (e) {
      log.push(`${job.title}: KI-Fehler ${String(e).slice(0, 80)}`)
      break // KI überlastet -> beim nächsten Lauf weiter
    }
    const rows = items
      .map((x) => ({
        store: job.store, source: 'pdf', title: String(x.title ?? '').slice(0, 200), subtitle: null,
        price: num(x.price), old_price: num(x.old_price), discount: x.discount ? String(x.discount).slice(0, 40) : (x.note ? String(x.note).slice(0, 40) : null),
        card_price: null, unit: x.unit ? String(x.unit).slice(0, 80) : null, base_price: null, image: null, url: job.url,
        valid_text: 'aus dem Prospekt (KI)', valid_from: job.valid_from, valid_to: job.valid_to, kind: 'angebot',
      }))
      .filter((o) => o.title.length > 2 && o.price != null && o.price > 0 && o.price < 2000)
      .map((o) => ({ ...o, old_price: o.old_price && o.old_price > o.price! ? o.old_price : null }))
    if (rows.length) await sb.from('offers').insert(rows)
    const done = end >= pages.length
    await sb.from('offer_pdf_jobs').update({ next_page: end, found: job.found + rows.length, status: done ? 'done' : 'open', updated_at: new Date().toISOString() }).eq('id', job.id)
    log.push(`${job.title}: Seiten bis ${end}/${pages.length}, ${rows.length} Angebote`)
  }
  return log
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const started = Date.now()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const { mode } = await req.json().catch(() => ({ mode: '' }))
    if (mode === 'dm') {
      const res = await runDm(sb)
      await sb.from('offer_runs').insert({ report: { kind: 'dm', res } })
      return json({ dm: res })
    }
    if (mode === 'pdf') return json({ pdf: await runPdf(sb, started) })
    return json({ error: 'unbekannter Modus' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
