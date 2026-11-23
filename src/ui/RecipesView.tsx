import { useState } from 'react'
import type { Article, Dish, DishItem } from '../db'
import { articleImage, searchArticles, type Data } from '../data'
import { addShopping, consume, deleteDish, saveDish, type DishItemDraft } from '../actions'
import { askAI, parseJson } from '../ai'
import { findArticles } from '../commands'
import { fmtAmount, vibrate } from '../format'
import { Empty, Icon, Sheet, Stepper, Thumb, useToast } from './common'

// ---------- Verfügbarkeit ----------
type Need = { items: DraftItem[]; optional: boolean; ok: boolean | null } // null = Freitext, nicht prüfbar
type DraftItem = DishItemDraft & { key: string }

function needs(items: DraftItem[], data: Data): Need[] {
  const groups = new Map<string, DraftItem[]>()
  for (const i of items) {
    const k = i.alt_group != null ? 'g' + i.alt_group : i.key
    groups.set(k, [...(groups.get(k) ?? []), i])
  }
  return [...groups.values()].map((g) => {
    const withArticle = g.filter((i) => i.article_id != null && data.articleById.has(i.article_id))
    const ok = withArticle.length ? withArticle.some((i) => (data.stock.get(i.article_id!)?.total ?? 0) > 0) : null
    return { items: g, optional: g.every((i) => i.optional), ok }
  })
}

export function dishStatus(items: DraftItem[], data: Data) {
  const n = needs(items, data)
  const missing = n.filter((x) => !x.optional && x.ok === false)
  return { needs: n, missing, canCook: missing.length === 0 }
}

const itemName = (i: DishItemDraft, data: Data) => (i.article_id != null ? data.articleById.get(i.article_id)?.name ?? '(gelöschter Artikel)' : i.free_text ?? '')
const toDraft = (items: DishItem[]): DraftItem[] => items.map((i) => ({ key: String(i.id), article_id: i.article_id, free_text: i.free_text, optional: i.optional, alt_group: i.alt_group, amount: i.amount, unit: i.unit }))
const scaled = (amount: number | null, from: number, to: number) => (amount == null ? null : Math.round(((amount * to) / Math.max(1, from)) * 100) / 100)

// ---------- Liste ----------
export function RecipesView({ data }: { data: Data }) {
  const [openId, setOpenId] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ dish?: Dish; items?: DraftItem[] } | null>(null)
  const [ai, setAi] = useState(false)
  const [onlyCookable, setOnlyCookable] = useState(false)
  const [q, setQ] = useState('')

  const list = data.dishes
    .map((d) => ({ d, st: dishStatus(toDraft(data.dishItems.filter((i) => i.dish_id === d.id)), data) }))
    .filter((x) => (!onlyCookable || x.st.canCook) && (!q || x.d.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.st.missing.length - b.st.missing.length || a.d.name.localeCompare(b.d.name, 'de'))
  const cookable = data.dishes.filter((d) => dishStatus(toDraft(data.dishItems.filter((i) => i.dish_id === d.id)), data).canCook).length
  const open = openId != null ? data.dishes.find((d) => d.id === openId) : undefined

  return (
    <div className="view">
      <div className="btn-row">
        <button className="primary" onClick={() => setAi(true)}><Icon.sparkle /> Rezept-Idee (KI)</button>
        <button className="secondary" onClick={() => setEditing({})}><Icon.plus /> Eigenes</button>
      </div>
      <div className="search-row">
        <div className="search grow">
          <Icon.search />
          <input placeholder="Rezept suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className={`chip ${onlyCookable ? 'on' : ''}`} onClick={() => setOnlyCookable(!onlyCookable)}>Kann ich kochen ({cookable})</button>
      </div>

      {list.length === 0 && <Empty title={onlyCookable ? 'Gerade fehlt überall was' : 'Keine Rezepte'}>{onlyCookable ? 'Filter ausschalten, dann siehst du, was fehlt.' : 'Lass dir von der KI was vorschlagen.'}</Empty>}

      <ul className="rows card-list">
        {list.map(({ d, st }) => (
          <li key={d.id}>
            <button className="row" onClick={() => setOpenId(d.id)}>
              <span className={`status-dot ${st.canCook ? 'ok' : st.missing.length <= 1 ? 'soon' : 'expired'}`} />
              <span className="row-main">
                <span className="row-title">{d.name}</span>
                <span className="row-sub">
                  {st.canCook ? <span className="ok-text">Alles da</span> : <span>Fehlt: {st.missing.map((m) => m.items.map((i) => itemName(i, data)).join(' / ')).join(', ')}</span>}
                  {d.origin === 'ki' && <span className="pill">KI</span>}
                </span>
              </span>
              <span className="muted small">{d.servings} P.</span>
            </button>
          </li>
        ))}
      </ul>

      <RecipeSheet dish={open} data={data} onClose={() => setOpenId(null)} onEdit={(dish, items) => { setOpenId(null); setEditing({ dish, items }) }} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.dish?.id ? 'Rezept bearbeiten' : 'Neues Rezept'} tall>
        {editing && <RecipeEditor key={editing.dish?.id ?? 'new'} data={data} dish={editing.dish} items={editing.items} onDone={(id) => { setEditing(null); if (id) setOpenId(id) }} />}
      </Sheet>
      <Sheet open={ai} onClose={() => setAi(false)} title="Rezept-Idee mit KI" tall>
        {ai && <AiRecipe data={data} onSaved={(id) => { setAi(false); setOpenId(id) }} />}
      </Sheet>
    </div>
  )
}

// ---------- Detail ----------
function RecipeSheet({ dish, data, onClose, onEdit }: { dish?: Dish; data: Data; onClose: () => void; onEdit: (d: Dish, items: DraftItem[]) => void }) {
  return (
    <Sheet open={!!dish} onClose={onClose} title={dish?.name ?? ''} tall>
      {dish && <RecipeDetail key={dish.id} dish={dish} data={data} onEdit={onEdit} onClose={onClose} />}
    </Sheet>
  )
}

function RecipeDetail({ dish, data, onEdit, onClose }: { dish: Dish; data: Data; onEdit: (d: Dish, items: DraftItem[]) => void; onClose: () => void }) {
  const toast = useToast()
  const items = toDraft(data.dishItems.filter((i) => i.dish_id === dish.id))
  const [servings, setServings] = useState(dish.servings || 2)
  const [cooking, setCooking] = useState(false)
  const st = dishStatus(items, data)

  async function shopMissing() {
    for (const m of st.missing) {
      const i = m.items.find((x) => x.article_id != null)
      const a = i && data.articleById.get(i.article_id!)
      if (a) await addShopping({ article: a })
    }
    toast(`${st.missing.length} Zutat(en) auf der Einkaufsliste`, 'ok')
  }

  return (
    <div className="detail">
      <div className="field inline">
        <span className="field-label">Portionen</span>
        <Stepper value={servings} min={1} onChange={(v) => setServings(Math.max(1, Math.round(v)))} />
      </div>
      <IngredientList items={items} data={data} from={dish.servings || 2} to={servings} />
      {dish.hint && <p className="muted small">{dish.hint}</p>}
      {dish.instructions && (
        <div className="card steps">
          <b>Zubereitung</b>
          <ol>{dish.instructions.split('\n').filter(Boolean).map((s, i) => <li key={i}>{s.replace(/^\d+[.)]\s*/, '')}</li>)}</ol>
        </div>
      )}
      {st.missing.length > 0 && (
        <button className="secondary" onClick={shopMissing}><Icon.cart /> Fehlendes auf die Einkaufsliste ({st.missing.length})</button>
      )}
      <button className="primary" onClick={() => setCooking(true)}><Icon.chef /> Gekocht – Zutaten austragen</button>
      <div className="btn-row">
        <button className="secondary" onClick={() => onEdit(dish, items)}><Icon.edit /> Bearbeiten</button>
        <button
          className="secondary danger"
          onClick={async () => {
            if (!confirm(`Rezept „${dish.name}“ löschen?`)) return
            try {
              await deleteDish(dish.id)
              toast('Rezept gelöscht', 'ok')
              onClose()
            } catch (e) {
              toast((e as Error).message, 'warn')
            }
          }}
        >
          <Icon.trash /> Löschen
        </button>
      </div>
      <Sheet open={cooking} onClose={() => setCooking(false)} title="Was hast du verbraucht?">
        {cooking && <CookForm items={items} data={data} onDone={() => setCooking(false)} />}
      </Sheet>
    </div>
  )
}

function IngredientList({ items, data, from, to }: { items: DraftItem[]; data: Data; from: number; to: number }) {
  const st = dishStatus(items, data)
  return (
    <ul className="rows card-list ingredients">
      {st.needs.map((n, idx) => (
        <li key={idx}>
          <span className={`status-dot ${n.ok === null ? 'none' : n.ok ? 'ok' : n.optional ? 'soon' : 'expired'}`} />
          <span className="row-main">
            <span>
              {n.items.map((i, j) => {
                const amt = scaled(i.amount, from, to)
                const a = i.article_id != null ? data.articleById.get(i.article_id) : undefined
                const have = a ? data.stock.get(a.id)?.total ?? 0 : null
                return (
                  <span key={i.key}>
                    {j > 0 && <span className="muted"> oder </span>}
                    {amt != null && <b>{fmtAmount(amt)}{i.unit ? ` ${i.unit}` : ''} </b>}
                    {itemName(i, data)}
                    {have != null && <span className="muted small"> (da: {fmtAmount(have)})</span>}
                  </span>
                )
              })}
              {n.optional && <span className="muted small"> · optional</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function CookForm({ items, data, onDone }: { items: DraftItem[]; data: Data; onDone: () => void }) {
  const toast = useToast()
  const usable = items.filter((i) => i.article_id != null && (data.stock.get(i.article_id)?.total ?? 0) > 0)
  const [amounts, setAmounts] = useState<Record<string, number>>(() => Object.fromEntries(usable.map((i) => [i.key, i.optional ? 0 : 1])))
  if (!usable.length) return <p className="muted">Keine der Zutaten ist laut App im Bestand.</p>
  return (
    <div className="form compact">
      <p className="small muted">Packungen, die du aufgebraucht oder angebrochen hast. Älteste MHD zuerst.</p>
      {usable.map((i) => {
        const a = data.articleById.get(i.article_id!)!
        return (
          <div key={i.key} className="field inline">
            <span className="cook-name"><Thumb src={articleImage(a, data)} name={a.name} size={28} /> {a.name}</span>
            <Stepper value={amounts[i.key] ?? 0} onChange={(v) => setAmounts({ ...amounts, [i.key]: v })} step={1} />
          </div>
        )
      })}
      <button
        className="primary"
        onClick={async () => {
          let n = 0
          for (const i of usable) {
            const amt = amounts[i.key] ?? 0
            if (amt > 0) {
              n += (await consume(data.articleById.get(i.article_id!)!, amt)).taken
            }
          }
          vibrate()
          toast(`${fmtAmount(n)} Packung(en) ausgetragen. Guten Appetit!`, 'ok')
          onDone()
        }}
      >
        Austragen
      </button>
    </div>
  )
}

// ---------- Editor ----------
function RecipeEditor({ data, dish, items: initial, onDone }: { data: Data; dish?: Dish; items?: DraftItem[]; onDone: (id?: number) => void }) {
  const toast = useToast()
  const [name, setName] = useState(dish?.name ?? '')
  const [servings, setServings] = useState(dish?.servings ?? 2)
  const [hint, setHint] = useState(dish?.hint ?? '')
  const [instructions, setInstructions] = useState(dish?.instructions ?? '')
  const [items, setItems] = useState<DraftItem[]>(initial ?? [])
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState('')

  const upd = (k: string, p: Partial<DraftItem>) => setItems((xs) => xs.map((x) => (x.key === k ? { ...x, ...p } : x)))
  const suggestions = adding.trim().length >= 2 ? searchArticles(data.articles, adding).slice(0, 5) : []
  const addItem = (a?: Article) => {
    setItems((xs) => [...xs, { key: crypto.randomUUID(), article_id: a?.id ?? null, free_text: a ? null : adding.trim(), optional: false, alt_group: null, amount: null, unit: null }])
    setAdding('')
  }

  async function save() {
    setBusy(true)
    try {
      const id = await saveDish(
        { id: dish?.id, name, servings, hint: hint.trim() || null, instructions: instructions.trim() || null, origin: dish?.origin ?? 'eigen' },
        items.map(({ key: _k, ...i }) => i),
      )
      toast('Rezept gespeichert', 'ok')
      onDone(id)
    } catch (e) {
      toast(navigator.onLine ? (e as Error).message : 'Rezepte speichern braucht Internet.', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form compact">
      <label className="field"><span className="field-label">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Chili con Carne" /></label>
      <div className="field inline"><span className="field-label">Portionen</span><Stepper value={servings} min={1} onChange={(v) => setServings(Math.max(1, Math.round(v)))} /></div>

      <div className="field">
        <span className="field-label">Zutaten</span>
        <ul className="rows card-list edit-items">
          {items.map((i) => (
            <li key={i.key}>
              <span className="grow">{itemName(i, data)}</span>
              <input className="mini" inputMode="decimal" placeholder="Menge" value={i.amount != null ? String(i.amount).replace('.', ',') : ''} onChange={(e) => upd(i.key, { amount: e.target.value ? Number(e.target.value.replace(',', '.')) || null : null })} />
              <input className="mini" placeholder="Einh." value={i.unit ?? ''} onChange={(e) => upd(i.key, { unit: e.target.value || null })} />
              <button className={`chip small-chip ${i.optional ? 'on' : ''}`} onClick={() => upd(i.key, { optional: !i.optional })}>opt.</button>
              <button className="icon-btn" onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))} aria-label="Zutat entfernen"><Icon.trash /></button>
            </li>
          ))}
        </ul>
        <div className="search add">
          <Icon.plus />
          <input placeholder="Zutat hinzufügen …" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem(suggestions[0]))} />
        </div>
        {adding.trim().length >= 2 && (
          <ul className="suggest">
            {suggestions.map((a) => <li key={a.id}><button onClick={() => addItem(a)}>{a.name}</button></li>)}
            <li><button onClick={() => addItem()}>„{adding.trim()}“ als Freitext (wird nicht geprüft)</button></li>
          </ul>
        )}
      </div>

      <label className="field"><span className="field-label">Zubereitung (eine Zeile pro Schritt)</span><textarea rows={6} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></label>
      <label className="field"><span className="field-label">Tipp</span><input value={hint} onChange={(e) => setHint(e.target.value)} /></label>
      <button className="primary" onClick={save} disabled={busy || name.trim().length < 2}>{busy ? 'Speichere …' : 'Speichern'}</button>
    </div>
  )
}

// ---------- KI ----------
type AiOut = { name: string; servings?: number; hint?: string; ingredients: { article_id?: number | null; name: string; amount?: number | null; unit?: string | null; optional?: boolean }[]; steps: string[] }

function AiRecipe({ data, onSaved }: { data: Data; onSaved: (id: number) => void }) {
  const toast = useToast()
  const [wish, setWish] = useState('')
  const [servings, setServings] = useState(2)
  const [onlyStock, setOnlyStock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ out: AiOut; items: DraftItem[] } | null>(null)

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const inStock = [...data.stock.values()].filter((s) => s.total > 0).map((s) => `${s.article.id}: ${s.article.name} (${s.total}× ${s.article.unit ?? ''})`)
      const catalog = data.articles.map((a) => `${a.id}: ${a.name}`)
      const text = await askAI([
        {
          role: 'system',
          content:
            'Du bist ein Koch für einfache, alltagstaugliche Gerichte (Airfryer, Pfanne, Reiskocher sind vorhanden). Antworte NUR mit JSON: ' +
            '{"name":"…","servings":2,"hint":"kurzer Tipp","ingredients":[{"article_id":12,"name":"Hackfleisch","amount":500,"unit":"g","optional":false}],"steps":["…","…"]}. ' +
            'article_id = Nummer aus der Katalogliste, wenn die Zutat dort vorkommt, sonst null. Salz/Pfeffer usw. sind eigene Artikel. Mengen für die gewünschten Portionen. Auf Deutsch.',
        },
        {
          role: 'user',
          content:
            `Portionen: ${servings}\nWunsch: ${wish.trim() || 'egal, überrasch mich'}\n` +
            (onlyStock ? 'Nimm möglichst NUR Zutaten, die vorrätig sind (Gewürze/Öl darf).\n' : 'Zutaten dürfen auch fehlen.\n') +
            `Vorrätig:\n${inStock.join('\n') || '(nichts eingetragen)'}\n\nKatalog:\n${catalog.join('\n')}`,
        },
      ])
      const out = parseJson<AiOut>(text)
      if (!out?.name || !Array.isArray(out.ingredients)) throw new Error('Die KI-Antwort war unbrauchbar. Nochmal probieren.')
      const items: DraftItem[] = out.ingredients.map((g) => {
        let id = g.article_id != null && data.articleById.has(Number(g.article_id)) ? Number(g.article_id) : null
        if (id == null) {
          const f = findArticles(g.name, data)[0]
          if (f && f.score >= 3) id = f.article.id
        }
        return { key: crypto.randomUUID(), article_id: id, free_text: id == null ? g.name : null, amount: g.amount != null ? Number(g.amount) || null : null, unit: g.unit ?? null, optional: !!g.optional, alt_group: null }
      })
      setResult({ out: { ...out, servings: out.servings ?? servings }, items })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!result) return
    setBusy(true)
    try {
      const id = await saveDish(
        { name: result.out.name, servings: result.out.servings ?? servings, hint: result.out.hint ?? null, instructions: result.out.steps.join('\n'), origin: 'ki' },
        result.items.map(({ key: _k, ...i }) => i),
      )
      toast('Rezept gespeichert', 'ok')
      onSaved(id)
    } catch (e) {
      toast((e as Error).message, 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form compact">
      <label className="field">
        <span className="field-label">Worauf hast du Lust? (optional)</span>
        <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder="z. B. was mit Hack, schnell, asiatisch …" />
      </label>
      <div className="field inline"><span className="field-label">Portionen</span><Stepper value={servings} min={1} onChange={(v) => setServings(Math.max(1, Math.round(v)))} /></div>
      <label className="toggle"><input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Nur mit dem, was da ist</label>
      <button className="primary" onClick={generate} disabled={busy}><Icon.sparkle /> {busy && !result ? 'KI kocht …' : result ? 'Andere Idee' : 'Vorschlag holen'}</button>
      <p className="hint">Kostenlose KI (Pollinations), läuft nicht über dein Claude-Guthaben. Geschickt werden nur Artikelnamen und dein Wunsch.</p>
      {error && <p className="error small">{error}</p>}

      {result && (
        <div className="card">
          <h2>{result.out.name}</h2>
          <IngredientList items={result.items} data={data} from={result.out.servings ?? servings} to={result.out.servings ?? servings} />
          {result.out.hint && <p className="muted small">{result.out.hint}</p>}
          <ol className="steps-list">{result.out.steps.map((s, i) => <li key={i}>{s.replace(/^\d+[.)]\s*/, '')}</li>)}</ol>
          <button className="primary" onClick={save} disabled={busy}>Rezept speichern</button>
        </div>
      )}
    </div>
  )
}
