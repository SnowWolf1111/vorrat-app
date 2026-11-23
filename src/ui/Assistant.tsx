import { useEffect, useRef, useState } from 'react'
import type { Article } from '../db'
import type { Data } from '../data'
import { aiParse, parseCommands, type Cmd } from '../commands'
import { addShopping, addStock, consume } from '../actions'
import { fmtAmount, vibrate } from '../format'
import { Icon, Sheet, Thumb, useToast } from './common'
import { articleImage } from '../data'

type Rec = { start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; onerror: (e: { error: string }) => void; lang: string; interimResults: boolean; continuous: boolean }
const SpeechRec = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition

const VERB: Record<Cmd['kind'], string> = { consume: 'Verbrauchen', add: 'Einlagern', shop: 'Auf die Liste', query: 'Bestand' }

export function AssistantSheet({ open, onClose, data, autoListen }: { open: boolean; onClose: () => void; data: Data; autoListen?: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title="Sagen oder tippen">
      {open && <Assistant data={data} onClose={onClose} autoListen={autoListen} />}
    </Sheet>
  )
}

function Assistant({ data, onClose, autoListen }: { data: Data; onClose: () => void; autoListen?: boolean }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [cmds, setCmds] = useState<Cmd[] | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Rec | null>(null)

  function analyse(t: string) {
    setError(null)
    const c = parseCommands(t, data)
    setCmds(c)
  }

  function listen() {
    if (!SpeechRec) return setError('Spracheingabe kann dieser Browser nicht. Am Handy in Chrome geht es.')
    const r = new SpeechRec()
    r.lang = 'de-DE'
    r.interimResults = true
    r.continuous = false
    let finalText = ''
    r.onresult = (e) => {
      const t = Array.from(e.results).map((x) => x[0].transcript).join(' ')
      setText(t)
      if (Array.from(e.results).every((x) => x.isFinal)) finalText = t
    }
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Mikrofon ist nicht erlaubt (Schloss neben der Adresse → Mikrofon).' : 'Nicht verstanden. Nochmal?')
    r.onend = () => {
      setListening(false)
      if (finalText) analyse(finalText)
    }
    rec.current = r
    setCmds(null)
    setListening(true)
    r.start()
  }

  useEffect(() => {
    if (autoListen) listen()
    return () => rec.current?.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function askAi() {
    setAiBusy(true)
    setError(null)
    try {
      setCmds(await aiParse(text, data))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAiBusy(false)
    }
  }

  async function run() {
    if (!cmds) return
    const done: string[] = []
    for (const c of cmds) {
      const a = c.article
      if (!a || c.kind === 'query') continue
      if (c.kind === 'consume') {
        const r = await consume(a, c.amount)
        done.push(r.taken ? `−${fmtAmount(r.taken)} ${a.name}` : `${a.name}: nichts im Bestand`)
      } else if (c.kind === 'add') {
        await addStock(a, c.amount, a.default_location_id ?? data.locations[0].id, null)
        done.push(`+${fmtAmount(c.amount)} ${a.name}`)
      } else if (c.kind === 'shop') {
        await addShopping({ article: a, amount: c.amount })
        done.push(`${a.name} auf der Liste`)
      }
    }
    vibrate()
    toast(done.join(' · ') || 'Nichts zu tun', done.length ? 'ok' : 'warn')
    onClose()
  }

  const setArticle = (i: number, a: Article) => setCmds((cs) => cs!.map((c, j) => (j === i ? { ...c, article: a } : c)))
  const runnable = cmds?.some((c) => c.article && c.kind !== 'query')

  return (
    <div className="assistant">
      <button className={`mic ${listening ? 'on' : ''}`} onClick={() => (listening ? rec.current?.stop() : listen())} aria-label="Sprechen">
        <Icon.mic />
      </button>
      <p className="muted small center">{listening ? 'Ich höre zu …' : 'z. B. „minus 1 Ketchup“, „2 Pommes eingelagert“, „Salz auf die Liste“'}</p>

      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault()
          analyse(text)
        }}
      >
        <input placeholder="Befehl tippen …" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="icon-btn" aria-label="Los" disabled={!text.trim()}><Icon.send /></button>
      </form>
      {error && <p className="error small">{error}</p>}

      {cmds && (
        <>
          {cmds.length === 0 && <p className="muted">Nichts erkannt.</p>}
          <ul className="rows card-list">
            {cmds.map((c, i) => {
              const s = c.article ? data.stock.get(c.article.id) : undefined
              return (
                <li key={i} className="cmd">
                  <div className="cmd-head">
                    <span className={`pill ${c.kind === 'consume' ? 'expired' : c.kind === 'add' ? 'ok-pill' : ''}`}>{VERB[c.kind]}</span>
                    {c.kind !== 'query' && <b>{fmtAmount(c.amount)}×</b>}
                    {c.article ? (
                      <>
                        <Thumb src={articleImage(c.article, data)} name={c.article.name} size={28} />
                        <b className="grow">{c.article.name}</b>
                        <span className="muted small">da: {fmtAmount(s?.total ?? 0)}</span>
                      </>
                    ) : (
                      <span className="warn-text grow">„{c.query}“ – welcher Artikel?</span>
                    )}
                  </div>
                  {(!c.article || c.candidates.length > 1) && c.candidates.length > 0 && (
                    <div className="chips">
                      {c.candidates.map((a) => (
                        <button key={a.id} className={`chip ${c.article?.id === a.id ? 'on' : ''}`} onClick={() => setArticle(i, a)}>{a.name}</button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="btn-row">
            <button className="secondary" onClick={askAi} disabled={aiBusy || !text.trim()}>
              <Icon.sparkle /> {aiBusy ? 'KI denkt …' : 'KI fragen'}
            </button>
            <button className="primary" onClick={run} disabled={!runnable}>Ausführen</button>
          </div>
        </>
      )}
    </div>
  )
}
