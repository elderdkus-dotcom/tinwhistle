import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { arrange } from './arrange'
import { audioUrl, health, submitJob, waitForJob, type JobRequest, type JobStatus } from './api'
import { EditorBar } from './components/EditorBar'
import { InputPanel } from './components/InputPanel'
import { ScoreView } from './components/ScoreView'
import {
  changeDuration,
  deleteNote,
  insertAfter,
  movePitch,
  neighbour,
  toggleOrnament,
  transposeAll,
} from './editor'
import { Player } from './player'
import { LEVELS, type Level, type Melody } from './types'
import { useProject, type Project } from './useProject'
import './styles.css'

const LEVEL_LABELS: Record<Level, { name: string; blurb: string }> = {
  beginner: { name: 'Beginner', blurb: 'Natural notes only, simple rhythms, slower' },
  intermediate: { name: 'Intermediate', blurb: 'Both octaves, C natural, full rhythm' },
  expert: { name: 'Expert', blurb: 'Half-holed notes, cuts and rolls' },
}

function formatShift(semitones: number): string {
  if (semitones === 0) return 'kept in the original key'
  const dir = semitones > 0 ? 'up' : 'down'
  return `moved ${dir} ${Math.abs(semitones)} semitone${Math.abs(semitones) === 1 ? '' : 's'}`
}

export default function App() {
  const { project, arrangement, canUndo, canRedo, open, restore, close, setLevel, edit, undo, redo } = useProject()
  const [separation, setSeparation] = useState<boolean | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [tempoPercent, setTempoPercent] = useState(100)
  const [countIn, setCountIn] = useState(true)
  const [showNames, setShowNames] = useState(true)
  const player = useRef(new Player())
  const abort = useRef<AbortController | null>(null)
  const loadInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    health()
      .then((h) => setSeparation(h.separation))
      .catch(() => setSeparation(null))
  }, [])

  const busy = job !== null && (job.status === 'queued' || job.status === 'running')

  const stopPlayback = useCallback(() => {
    player.current.stop()
    setPlaying(false)
    setPlayingId(null)
  }, [])

  const openMelody = useCallback(
    (melody: Melody, jobId: string | null) => {
      stopPlayback()
      setSelectedId(null)
      open(melody, jobId)
    },
    [open, stopPlayback],
  )

  const analyze = async (req: JobRequest) => {
    setError('')
    abort.current = new AbortController()
    try {
      const started = await submitJob(req)
      setJob(started)
      const done = await waitForJob(started.id, setJob, abort.current.signal)
      if (done.status === 'error' || !done.result) throw new Error(done.error || 'Analysis failed.')
      openMelody(done.result, done.id)
      setJob(null)
    } catch (e) {
      setJob(null)
      if ((e as Error).message !== 'Cancelled') setError((e as Error).message)
    }
  }

  const selected = arrangement?.notes.find((n) => n.id === selectedId) ?? null
  const tempo = arrangement ? Math.max(20, Math.round((arrangement.tempo * tempoPercent) / 100)) : 0

  const play = useCallback(
    (fromBeat = 0) => {
      if (!arrangement) return
      setPlaying(true)
      player.current.play(arrangement.notes, {
        tempo,
        fromBeat,
        countIn,
        beatsPerMeasure: arrangement.beatsPerMeasure,
        onNote: setPlayingId,
        onEnd: () => {
          setPlaying(false)
          setPlayingId(null)
        },
      })
    },
    [arrangement, tempo, countIn],
  )

  // Editing actions on the selected note.
  const editNotes = useCallback(
    (change: (notes: NonNullable<typeof arrangement>['notes']) => NonNullable<typeof arrangement>['notes']) =>
      edit((a) => ({ ...a, notes: change(a.notes) })),
    [edit],
  )

  const actions = useMemo(() => {
    if (!selectedId || !arrangement) return null
    return {
      pitch: (amount: number, chromatic: boolean) => editNotes((n) => movePitch(n, selectedId, amount, chromatic)),
      duration: (steps: number) => editNotes((n) => changeDuration(n, selectedId, steps)),
      insert: () => {
        const result = insertAfter(arrangement.notes, selectedId)
        edit((a) => ({ ...a, notes: result.notes }))
        setSelectedId(result.id)
      },
      remove: () => {
        const next = neighbour(arrangement.notes, selectedId, 1) ?? neighbour(arrangement.notes, selectedId, -1)
        editNotes((n) => deleteNote(n, selectedId))
        setSelectedId(next ?? null)
      },
      navigate: (dir: 1 | -1) => setSelectedId(neighbour(arrangement.notes, selectedId, dir) ?? selectedId),
    }
  }, [selectedId, arrangement, edit, editNotes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === ' ' && arrangement) {
        e.preventDefault()
        if (playing) stopPlayback()
        else play(selected?.start ?? 0)
        return
      }
      if (!actions) return
      const keys: Record<string, () => void> = {
        ArrowUp: () => actions.pitch(1, e.shiftKey),
        ArrowDown: () => actions.pitch(-1, e.shiftKey),
        ArrowRight: () => actions.navigate(1),
        ArrowLeft: () => actions.navigate(-1),
        '+': () => actions.duration(1),
        '=': () => actions.duration(1),
        '-': () => actions.duration(-1),
        Delete: actions.remove,
        Backspace: actions.remove,
        i: actions.insert,
        Escape: () => setSelectedId(null),
      }
      const handler = keys[e.key]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, arrangement, playing, play, selected, stopPlayback, undo, redo])

  const saveFile = () => {
    if (!project) return
    const blob = new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${project.melody.title || 'whistle-score'}.whistle.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const loadFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Project
      if (!data.melody || !Array.isArray(data.melody.notes)) throw new Error()
      stopPlayback()
      setSelectedId(null)
      restore(data)
    } catch {
      setError('That file is not a saved whistle score.')
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="logo" aria-hidden="true">
            ●●●○○○
          </span>
          Tin Whistle Scores
        </h1>
        <div className="topbar-actions">
          <button className="link" onClick={() => loadInput.current?.click()}>
            Open saved
          </button>
          <input
            ref={loadInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void loadFile(f)
              e.target.value = ''
            }}
          />
          {project && (
            <button
              className="link"
              onClick={() => {
                stopPlayback()
                setSelectedId(null)
                close()
              }}
            >
              New song
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="alert" role="alert">
          {error}
          <button className="icon" onClick={() => setError('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {!project && !busy && (
        <main className="start">
          <p className="intro">
            Give it a song (a YouTube link or an MP3) and get sheet music for the <strong>D tin whistle</strong>,
            with the fingering under every note. The melody is moved into a key that fits the whistle automatically.
          </p>
          <InputPanel separationAvailable={separation} busy={busy} onSubmit={analyze} onDemo={(m) => openMelody(m, null)} />
        </main>
      )}

      {busy && job && (
        <main className="start">
          <div className="card progress-card" aria-live="polite">
            <h2>Listening to your song…</h2>
            <p>{job.stage}</p>
            <div className="progress">
              <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
            <p className="muted">This takes about as long as the song itself.</p>
            <button onClick={() => abort.current?.abort()}>Cancel</button>
          </div>
        </main>
      )}

      {project && arrangement && !busy && (
        <main className="score-screen">
          <section className="score-head">
            <div>
              <h2>{project.melody.title || 'Untitled song'}</h2>
              <p className="muted">
                D whistle · {project.melody.key ? `song is in ${project.melody.key}, ` : ''}
                {formatShift(arrangement.transpose)} · ♩ = {tempo}
              </p>
              {project.melody.warnings.map((w) => (
                <p key={w} className="warning">
                  {w}
                </p>
              ))}
            </div>
            <div className="segmented levels" role="tablist" aria-label="Difficulty">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  role="tab"
                  aria-selected={project.level === l}
                  title={LEVEL_LABELS[l].blurb}
                  onClick={() => {
                    stopPlayback()
                    setSelectedId(null)
                    setLevel(l)
                  }}
                >
                  {LEVEL_LABELS[l].name}
                </button>
              ))}
            </div>
            <p className="muted level-blurb">{LEVEL_LABELS[project.level].blurb}</p>
          </section>

          <section className="toolbar" aria-label="Score controls">
            <div className="group">
              {playing ? (
                <button className="primary" onClick={stopPlayback}>
                  ■ Stop
                </button>
              ) : (
                <button className="primary" onClick={() => play(0)}>
                  ▶ Play
                </button>
              )}
              <label className="tempo">
                <span>Speed {tempoPercent}%</span>
                <input
                  type="range"
                  min={40}
                  max={130}
                  step={5}
                  value={tempoPercent}
                  onChange={(e) => setTempoPercent(Number(e.target.value))}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} />
                <span>Count-in</span>
              </label>
            </div>
            <div className="group">
              <span className="label">Key</span>
              <button onClick={() => edit((a) => ({ ...a, transpose: a.transpose - 1, notes: transposeAll(a.notes, -1) }))} title="Down a semitone">
                −
              </button>
              <button onClick={() => edit((a) => ({ ...a, transpose: a.transpose + 1, notes: transposeAll(a.notes, 1) }))} title="Up a semitone">
                +
              </button>
              <button
                onClick={() => edit(() => arrange(project.melody, project.level))}
                title="Start this level over from the automatic arrangement"
              >
                Reset
              </button>
            </div>
            <div className="group">
              <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
                ↶ Undo
              </button>
              <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
                ↷ Redo
              </button>
            </div>
            <div className="group">
              <label className="check">
                <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
                <span>Note names</span>
              </label>
              <button onClick={() => window.print()}>Print / PDF</button>
              <button onClick={saveFile}>Save</button>
            </div>
          </section>

          {project.jobId && (
            <section className="original">
              <span className="label">Original song</span>
              <audio controls preload="none" src={audioUrl(project.jobId)} />
            </section>
          )}

          <p className="hint muted">Tap a note to fix it. Filled dots are covered holes; “+” means blow harder for the upper octave.</p>

          <ScoreView
            arrangement={arrangement}
            showNames={showNames}
            selectedId={selectedId}
            playingId={playingId}
            onSelect={setSelectedId}
          />

          {selected && actions && (
            <EditorBar
              note={selected}
              onPitch={actions.pitch}
              onDuration={actions.duration}
              onInsert={actions.insert}
              onDelete={actions.remove}
              onOrnament={(o) => editNotes((n) => toggleOrnament(n, selected.id, o))}
              onPlayFrom={() => play(selected.start)}
              onNavigate={actions.navigate}
              onClose={() => setSelectedId(null)}
            />
          )}
        </main>
      )}
    </div>
  )
}
