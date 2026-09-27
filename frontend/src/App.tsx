import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelJob,
  health,
  loadSong,
  scorePart,
  songAudioUrl,
  songAvailable,
  waitForJob,
  type JobStatus,
  type PartResult,
  type SongRequest,
} from './api'
import type { Demo } from './demo'
import { EditorBar } from './components/EditorBar'
import { InputPanel } from './components/InputPanel'
import { ProgressCard } from './components/ProgressCard'
import { ScoreView } from './components/ScoreView'
import { SongBar } from './components/SongBar'
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
import { posToTime, timeToPos } from './sync'
import { LEVELS, type Level, type MelodySource, type ScoreNote, type Song } from './types'
import { draftPart, scoredUntil, useProject, type Project } from './useProject'
import { useSongPlayer } from './useSongPlayer'
import './styles.css'

const LEVEL_LABELS: Record<Level, { name: string; blurb: string }> = {
  beginner: { name: 'Beginner', blurb: 'Natural notes only, simple rhythms, slower' },
  intermediate: { name: 'Intermediate', blurb: 'Both octaves, C natural, full rhythm' },
  expert: { name: 'Expert', blurb: 'Half-holed notes, cuts and rolls' },
}

function formatShift(semitones: number): string {
  // Moving by whole octaves keeps the key (e.g. a whistle part, which is
  // written an octave below how it sounds).
  if (semitones % 12 === 0) return 'in the original key'
  const dir = semitones > 0 ? 'up' : 'down'
  const n = Math.abs(semitones) % 12
  return `moved ${dir} ${n} semitone${n === 1 ? '' : 's'}${Math.abs(semitones) > 12 ? ' and an octave' : ''}`
}

/** The note sounding at a score position, if any. */
function noteAt(notes: ScoreNote[], pos: number): ScoreNote | undefined {
  return notes.find((n) => pos >= n.start && pos < n.start + n.duration)
}

export default function App() {
  const {
    project,
    arrangement,
    canUndo,
    canRedo,
    openSong,
    openTune,
    restore,
    close,
    setLevel,
    setSource,
    addPart,
    keepPart,
    discardPart,
    edit,
    resetLevel,
    undo,
    redo,
  } = useProject()
  const song: Song | null = project?.song ?? null
  const [separation, setSeparation] = useState<boolean | null>(null)
  const [loadJob, setLoadJob] = useState<JobStatus | null>(null)
  const [partJob, setPartJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState('')
  const [songMissing, setSongMissing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [whistleId, setWhistleId] = useState<string | null>(null)
  const [whistlePlaying, setWhistlePlaying] = useState(false)
  const [tempoPercent, setTempoPercent] = useState(100)
  const [countIn, setCountIn] = useState(true)
  const [showNames, setShowNames] = useState(true)
  const [whistleAlong, setWhistleAlong] = useState(false)
  const player = useRef(new Player())
  const abort = useRef<AbortController | null>(null)
  const loadInput = useRef<HTMLInputElement>(null)
  const songPlayer = useSongPlayer(song && !songMissing ? songAudioUrl(song.id) : null)

  useEffect(() => {
    health()
      .then((h) => setSeparation(h.separation))
      .catch(() => setSeparation(null))
  }, [])

  // A restored project's song may be gone from the server (it keeps a few).
  useEffect(() => {
    setSongMissing(false)
    if (song) void songAvailable(song.id).then((ok) => setSongMissing(!ok))
  }, [song])

  const source: MelodySource = project?.source ?? 'voice'
  const loading = loadJob !== null && (loadJob.status === 'queued' || loadJob.status === 'running')
  const draft = project ? draftPart(project) : undefined
  const until = project ? scoredUntil(project) : 0

  const stopWhistle = useCallback(() => {
    player.current.stop()
    setWhistlePlaying(false)
    setWhistleId(null)
  }, [])

  const stopAll = useCallback(() => {
    stopWhistle()
    songPlayer.pause()
  }, [stopWhistle, songPlayer])

  // --- Loading a song -------------------------------------------------------

  const load = async (req: SongRequest) => {
    setError('')
    abort.current = new AbortController()
    try {
      const started = await loadSong(req)
      setLoadJob(started)
      const done = await waitForJob<{ song: Song }>(started.id, setLoadJob, abort.current.signal)
      if (done.status === 'cancelled') throw new Error('Cancelled')
      if (done.status === 'error' || !done.result) throw new Error(done.error || 'Loading the song failed.')
      stopAll()
      setSelectedId(null)
      openSong(done.result.song)
    } catch (e) {
      if ((e as Error).message !== 'Cancelled') setError((e as Error).message)
    } finally {
      setLoadJob(null)
    }
  }

  const openDemo = (demo: Demo) => {
    stopAll()
    setSelectedId(null)
    openTune(demo.title, demo.melody)
  }

  // --- Scoring parts ----------------------------------------------------------

  const score = async (start: number, end: number) => {
    if (!song) return
    songPlayer.pause()
    stopWhistle()
    setError('')
    abort.current = new AbortController()
    try {
      const started = await scorePart(song.id, start, end, source)
      setPartJob(started)
      const done = await waitForJob<PartResult>(started.id, setPartJob, abort.current.signal)
      if (done.status === 'cancelled') throw new Error('Cancelled')
      if (done.status === 'error' || !done.result) throw new Error(done.error || 'Scoring this part failed.')
      const r = done.result
      addPart({
        start: r.start,
        end: r.end,
        kind: 'scored',
        notes: r.notes,
        separated: r.separated,
        warnings: r.warnings,
        source: r.source,
      })
    } catch (e) {
      const message = (e as Error).message
      if (message !== 'Cancelled') setError(message)
      if (/no longer on the server/.test(message)) setSongMissing(true)
    } finally {
      setPartJob(null)
    }
  }

  const skip = (start: number, end: number) => {
    addPart({ start, end, kind: 'skipped', notes: [], separated: false, warnings: [] }, 'kept')
  }

  const discard = (id: string) => {
    const part = project?.parts.find((p) => p.id === id)
    stopAll()
    setSelectedId(null)
    discardPart(id)
    if (part) songPlayer.seek(part.start)
  }

  // --- Playback ----------------------------------------------------------------

  const tempo = arrangement ? Math.max(20, Math.round((arrangement.tempo * tempoPercent) / 100)) : 0

  /** Play the whistle score (steady tempo), optionally just a stretch of it. */
  const playWhistle = useCallback(
    (fromBeat?: number, untilBeat?: number) => {
      if (!arrangement || arrangement.notes.length === 0) return
      songPlayer.pause()
      const first = arrangement.notes.reduce((m, n) => Math.min(m, n.start), Infinity)
      const barStart = Math.floor(first / arrangement.beatsPerMeasure) * arrangement.beatsPerMeasure
      setWhistlePlaying(true)
      player.current.play(arrangement.notes, {
        tempo,
        fromBeat: fromBeat ?? barStart,
        untilBeat,
        countIn,
        beatsPerMeasure: arrangement.beatsPerMeasure,
        onNote: setWhistleId,
        onEnd: () => {
          setWhistlePlaying(false)
          setWhistleId(null)
        },
      })
    },
    [arrangement, tempo, countIn, songPlayer],
  )

  /** Play the original song; with "whistle along" the score plays in time with it. */
  const playSong = useCallback(
    (from?: number, stopAt?: number) => {
      if (!song) return
      stopWhistle()
      const start = from ?? songPlayer.time
      songPlayer.play(start, stopAt)
      if (whistleAlong && arrangement) {
        player.current.play(arrangement.notes, {
          tempo: song.tempo,
          fromBeat: timeToPos(song, start),
          untilBeat: stopAt !== undefined ? timeToPos(song, stopAt) : undefined,
          timing: (beat) => posToTime(song, beat),
          beatsPerMeasure: song.beatsPerMeasure,
        })
      }
    },
    [song, songPlayer, whistleAlong, arrangement, stopWhistle],
  )

  // Stop the whistle when the song is paused (it was playing along).
  useEffect(() => {
    if (!songPlayer.playing && !whistlePlaying) player.current.stop()
  }, [songPlayer.playing, whistlePlaying])

  // The highlighted note follows whichever is playing: the song or the whistle.
  const songNoteId = useMemo(() => {
    if (!song || !arrangement || !songPlayer.playing) return null
    return noteAt(arrangement.notes, timeToPos(song, songPlayer.time))?.id ?? null
  }, [song, arrangement, songPlayer.playing, songPlayer.time])
  const playingId = songPlayer.playing ? songNoteId : whistleId

  // --- Editing ------------------------------------------------------------------

  const selected = arrangement?.notes.find((n) => n.id === selectedId) ?? null

  const editNotes = useCallback(
    (change: (notes: ScoreNote[]) => ScoreNote[]) => edit((a) => ({ ...a, notes: change(a.notes) })),
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
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
        if (e.key !== 'Escape') return
      }
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
      if (e.key === ' ') {
        e.preventDefault()
        if (songPlayer.playing || whistlePlaying) stopAll()
        else if (song) playSong()
        else playWhistle(selected?.start)
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
  }, [actions, song, songPlayer.playing, whistlePlaying, playSong, playWhistle, selected, stopAll, undo, redo])

  // --- Files ----------------------------------------------------------------------

  const saveFile = () => {
    if (!project) return
    const blob = new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${project.title || 'whistle-score'}.whistle.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const loadFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Project
      if (!Array.isArray(data.parts) || typeof data.beatsPerMeasure !== 'number') throw new Error()
      stopAll()
      setSelectedId(null)
      restore(data)
    } catch {
      setError('That file is not a saved whistle score (or was saved by an older version).')
    }
  }

  // --- Layout ---------------------------------------------------------------------

  const cancelRunning = (job: JobStatus | null) => {
    if (job) void cancelJob(job.id)
    abort.current?.abort()
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
                stopAll()
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

      {!project && !loading && (
        <main className="start">
          <p className="intro">
            Load a song (a YouTube link or an MP3), then build sheet music for the <strong>D tin whistle</strong> part by
            part: play the song, pause where a part ends, and the app writes that part down, with the fingering under
            every note.
          </p>
          <InputPanel busy={loading} onSubmit={load} onDemo={openDemo} />
        </main>
      )}

      {loading && loadJob && (
        <main className="start">
          <ProgressCard job={loadJob} onCancel={() => cancelRunning(loadJob)} />
        </main>
      )}

      {project && !loading && (
        <main className="score-screen">
          <section className="score-head">
            <div>
              <h2>{project.title || 'Untitled song'}</h2>
              <p className="muted">
                D whistle{arrangement ? ` · ${formatShift(arrangement.transpose)} · ♩ = ${tempo}` : ''}
              </p>
            </div>
          </section>

          {song && songMissing && (
            <p className="warning">
              This song’s audio is no longer on the server (it keeps the last few songs, and forgets them when it
              restarts). You can still edit and print the score; to score more of it, load the song again.
            </p>
          )}
          {song && songPlayer.error && !songMissing && <p className="warning">{songPlayer.error}</p>}

          {song && !songMissing && (
            <SongBar
              song={song}
              player={songPlayer}
              parts={project.parts}
              scoredUntil={until}
              draft={draft}
              partJob={partJob}
              source={source}
              separationAvailable={separation}
              whistleAlong={whistleAlong}
              onSource={setSource}
              onWhistleAlong={setWhistleAlong}
              onScore={(s, e) => void score(s, e)}
              onSkip={skip}
              onCancelJob={() => cancelRunning(partJob)}
              onKeep={() => draft && keepPart(draft.id)}
              onDiscard={() => draft && discard(draft.id)}
              onUndoLast={() => {
                const last = project.parts[project.parts.length - 1]
                if (last) discard(last.id)
              }}
              onPlayDraftWhistle={() => {
                if (!draft || !song) return
                playWhistle(timeToPos(song, draft.start), timeToPos(song, draft.end))
              }}
              onPlaySong={playSong}
            />
          )}

          {arrangement && arrangement.notes.length > 0 ? (
            <>
              <section className="score-controls">
                <div className="segmented levels" role="tablist" aria-label="Difficulty">
                  {LEVELS.map((l) => (
                    <button
                      key={l}
                      role="tab"
                      aria-selected={project.level === l}
                      title={LEVEL_LABELS[l].blurb}
                      onClick={() => {
                        stopWhistle()
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
                  {whistlePlaying ? (
                    <button onClick={stopWhistle}>■ Stop whistle</button>
                  ) : (
                    <button onClick={() => playWhistle()}>▶ Play whistle</button>
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
                  <button onClick={resetLevel} title="Start this level over from the automatic arrangement">
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

              <p className="hint muted">
                Tap a note to fix it. Filled dots are covered holes; “+” means blow harder for the upper octave.
                {song && ' While the song plays, the note being sung is highlighted.'}
              </p>

              <ScoreView
                arrangement={arrangement}
                showNames={showNames}
                selectedId={selectedId}
                playingId={playingId}
                draftPartId={draft?.id}
                onSelect={setSelectedId}
              />
            </>
          ) : (
            song &&
            !songMissing && (
              <div className="card empty-score">
                <h3>No notes yet</h3>
                <p>
                  Press ▶ to play the song. Pause where you want the first part to end (a line or two of the song works
                  well), then press <strong>Score</strong>. If the song starts with an instrumental intro, pause where
                  the singing begins and press <strong>Skip</strong> first.
                </p>
              </div>
            )
          )}

          {selected && actions && (
            <EditorBar
              note={selected}
              onPitch={actions.pitch}
              onDuration={actions.duration}
              onInsert={actions.insert}
              onDelete={actions.remove}
              onOrnament={(o) => editNotes((n) => toggleOrnament(n, selected.id, o))}
              onPlayFrom={() => playWhistle(selected.start)}
              onPlaySongFrom={
                song && !songMissing ? () => playSong(selected.time ?? posToTime(song, selected.start)) : undefined
              }
              onNavigate={actions.navigate}
              onClose={() => setSelectedId(null)}
            />
          )}
        </main>
      )}
    </div>
  )
}
