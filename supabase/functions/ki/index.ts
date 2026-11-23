// Vermittler zur kostenlosen KI (Pollinations). Pollinations blockt direkte Browser-Aufrufe,
// vom Server aus geht es. Nur eingeloggte Nutzer (JWT-Prüfung von Supabase).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { messages } = await req.json()
    if (!Array.isArray(messages) || JSON.stringify(messages).length > 60_000) {
      return new Response(JSON.stringify({ error: 'Ungültige Anfrage' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    const r = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages }),
    })
    const text = await r.text()
    if (!r.ok) {
      return new Response(JSON.stringify({ error: `KI-Dienst: ${r.status}`, detail: text.slice(0, 300) }), { status: r.status === 429 ? 429 : 502, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    const j = JSON.parse(text)
    return new Response(JSON.stringify({ content: j.choices?.[0]?.message?.content ?? '' }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
