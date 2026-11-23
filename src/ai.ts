// Kostenlose KI (Pollinations, ohne Konto). Läuft NICHT über Claude.
// Der Aufruf geht über die Supabase-Funktion "ki" (Pollinations blockt direkte Browser-Aufrufe).
// Geschickt werden nur Artikelnamen bzw. dein Text.

import { supabase } from './supabase'

type Msg = { role: 'system' | 'user'; content: string }

export async function askAI(messages: Msg[]): Promise<string> {
  if (!navigator.onLine) throw new Error('Für die KI braucht es Internet.')
  const { data, error } = await supabase.functions.invoke<{ content?: string; error?: string }>('ki', { body: { messages } })
  if (error) {
    const status = (error as { context?: Response }).context?.status
    if (status === 429) throw new Error('Die Gratis-KI ist gerade ausgelastet. In einer Minute nochmal probieren.')
    throw new Error('Die KI antwortet gerade nicht. Gleich nochmal probieren.')
  }
  if (!data?.content) throw new Error(data?.error ?? 'Leere Antwort von der KI.')
  return data.content
}

/** Holt das erste JSON-Objekt/-Array aus einer KI-Antwort. */
export function parseJson<T>(text: string): T {
  const clean = text.replace(/```(?:json)?/g, '')
  const start = clean.search(/[[{]/)
  const end = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error('Die KI-Antwort war unbrauchbar. Nochmal probieren.')
  return JSON.parse(clean.slice(start, end + 1)) as T
}
