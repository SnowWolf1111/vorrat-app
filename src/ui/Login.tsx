import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'

export function Login() {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('login-email') ?? ''
    } catch {
      return ''
    }
  })
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Gmail kennt beide Schreibweisen, Supabase nicht
    const normalized = email.trim().toLowerCase().replace(/@googlemail\.com$/, '@gmail.com')
    try {
      localStorage.setItem('login-email', normalized)
    } catch {
      /* egal */
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      setError(
        /rate limit/i.test(error.message)
          ? 'Zu viele Mails in kurzer Zeit. Bitte in einer Stunde nochmal versuchen.'
          : /not allowed|signups/i.test(error.message)
            ? `Diese E-Mail ist nicht freigeschaltet (${error.message}).`
            : error.message,
      )
    } else setSent(true)
    setBusy(false)
  }

  return (
    <div className="login">
      <div className="login-brand">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={64} height={64} />
        <h1>Vorrat</h1>
        <p className="muted">Bestand, MHD und Einkaufsliste</p>
      </div>
      {sent ? (
        <div className="card">
          <h2>Mail ist unterwegs</h2>
          <p>
            Öffne die Mail von Supabase an <b>{email}</b> und tippe auf <b>Sign in</b>. Danach bist du angemeldet und bleibst es.
          </p>
          <button className="link" onClick={() => setSent(false)}>Andere E-Mail / nochmal senden</button>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <p className="muted">Kein Passwort nötig: Du bekommst einen Anmelde-Link per Mail.</p>
          <label className="field">
            <span className="field-label">E-Mail</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? 'Sende …' : 'Anmelde-Link schicken'}</button>
        </form>
      )}
    </div>
  )
}
