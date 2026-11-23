import { today } from './db'

/** "0326" -> letzter Tag 03/2026, "150326" -> 15.03.2026, "15032026" -> 15.03.2026. */
export function parseMhd(input: string): string | null {
  const d = input.replace(/\D/g, '')
  let day: number, month: number, year: number
  if (d.length === 4) {
    month = +d.slice(0, 2)
    year = 2000 + +d.slice(2)
    day = new Date(year, month, 0).getDate()
  } else if (d.length === 6) {
    day = +d.slice(0, 2)
    month = +d.slice(2, 4)
    year = 2000 + +d.slice(4)
  } else if (d.length === 8) {
    day = +d.slice(0, 2)
    month = +d.slice(2, 4)
    year = +d.slice(4)
  } else return null
  if (month < 1 || month > 12 || day < 1) return null
  const dt = new Date(year, month - 1, day)
  if (dt.getMonth() !== month - 1) return null
  return dt.toLocaleDateString('sv-SE')
}

export function fmtDate(iso: string | null) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

export function daysUntil(iso: string) {
  const a = new Date(today() + 'T00:00:00')
  const b = new Date(iso + 'T00:00:00')
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export type MhdState = 'expired' | 'soon' | 'ok' | 'none'
export function mhdState(iso: string | null, soonDays = 7): MhdState {
  if (!iso) return 'none'
  const n = daysUntil(iso)
  if (n < 0) return 'expired'
  if (n <= soonDays) return 'soon'
  return 'ok'
}

export function mhdLabel(iso: string | null) {
  if (!iso) return 'ohne MHD'
  const n = daysUntil(iso)
  if (n < 0) return `abgelaufen seit ${-n} T.`
  if (n === 0) return 'läuft heute ab'
  if (n === 1) return 'läuft morgen ab'
  if (n <= 14) return `noch ${n} Tage`
  return `MHD ${fmtDate(iso)}`
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
export const fmtEur = (n: number) => eur.format(n)

export const fmtAmount = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('de-DE', { maximumFractionDigits: 2 }))

export function vibrate(ms = 40) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* nicht unterstützt */
  }
}
