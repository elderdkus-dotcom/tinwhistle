import { useEffect, useRef, useState } from 'react'
import { Player } from '../player'
import { clock } from './ProgressCard'

/** A steady beat the recording was made to: a bar starts at `firstDownbeat` seconds. */
export interface HumGrid {
  bpm: number
  firstDownbeat: number
}

interface Props {
  beatsPerMeasure: number
  busy: boolean
  onDone: (file: File, grid: HumGrid | null) => void
}

const MAX_SECONDS = 5 * 60

function extension(type: string): string {
  if (type.includes('ogg')) return '.ogg'
  if (type.includes('mp4') || type.includes('aac')) return '.m4a'
  return '.webm'
}

/** Record a tune sung or hummed into the microphone, optionally to a metronome. */
export function HumRecorder({ beatsPerMeasure, busy, onDone }: Props) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'done'>('idle')
  const [metronome, setMetronome] = useState(true)
  const [bpm, setBpm] = useState(90)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<{ blob: Blob; url: string; grid: HumGrid | null } | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const clicker = useRef(new Player())
  const firstClick = useRef<number | null>(null)
  const timer = useRef(0)

  useEffect(
    () => () => {
      clearInterval(timer.current)
      clicker.current.stop()
      recorder.current?.stream.getTracks().forEach((t) => t.stop())
    },
    [],
  )
  useEffect(() => {
    if (take) return () => URL.revokeObjectURL(take.url)
  }, [take])

  const start = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(
        'This browser cannot record here. Recording needs a recent browser and the app opened at http://localhost:8000 (or over https).',
      )
      return
    }
    setState('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } })
    } catch {
      setState('idle')
      setError('The microphone could not be used. Allow microphone access for this page and try again.')
      return
    }
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstart = () => {
      const startedAt = performance.now()
      firstClick.current = null
      if (metronome) {
        // Clicks start shortly after recording does; note where the first one lands in the recording.
        const lead = 0.3
        const spb = 60 / bpm
        const count = Math.floor((MAX_SECONDS - lead) / spb)
        clicker.current.clicks(Array.from({ length: count }, (_, i) => ({ at: lead + i * spb, accent: i % beatsPerMeasure === 0 })))
        firstClick.current = (performance.now() - startedAt) / 1000 + 0.02 + lead + clicker.current.latency()
      }
      setElapsed(0)
      timer.current = window.setInterval(() => {
        const s = (performance.now() - startedAt) / 1000
        setElapsed(s)
        if (s >= MAX_SECONDS) stop()
      }, 100)
      setState('recording')
    }
    rec.onstop = () => {
      clearInterval(timer.current)
      clicker.current.stop()
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      const grid = firstClick.current !== null ? { bpm, firstDownbeat: firstClick.current } : null
      setTake({ blob, url: URL.createObjectURL(blob), grid })
      setState('done')
    }
    recorder.current = rec
    rec.start()
  }

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  // While counting in and recording, show where in the bar the metronome is.
  let beatInfo = ''
  if (state === 'recording' && metronome && firstClick.current !== null) {
    const beats = Math.floor((elapsed - firstClick.current) / (60 / bpm))
    if (beats < 0) beatInfo = 'Get ready…'
    else if (beats < beatsPerMeasure) beatInfo = `Count-in: ${beats + 1}`
    else beatInfo = `Bar ${Math.floor(beats / beatsPerMeasure)} · beat ${(beats % beatsPerMeasure) + 1}`
  }

  return (
    <div className="hum">
      <p className="muted">
        Sing, hum or whistle the tune into your microphone. Headphones help, so the metronome does not end up in the
        recording too loudly.
      </p>
      <div className="group">
        <label className="check">
          <input type="checkbox" checked={metronome} disabled={state === 'recording'} onChange={(e) => setMetronome(e.target.checked)} />
          <span>Metronome</span>
        </label>
        {metronome && (
          <label className="field-inline">
            <span>♩ =</span>
            <input
              type="number"
              min={40}
              max={200}
              value={bpm}
              disabled={state === 'recording'}
              onChange={(e) => setBpm(Number(e.target.value))}
              aria-label="Metronome beats per minute"
            />
          </label>
        )}
      </div>
      {metronome && state !== 'recording' && (
        <p className="muted small">You get one bar of clicks to count you in; start on the next bar.</p>
      )}

      <div className="record-row">
        {state === 'recording' ? (
          <button className="record on" type="button" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button
            className="record"
            type="button"
            onClick={() => void start()}
            disabled={state === 'starting' || busy || (metronome && !(bpm >= 40 && bpm <= 200))}
          >
            ● {take ? 'Record again' : 'Record'}
          </button>
        )}
        {state === 'recording' && (
          <span className="rec-status">
            <span className="rec-dot" aria-hidden="true" /> {clock(elapsed)} {beatInfo && `· ${beatInfo}`}
          </span>
        )}
      </div>

      {take && state === 'done' && (
        <div className="take">
          <audio controls src={take.url} />
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => onDone(new File([take.blob], `Hummed tune${extension(take.blob.type)}`, { type: take.blob.type }), take.grid)}
          >
            Write the score for this
          </button>
        </div>
      )}
      {error && <p className="warning">{error}</p>}
    </div>
  )
}
