import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './supabase'

type Article = {
  id: number
  code: string | null
  name: string
  source: string | null
  locations: { name: string } | null
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configured) return <Shell><NotConfigured /></Shell>
  if (!ready) return <Shell><p className="muted">Lade …</p></Shell>
  return <Shell>{session ? <Status email={session.user.email ?? ''} /> : <Login />}</Shell>
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="top">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={32} height={32} />
        <h1>Vorrat</h1>
      </header>
      <main>{children}</main>
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="card">
      <h2>Noch nicht verbunden</h2>
      <p className="muted">
        Die Supabase-Zugangsdaten fehlen. Trag sie in <code>.env.local</code> (lokal) bzw.{' '}
        <code>.env.production</code> ein.
      </p>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState(() => localStorage.getItem('login-email') ?? '')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { localStorage.setItem('login-email', email) } catch { /* egal */ }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      setError(
        /rate limit/i.test(error.message)
          ? 'Zu viele Mails in kurzer Zeit. Bitte in einer Stunde nochmal versuchen.'
          : /not allowed|signups/i.test(error.message)
            ? 'Diese E-Mail ist nicht freigeschaltet.'
            : error.message,
      )
    } else setSent(true)
    setBusy(false)
  }

  if (sent)
    return (
      <div className="card">
        <h2>Mail ist unterwegs</h2>
        <p>Öffne die Mail von Supabase an <b>{email}</b> und tippe auf <b>Sign in</b>. Danach bist du angemeldet und bleibst es.</p>
        <button className="link" onClick={() => setSent(false)}>Andere E-Mail / nochmal senden</button>
      </div>
    )

  return (
    <form className="card" onSubmit={submit}>
      <h2>Anmelden</h2>
      <p className="muted">Kein Passwort nötig: Du bekommst einen Anmelde-Link per Mail.</p>
      <label>
        E-Mail
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Sende …' : 'Anmelde-Link schicken'}</button>
    </form>
  )
}

function Status({ email }: { email: string }) {
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [dishes, setDishes] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const a = await supabase.from('articles').select('id, code, name, source, locations(name)').order('code')
      if (a.error) return setError(a.error.message)
      setArticles(a.data as unknown as Article[])
      const d = await supabase.from('dishes').select('id', { count: 'exact', head: true })
      if (d.error) return setError(d.error.message)
      setDishes(d.count ?? 0)
    }
    load()
  }, [])

  const byLocation = new Map<string, Article[]>()
  for (const a of articles ?? []) {
    const k = a.locations?.name ?? 'Ohne Lagerort'
    byLocation.set(k, [...(byLocation.get(k) ?? []), a])
  }

  return (
    <>
      <div className="card ok">
        <h2>Verbindung steht</h2>
        {error ? (
          <p className="error">Fehler: {error}</p>
        ) : (
          <p>{articles ? `${articles.length} Artikel` : '…'} · {dishes ?? '…'} Gerichte im Katalog</p>
        )}
        <p className="muted small">
          Angemeldet als {email} ·{' '}
          <button className="link" onClick={() => supabase.auth.signOut()}>Abmelden</button>
        </p>
      </div>

      {[...byLocation].map(([loc, list]) => (
        <section key={loc}>
          <h3>
            {loc} <span className="muted">({list.length})</span>
          </h3>
          <ul className="list">
            {list.map((a) => (
              <li key={a.id}>
                <span>{a.name}</span>
                <span className={`tag ${(a.source ?? '').replace(/\s/g, '').toLowerCase()}`}>{a.source ?? '–'}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
