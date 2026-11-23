import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'

const normalizeEmail = (e: string) => e.trim().toLowerCase().replace(/@googlemail\.com$/, '@gmail.com')

function savedEmail() {
  try {
    return localStorage.getItem('login-email') ?? ''
  } catch {
    return ''
  }
}

function translate(msg: string) {
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort falsch.'
  if (/rate limit/i.test(msg)) return 'Zu viele Mails in kurzer Zeit. Supabase erlaubt nur 2 pro Stunde.'
  if (/not allowed|signups/i.test(msg)) return 'Diese E-Mail ist nicht freigeschaltet.'
  return msg
}

export function Login() {
  const [email, setEmail] = useState(savedEmail)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkSent, setLinkSent] = useState(false)

  function remember(e: string) {
    try {
      localStorage.setItem('login-email', e)
    } catch {
      /* egal */
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true)
    setError(null)
    const e = normalizeEmail(email)
    remember(e)
    const { error } = await supabase.auth.signInWithPassword({ email: e, password })
    if (error) setError(translate(error.message))
    setBusy(false)
  }

  async function sendLink() {
    setBusy(true)
    setError(null)
    const e = normalizeEmail(email)
    remember(e)
    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) setError(translate(error.message))
    else setLinkSent(true)
    setBusy(false)
  }

  return (
    <div className="login">
      <div className="login-brand">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={64} height={64} />
        <h1>Vorrat</h1>
        <p className="muted">Bestand, MHD und Einkaufsliste</p>
      </div>
      <form className="card" onSubmit={submit}>
        <label className="field">
          <span className="field-label">E-Mail</span>
          <input type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Passwort</span>
          <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Moment …' : 'Anmelden'}</button>
      </form>
      <div className="card subtle">
        {linkSent ? (
          <p className="small">
            Link ist unterwegs. Danach in der App unter <b>Passwort festlegen</b> ein Passwort setzen, dann brauchst du keine Links mehr.
          </p>
        ) : (
          <>
            <p className="small muted">Noch kein Passwort oder vergessen? Einmalig per Mail-Link anmelden und dann ein Passwort festlegen.</p>
            <button className="link" type="button" onClick={sendLink} disabled={busy || !email}>Anmelde-Link schicken</button>
          </>
        )}
      </div>
    </div>
  )
}

/** Einmaliger Schritt nach Link-Anmeldung: Passwort setzen (der Nutzer tippt es selbst ein). */
export function SetPassword({ email, onDone }: { email: string; onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(ev: FormEvent) {
    ev.preventDefault()
    if (pw.length < 8) return setError('Mindestens 8 Zeichen.')
    if (pw !== pw2) return setError('Die beiden Passwörter sind nicht gleich.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: pw, data: { has_password: true } })
    setBusy(false)
    if (error) return setError(error.message)
    onDone()
  }

  return (
    <form className="form" onSubmit={save}>
      <p className="small muted">Danach meldest du dich überall mit E-Mail und Passwort an. Chrome bietet an, es zu speichern.</p>
      {/* damit der Passwort-Manager weiß, zu welcher E-Mail das Passwort gehört */}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <label className="field">
        <span className="field-label">Neues Passwort</span>
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Nochmal</span>
        <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Speichere …' : 'Passwort speichern'}</button>
    </form>
  )
}
