// MHD von einem Foto lesen – läuft komplett auf dem Handy (Tesseract, kostenlos).
// Beim ersten Mal werden ca. 3 MB Texterkennung geladen, danach aus dem Cache.

import { today } from './db'

function prepare(file: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const max = 1600
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      const g = c.getContext('2d')!
      g.filter = 'grayscale(1) contrast(1.6)'
      g.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      resolve(c)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

const iso = (y: number, m: number, d: number) => {
  const dt = new Date(y, m - 1, d)
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return dt.toLocaleDateString('sv-SE')
}
const fullYear = (y: number) => (y < 100 ? 2000 + y : y)

/** Sucht Datumsangaben im Text und nimmt die plausibelste. */
export function pickDate(text: string): string | null {
  const t = text.replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(/,/g, '.')
  const found: { date: string; prio: number }[] = []
  // TT.MM.JJ(JJ), auch mit / - oder Leerzeichen
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s?[./\- ]\s?(\d{1,2})\s?[./\- ]\s?(\d{4}|\d{2})(?!\d)/g)) {
    const d = iso(fullYear(+m[3]), +m[2], +m[1])
    if (d) found.push({ date: d, prio: 3 })
  }
  // MM.JJJJ oder MM/JJ -> Monatsende
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2})\s?[./\-]\s?(\d{4}|\d{2})(?![\d.])/g)) {
    const y = fullYear(+m[2])
    const mo = +m[1]
    if (mo >= 1 && mo <= 12) found.push({ date: iso(y, mo, new Date(y, mo, 0).getDate())!, prio: 2 })
  }
  // TTMMJJ am Stück
  for (const m of t.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/g)) {
    const d = iso(2000 + +m[3], +m[2], +m[1])
    if (d) found.push({ date: d, prio: 1 })
  }
  const now = today()
  const min = String(+now.slice(0, 4) - 1) + now.slice(4)
  const max = String(+now.slice(0, 4) + 6) + now.slice(4)
  const ok = found.filter((f) => f.date >= min && f.date <= max)
  ok.sort((a, b) => b.prio - a.prio || a.date.localeCompare(b.date))
  return ok[0]?.date ?? null
}

export async function readMhdFromImage(file: Blob): Promise<{ date: string | null; text: string }> {
  const [{ createWorker }, canvas] = await Promise.all([import('tesseract.js'), prepare(file)])
  const worker = await createWorker('eng')
  try {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789./-: ' })
    const { data } = await worker.recognize(canvas)
    return { date: pickDate(data.text), text: data.text }
  } finally {
    await worker.terminate()
  }
}
