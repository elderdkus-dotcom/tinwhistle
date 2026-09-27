import { useState } from 'react'
import type { JobRequest } from '../api'
import { DEMOS } from '../demo'
import type { Melody } from '../types'

interface Props {
  separationAvailable: boolean | null
  busy: boolean
  onSubmit: (req: JobRequest) => void
  onDemo: (melody: Melody) => void
}

function parseTime(text: string): number {
  const parts = text.trim().split(':').map(Number)
  if (parts.some((p) => Number.isNaN(p))) return 0
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

export function InputPanel({ separationAvailable, busy, onSubmit, onDemo }: Props) {
  const [mode, setMode] = useState<'link' | 'file'>('link')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [start, setStart] = useState('')
  const [length, setLength] = useState('')
  const [beats, setBeats] = useState(4)
  const [separate, setSeparate] = useState(true)
  const [dragging, setDragging] = useState(false)

  const ready = mode === 'link' ? /^https?:\/\/\S+/.test(url.trim()) : file !== null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    onSubmit({
      url: mode === 'link' ? url.trim() : undefined,
      file: mode === 'file' ? file ?? undefined : undefined,
      start: parseTime(start),
      duration: parseTime(length),
      separate: separate && separationAvailable !== false,
      beatsPerMeasure: beats,
    })
  }

  return (
    <form className="card input-panel" onSubmit={submit}>
      <h2>Choose a song</h2>
      <div className="segmented" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'link'} onClick={() => setMode('link')}>
          YouTube link
        </button>
        <button type="button" role="tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}>
          Audio file
        </button>
      </div>

      {mode === 'link' ? (
        <label className="field">
          <span>Paste a link to the song</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      ) : (
        <label
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) setFile(f)
          }}
        >
          <input type="file" accept="audio/*,video/*,.mp3,.m4a,.wav,.ogg,.flac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <strong>{file ? file.name : 'Tap to pick an MP3 (or drop it here)'}</strong>
          <span>MP3, M4A, WAV, OGG, FLAC or a video file, up to 60 MB</span>
        </label>
      )}

      <details className="options">
        <summary>Options</summary>
        <div className="option-grid">
          <label className="field">
            <span>Start at (m:ss)</span>
            <input placeholder="0:00" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Length (m:ss)</span>
            <input placeholder="whole song" value={length} onChange={(e) => setLength(e.target.value)} />
          </label>
          <label className="field">
            <span>Time signature</span>
            <select value={beats} onChange={(e) => setBeats(Number(e.target.value))}>
              <option value={4}>4/4</option>
              <option value={3}>3/4 (waltz)</option>
              <option value={2}>2/4 (polka, march)</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={separate && separationAvailable !== false}
              disabled={separationAvailable === false}
              onChange={(e) => setSeparate(e.target.checked)}
            />
            <span>
              Isolate the singer first (slower, more accurate)
              {separationAvailable === false && ' — not installed on this server'}
            </span>
          </label>
        </div>
      </details>

      <button className="primary" type="submit" disabled={!ready || busy}>
        Create whistle score
      </button>

      <div className="demos">
        <span>No song handy? Try a demo:</span>
        {DEMOS.map((d) => (
          <button type="button" className="link" key={d.title} onClick={() => onDemo(d)}>
            {d.title.replace(' (demo)', '')}
          </button>
        ))}
      </div>
    </form>
  )
}
