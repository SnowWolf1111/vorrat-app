import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './supabase'
import { db, type Article } from './db'
import { useData } from './data'
import { startAutoSync, sync, useSyncStatus } from './sync'
import { Icon, Sheet, ToastProvider } from './ui/common'
import { Login, SetPassword } from './ui/Login'
import { StockView } from './ui/StockView'
import { ScanView } from './ui/ScanView'
import { ShoppingView } from './ui/ShoppingView'
import { ArticleSheet } from './ui/ArticleSheet'
import { StockInSheet } from './ui/StockIn'

type Tab = 'stock' | 'scan' | 'shop'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV && location.search.includes('demo')) {
      import('./demo').then((m) => m.seedDemo()).then(() => {
        setSession({} as Session)
        setReady(true)
      })
      return
    }
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configured) return <div className="center-screen">Supabase-Zugangsdaten fehlen (.env.local).</div>
  if (!ready) return <div className="center-screen muted">Lade …</div>
  return <ToastProvider>{session ? <Main session={session} /> : <Login />}</ToastProvider>
}

function Main({ session }: { session: Session }) {
  const data = useData()
  const [pwSheet, setPwSheet] = useState(false)
  const [hasPw, setHasPw] = useState(() => !session.user || !!session.user.user_metadata?.has_password)
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#einkauf' ? 'shop' : 'stock'))
  const [openId, setOpenId] = useState<number | null>(null)
  const [stockIn, setStockIn] = useState<Article | null>(null)

  useEffect(() => startAutoSync(), [])
  useEffect(() => {
    history.replaceState(null, '', tab === 'shop' ? '#einkauf' : tab === 'scan' ? '#scan' : '#')
  }, [tab])

  const openCount = data.shopping.filter((s) => s.status === 'open').length
  const firstLoad = data.articles.length === 0

  return (
    <div className="app">
      <header className="top">
        <h1>{tab === 'stock' ? 'Vorrat' : tab === 'scan' ? 'Scannen' : 'Einkauf'}</h1>
        <SyncBadge pending={data.pending} />
      </header>

      <main>
        {!hasPw && (
          <button className="pw-banner" onClick={() => setPwSheet(true)}>
            <b>Passwort festlegen</b>
            <span>Dann brauchst du nie wieder einen Mail-Link.</span>
          </button>
        )}
        {firstLoad ? (
          <div className="center-screen muted">Lade deine Daten …</div>
        ) : tab === 'stock' ? (
          <StockView data={data} onOpen={(a) => setOpenId(a.id)} />
        ) : tab === 'scan' ? (
          <ScanView data={data} />
        ) : (
          <ShoppingView data={data} onOpen={(a) => setOpenId(a.id)} />
        )}
      </main>

      <nav className="tabbar">
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>
          <Icon.box />
          <span>Vorrat</span>
        </button>
        <button className={`fab ${tab === 'scan' ? 'on' : ''}`} onClick={() => setTab('scan')} aria-label="Scannen">
          <Icon.scan />
        </button>
        <button className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>
          <Icon.cart />
          <span>Einkauf</span>
          {openCount > 0 && <i className="badge">{openCount}</i>}
        </button>
      </nav>

      <ArticleSheet
        articleId={openId}
        data={data}
        onClose={() => setOpenId(null)}
        onStockIn={(a) => {
          setOpenId(null)
          setStockIn(a)
        }}
      />
      <StockInSheet article={stockIn} data={data} onClose={() => setStockIn(null)} />
      <Sheet open={pwSheet} onClose={() => setPwSheet(false)} title="Passwort festlegen">
        <SetPassword
          email={session.user?.email ?? ''}
          onDone={() => {
            setHasPw(true)
            setPwSheet(false)
          }}
        />
      </Sheet>
    </div>
  )
}

function SyncBadge({ pending }: { pending: number }) {
  const s = useSyncStatus()
  const [menu, setMenu] = useState(false)
  const label =
    s.state === 'offline'
      ? pending
        ? `Offline · ${pending} wartet`
        : 'Offline'
      : s.state === 'syncing'
        ? 'Abgleich …'
        : s.state === 'error'
          ? 'Fehler beim Abgleich'
          : pending
            ? `${pending} wartet`
            : 'Aktuell'
  return (
    <div className="sync-wrap">
      <button className={`sync ${s.state}`} onClick={() => setMenu(!menu)}>
        {s.state === 'offline' ? <Icon.cloudOff /> : <Icon.refresh />}
        <span>{label}</span>
      </button>
      {menu && (
        <div className="menu" onClick={() => setMenu(false)}>
          {s.message && <p className="error small">{s.message}</p>}
          <button onClick={() => sync()}><Icon.refresh /> Jetzt abgleichen</button>
          <button
            onClick={async () => {
              if (pending && !confirm(`${pending} Änderungen sind noch nicht hochgeladen und gehen verloren. Trotzdem abmelden?`)) return
              await supabase.auth.signOut()
              await db.delete()
              location.reload()
            }}
          >
            <Icon.logout /> Abmelden
          </button>
        </div>
      )}
    </div>
  )
}
