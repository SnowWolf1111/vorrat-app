// Text-/Sprachbefehle wie "minus 1 Cola", "2 Pommes eingelagert", "Ketchup auf die Liste".
// Erst ein einfacher Regel-Parser (offline, sofort). Klappt der nicht, optional die Gratis-KI.

import type { Article } from './db'
import { normalize, type Data } from './data'
import { askAI, parseJson } from './ai'

export type CmdKind = 'consume' | 'add' | 'shop' | 'query' | 'low'
export type Cmd = { kind: CmdKind; amount: number; article: Article | null; query: string; candidates: Article[] }

const NUM: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8,
  neun: 9, zehn: 10, elf: 11, zwolf: 12, halb: 0.5, halbe: 0.5, halben: 0.5, paar: 2,
}
const KIND_WORDS: [CmdKind, RegExp][] = [
  ['low', /\b(bald leer|fast leer|fast alle|bald alle|wird knapp|geht zur neige|neige|knapp)\b/],
  ['shop', /\b(einkaufsliste|auf die liste|auf liste|zur liste|einkaufen|kaufen|besorgen|nachkaufen|bestellen|brauche|brauchen)\b/],
  ['query', /\b(wie ?viele?|wieviele?|haben wir|habe ich noch|hab ich noch|noch da|ist noch)\b/],
  ['consume', /\b(minus|weg|verbraucht|verbrauch|genommen|nimm|nehme|raus|aufgebraucht|gegessen|getrunken|entnommen|entnehmen|abziehen|austragen|leer|ausgetrunken|aufgegessen)\b|^-/],
  ['add', /\b(plus|dazu|eingelagert|einlagern|gekauft|hinzu|hinzufugen|rein|eingeraumt|neu|addiere|add)\b|^\+/],
]
const FILLER = new Set([
  'ich', 'hab', 'habe', 'hat', 'wir', 'haben', 'von', 'die', 'der', 'das', 'den', 'dem', 'des', 'auf', 'noch', 'bitte', 'mal', 'mir',
  'packung', 'packungen', 'stuck', 'stk', 'dose', 'dosen', 'flasche', 'flaschen', 'beutel', 'glas', 'tube', 'liste', 'einkaufsliste',
  'zur', 'zum', 'setze', 'setz', 'schreib', 'schreibe', 'pack', 'packe', 'tu', 'tue', 'leg', 'lege', 'ist', 'sind', 'da', 'und', 'mehr',
  'eingelagert', 'einlagern', 'gekauft', 'verbraucht', 'genommen', 'minus', 'plus', 'weg', 'raus', 'rein', 'dazu', 'hinzu', 'hinzufugen',
  'gegessen', 'getrunken', 'aufgebraucht', 'entnommen', 'entnehmen', 'abziehen', 'austragen', 'einkaufen', 'kaufen', 'besorgen',
  'nachkaufen', 'bestellen', 'brauche', 'brauchen', 'wie', 'viel', 'viele', 'wieviel', 'wieviele', 'nimm', 'nehme', 'leer',
  'ausgetrunken', 'aufgegessen', 'eingeraumt', 'neu', 'addiere', 'add', 'davon', 'stueck', 'bald', 'fast', 'alle', 'knapp',
  'neige', 'geht', 'wird', 'gleich',
])

function stem(w: string) {
  return w.length > 4 ? w.replace(/(en|er|n|s|e)$/, '') : w
}

/** Passende Artikel zu einem Suchwort, beste zuerst. */
export function findArticles(q: string, data: Data): { article: Article; score: number }[] {
  const words = normalize(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
  if (!words.length) return []
  const variantsBy = new Map<number, string>()
  for (const b of data.barcodes) variantsBy.set(b.article_id, (variantsBy.get(b.article_id) ?? '') + ' ' + [b.off_brand, b.off_name].join(' '))
  for (const s of data.stock.values()) for (const e of s.entries) if (e.variant) variantsBy.set(s.article.id, (variantsBy.get(s.article.id) ?? '') + ' ' + e.variant)

  return data.articles
    .map((a) => {
      const name = normalize(a.name)
      const extra = normalize([a.category, ...(a.aliases ?? []), variantsBy.get(a.id) ?? ''].join(' '))
      let score = 0
      for (const w of words) {
        const s = stem(w)
        if (new RegExp(`\\b${s}`).test(name)) score += 3
        else if (name.includes(s)) score += 2
        else if (extra.includes(s)) score += 1.5
      }
      if (name.startsWith(stem(words[0]))) score += 0.5
      return { article: a, score: score / words.length }
    })
    .filter((x) => x.score >= 1.5)
    .sort((x, y) => y.score - x.score || x.article.name.length - y.article.name.length)
}

export function parseCommands(input: string, data: Data): Cmd[] {
  const parts = normalize(input)
    .replace(/[!?]/g, ' ')
    .split(/\s*(?:,|;|\bund dann\b|\bund\b|\bdann\b)\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
  const cmds: Cmd[] = []
  let lastKind: CmdKind = 'consume'
  for (const p of parts) {
    let kind: CmdKind | null = null
    for (const [k, re] of KIND_WORDS) if (re.test(p)) { kind = k; break }
    kind ??= lastKind
    lastKind = kind

    let amount: number | null = null
    const words = p.replace(/^[-+]\s*/, '').split(/\s+/)
    const rest: string[] = []
    for (const w of words) {
      const n = Number(w.replace(',', '.').replace(/x$/, ''))
      if (amount == null && /^\d+([.,]\d+)?x?$/.test(w) && !Number.isNaN(n)) amount = n
      else if (amount == null && NUM[w] != null) amount = NUM[w]
      else if (!FILLER.has(w)) rest.push(w)
    }
    const query = rest.join(' ').replace(/\b(auf die|die|der)\b/g, '').trim()
    if (!query) continue
    const found = findArticles(query, data)
    const top = found[0]
    const clear = top && (!found[1] || found[1].score < top.score)
    cmds.push({ kind, amount: amount ?? 1, article: clear ? top.article : null, query, candidates: found.slice(0, 4).map((f) => f.article) })
  }
  return cmds
}

/** Fallback: Gratis-KI versteht freiere Sätze. */
export async function aiParse(input: string, data: Data): Promise<Cmd[]> {
  const list = data.articles.map((a) => `${a.id}: ${a.name}`).join('\n')
  const text = await askAI([
    {
      role: 'system',
      content:
        'Du übersetzt deutsche Vorrats-Befehle in JSON. Aktionen: consume (aus dem Vorrat nehmen/verbraucht), add (eingelagert/gekauft), shop (auf die Einkaufsliste), query (wie viel ist da), low (noch da, aber bald leer -> schon nachkaufen). ' +
        'Antworte NUR mit einem JSON-Array wie [{"kind":"consume","article_id":12,"amount":1,"name":"Cola"}]. article_id nur aus der Liste, sonst null.',
    },
    { role: 'user', content: `Artikel:\n${list}\n\nBefehl: ${input}` },
  ])
  const arr = parseJson<{ kind: CmdKind; article_id: number | null; amount?: number; name?: string }[]>(text)
  return (Array.isArray(arr) ? arr : [])
    .filter((x) => ['consume', 'add', 'shop', 'query', 'low'].includes(x.kind))
    .map((x) => {
      const article = x.article_id != null ? data.articleById.get(Number(x.article_id)) ?? null : null
      const query = x.name ?? article?.name ?? ''
      return { kind: x.kind, amount: Number(x.amount) > 0 ? Number(x.amount) : 1, article, query, candidates: article ? [article] : findArticles(query, data).slice(0, 4).map((f) => f.article) }
    })
}
