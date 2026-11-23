import { useEffect, useRef, useState } from 'react'
import { Icon } from './common'

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']

async function makeDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: { new (o: unknown): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats()
      if (supported.includes('ean_13')) return new Native({ formats: FORMATS.filter((f) => supported.includes(f)) })
    } catch {
      /* Fallback */
    }
  }
  // z. B. Chrome am PC: WASM-Variante nachladen
  const { BarcodeDetector } = await import('barcode-detector/ponyfill')
  return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector
}

/** Kamerabild mit Barcode-Erkennung. paused = Kamera läuft weiter, aber keine Treffer. */
export function Scanner({ onCode, paused }: { onCode: (code: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [torch, setTorch] = useState<{ on: boolean; track: MediaStreamTrack } | null>(null)
  const pausedRef = useRef(paused)
  const onCodeRef = useRef(onCode)
  pausedRef.current = paused
  onCodeRef.current = onCode

  useEffect(() => {
    let stream: MediaStream | null = null
    let stop = false
    let last = { code: '', at: 0 }

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (stop) return stream.getTracks().forEach((t) => t.stop())
        const v = video.current!
        v.srcObject = stream
        await v.play()
        const track = stream.getVideoTracks()[0]
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean }
        if (caps.torch) setTorch({ on: false, track })

        const detector = await makeDetector()
        const tick = async () => {
          if (stop) return
          if (!pausedRef.current && v.readyState >= 2) {
            try {
              const codes = await detector.detect(v)
              const code = codes[0]?.rawValue
              const now = Date.now()
              if (code && (code !== last.code || now - last.at > 2500)) {
                last = { code, at: now }
                onCodeRef.current(code)
              }
            } catch {
              /* einzelnes Bild fehlgeschlagen */
            }
          }
          setTimeout(tick, 150)
        }
        tick()
      } catch (e) {
        const name = (e as Error).name
        setError(
          name === 'NotAllowedError'
            ? 'Kamera-Zugriff wurde verweigert. In Chrome: Schloss-Symbol neben der Adresse → Berechtigungen → Kamera erlauben.'
            : name === 'NotFoundError'
              ? 'Keine Kamera gefunden.'
              : `Kamera startet nicht (${(e as Error).message}).`,
        )
      }
    })()

    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function toggleTorch() {
    if (!torch) return
    const on = !torch.on
    try {
      await torch.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setTorch({ ...torch, on })
    } catch {
      /* nicht unterstützt */
    }
  }

  return (
    <div className="scanner">
      {error ? (
        <div className="scanner-error">{error}</div>
      ) : (
        <>
          <video ref={video} playsInline muted />
          <div className={`scan-frame ${paused ? 'paused' : ''}`}><span /></div>
          {torch && (
            <button className={`torch ${torch.on ? 'on' : ''}`} onClick={toggleTorch} aria-label="Taschenlampe">
              <Icon.bolt />
            </button>
          )}
        </>
      )}
    </div>
  )
}
