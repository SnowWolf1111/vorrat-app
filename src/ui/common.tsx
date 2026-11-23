import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// ---------- Icons (inline, 24px, currentColor) ----------
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
export const Icon = {
  box: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
  ),
  scan: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></svg>
  ),
  cart: () => (
    <svg viewBox="0 0 24 24" {...P}><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L22 7H6" /></svg>
  ),
  search: () => (
    <svg viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
  ),
  plus: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>
  ),
  minus: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M5 12h14" /></svg>
  ),
  check: () => (
    <svg viewBox="0 0 24 24" {...P} strokeWidth={3}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  ),
  close: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  bolt: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
  ),
  cloudOff: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M3 3l18 18" /><path d="M8 8a5 5 0 0 0-1.5 9.8H17M20.5 15.5A4 4 0 0 0 17 10h-1.3A7 7 0 0 0 10 5.2" /></svg>
  ),
  refresh: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" /></svg>
  ),
  snow: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M12 2v20M4.9 6l14.2 12M19.1 6L4.9 18" /></svg>
  ),
  external: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>
  ),
  chevron: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M9 6l6 6-6 6" /></svg>
  ),
  logout: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" /></svg>
  ),
}

// ---------- Bottom Sheet ----------
export function Sheet({ open, onClose, title, children, tall }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; tall?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {title !== undefined && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Schließen"><Icon.close /></button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

// ---------- Stepper ----------
export function Stepper({ value, onChange, min = 0, step = 1, big }: { value: number; onChange: (v: number) => void; min?: number; step?: number; big?: boolean }) {
  return (
    <div className={`stepper ${big ? 'big' : ''}`}>
      <button type="button" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))} disabled={value <= min} aria-label="weniger"><Icon.minus /></button>
      <input
        inputMode="decimal"
        value={String(value).replace('.', ',')}
        onChange={(e) => {
          const n = Number(e.target.value.replace(',', '.'))
          if (!Number.isNaN(n)) onChange(n)
        }}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" onClick={() => onChange(+(value + step).toFixed(2))} aria-label="mehr"><Icon.plus /></button>
    </div>
  )
}

// ---------- Toasts ----------
type Toast = { id: number; text: ReactNode; tone?: 'ok' | 'warn' }
const ToastCtx = createContext<(text: ReactNode, tone?: Toast['tone']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const id = useRef(0)
  const push = useCallback((text: ReactNode, tone?: Toast['tone']) => {
    const t = { id: ++id.current, text, tone }
    setToasts((ts) => [...ts.slice(-2), t])
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 2600)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  )
}
