import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './supabase'
import { db } from './db'
import { useData } from './data'
import { startAutoSync, sync, useSyncStatus } from './sync'
import { Icon, Sheet, ToastProvider } from './ui/common'
import { Login, SetPassword } from './ui/Login'
import { StockView } from './ui/StockView'
import { ScanView } from './ui/ScanView'
import { ShoppingView } from './ui/ShoppingView'
import { ArticleSheet } from './ui/ArticleSheet'
import { StockInSheet, type StockInRequest } from './ui/StockIn'
import { ExpiryView, expiringCount } from './ui/ExpiryView'
import { RecipesView } from './ui/RecipesView'
import { AssistantSheet } from './ui/Assistant'
import { OffersView } from './ui/OffersView'

type Tab = 'stock' | 'mhd' | 'scan' | 'recipes' | 'shop' | 'offers'
const TITLES: Record<Tab, string> = { stock: 'Vorrat', mhd: 'Haltbarkeit', scan: 'Scannen', recipes: 'Rezepte', shop: 'Einkauf', offers: 'Angebote' }
const HASH: Record<Tab, string> = { stock: '#', mhd: '#mhd', scan: '#scan', recipes: '#rezepte', shop: '#einkauf', offers: '#angebote' }
const fromHash = (): Tab => (Object.entries(HASH).find(([, h]) => h === location.hash)?.[0] as Tab) ?? 'stock'

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
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#sprechen' ? 'stock' : fromHash()))
  const [talk, setTalk] = useState(() => location.hash === '#sprechen')
  const [openId, setOpenId] = useState<number | null>(null)
  const [stockIn, setStockIn] = useState<StockInRequest | null>(null)

  useEffect(() => startAutoSync(), [])
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ articleId: number; amount: number }>).detail
      const a = data.articleById.get(d.articleId)
      if (a) setStockIn({ article: a, amount: d.amount })
    }
    window.addEventListener('vorrat:stockin', on)
    return () => window.removeEventListener('vorrat:stockin', on)
  }, [data.articleById])
  useEffect(() => {
    history.replaceState(null, '', HASH[tab])
  }, [tab])

  const openCount = data.shopping.filter((s) => s.status === 'open').length
  const firstLoad = data.articles.length === 0
  const expCount = expiringCount(data)

  return (
    <div className="app">
      <header className="top">
        <h1>{TITLES[tab]}</h1>
        <div className="top-actions">
          <button className={`talk-btn ${tab === 'offers' ? 'on' : ''}`} onClick={() => setTab('offers')} aria-label="Angebote"><Icon.tag /></button>
          <button className="talk-btn" onClick={() => setTalk(true)} aria-label="Sprechen oder tippen"><Icon.mic /></button>
          <SyncBadge pending={data.pending} />
        </div>
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
        ) : tab === 'mhd' ? (
          <ExpiryView data={data} onOpen={(a) => setOpenId(a.id)} />
        ) : tab === 'recipes' ? (
          <RecipesView data={data} />
        ) : tab === 'offers' ? (
          <OffersView data={data} onOpen={(a) => setOpenId(a.id)} />
        ) : tab === 'scan' ? (
          <ScanView data={data} />
        ) : (
          <ShoppingView data={data} onOpen={(a) => setOpenId(a.id)} onStockIn={(a, amount) => setStockIn({ article: a, amount })} />
        )}
      </main>

      <nav className="tabbar">
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>
          <Icon.box />
          <span>Vorrat</span>
        </button>
        <button className={tab === 'mhd' ? 'on' : ''} onClick={() => setTab('mhd')}>
          <Icon.clock />
          <span>MHD</span>
          {expCount > 0 && <i className="badge soon">{expCount}</i>}
        </button>
        <button className={`fab ${tab === 'scan' ? 'on' : ''}`} onClick={() => setTab('scan')} aria-label="Scannen">
          <Icon.scan />
        </button>
        <button className={tab === 'recipes' ? 'on' : ''} onClick={() => setTab('recipes')}>
          <Icon.chef />
          <span>Rezepte</span>
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
          setStockIn({ article: a })
        }}
      />
      <StockInSheet req={stockIn} data={data} onClose={() => setStockIn(null)} />
      <AssistantSheet open={talk} onClose={() => setTalk(false)} data={data} autoListen={location.hash === '#sprechen'} />
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
