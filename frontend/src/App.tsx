import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cancelJob, loadSong, songAudioUrl, songAvailable, waitForJob, type JobStatus, type SongRequest } from './api'
import { arrange } from './arrange'
import type { Demo } from './demo'
import { GridPanel } from './components/GridPanel'
import type { HumGrid } from './components/HumRecorder'
import { InputPanel } from './components/InputPanel'
import { LENGTHS, NotePad } from './components/NotePad'
import { ProgressCard } from './components/ProgressCard'
import { ScoreView } from './components/ScoreView'
import { Transport } from './components/Transport'
import {
  deleteNote,
  gapAt,
  movePitch,
  pitchBefore,
  pitchFromLetter,
  placeNote,
  scoreEnd,
  setLength,
  step,
  toggleOrnament,
  transposeAll,
  type Cursor,
} from './editor'
import { steadyGrid } from './grid'
import { Player } from './player'
import { parseRestId } from './render'
import { posToTime, timeToPos } from './sync'
import type { ScoreNote, Song } from './types'
import { newProject, parseProject, savedProject, useProject, type Project } from './useProject'
import { useSongPlayer } from './useSongPlayer'
import { stepScale } from './whistle'
import './styles.css'

const EPS = 1e-9

/** The note sounding at a score position, if any. */
function noteAt(notes: ScoreNote[], pos: number): ScoreNote | undefined {
  return notes.find((n) => pos >= n.start - EPS && pos < n.start + n.duration - EPS)
}

const snap = (pos: number, grid: number) => Math.round(pos / grid) * grid

export default function App() {
  const { project, canUndo, canRedo, open: openProject, close, edit, undo, redo } = useProject()
  const [saved, setSaved] = useState(savedProject)
  const open = useCallback(
    (p: Project) => {
      setSaved(null)
      openProject(p)
    },
    [openProject],
  )
  const [loadJob, setLoadJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const openInput = useRef<HTMLInputElement>(null)

  const loading = loadJob !== null && (loadJob.status === 'queued' || loadJob.status === 'running')

  const load = async (req: SongRequest, grid?: HumGrid | null) => {
    setError('')
    abort.current = new AbortController()
    try {
      const started = await loadSong(req)
      setLoadJob(started)
      const done = await waitForJob<{ song: Song }>(started.id, setLoadJob, abort.current.signal)
      if (done.status === 'cancelled') throw new Error('Cancelled')
      if (done.status === 'error' || !done.result) throw new Error(done.error || 'Opening the song failed.')
      let song = done.result.song
      // A recording made to the metronome has a known, steady beat.
      if (grid) song = { ...song, ...steadyGrid(song.duration, grid.firstDownbeat, grid.bpm, song.beatsPerMeasure) }
      open(newProject(song.title || 'Untitled', song, req.beatsPerMeasure))
    } catch (e) {
      if ((e as Error).message !== 'Cancelled') setError((e as Error).message)
    } finally {
      setLoadJob(null)
    }
  }

  const openDemo = (demo: Demo) => {
    const a = arrange(demo.melody, 'intermediate')
    open(newProject(demo.title.replace(' (demo)', ''), null, a.beatsPerMeasure, a.notes, a.tempo))
  }

  const openFile = async (file: File) => {
    try {
      open(parseProject(JSON.parse(await file.text())))
      setError('')
    } catch (e) {
      setError(e instanceof SyntaxError ? 'That file is not a saved whistle score.' : (e as Error).message)
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
          <button className="link" onClick={() => openInput.current?.click()}>
            Open saved
          </button>
          <input
            ref={openInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void openFile(f)
              e.target.value = ''
            }}
          />
          {project && (
            <button
              className="link"
              onClick={() => {
                if (project.notes.length === 0 || window.confirm('Close this score? Save it first if you want to keep it.')) close()
              }}
            >
              New score
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
            Write sheet music for the <strong>D tin whistle</strong> by ear. Open a song (a YouTube link or an MP3) or hum
            the tune you have in your head; it plays in the background while you pick each note with the arrow keys or by
            tapping its fingering. The score shows the fingering under every note.
          </p>
          {saved && (
            <button className="card continue" onClick={() => open(saved)}>
              <strong>Continue where you left off</strong>
              <span>
                {saved.title || 'Untitled'} · {saved.notes.length} notes
              </span>
            </button>
          )}
          <InputPanel
            busy={loading}
            onSubmit={(req, grid) => void load(req, grid)}
            onEmpty={(beats) => open(newProject('Untitled', null, beats))}
            onDemo={openDemo}
          />
        </main>
      )}

      {loading && loadJob && (
        <main className="start">
          <ProgressCard
            job={loadJob}
            onCancel={() => {
              void cancelJob(loadJob.id)
              abort.current?.abort()
            }}
          />
        </main>
      )}

      {project && !loading && (
        <Writer project={project} edit={edit} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />
      )}
    </div>
  )
}

interface WriterProps {
  project: Project
  edit: (change: (p: Project) => Project) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

/** The score sheet, the song playing behind it, and note entry. */
function Writer({ project, edit, undo, redo, canUndo, canRedo }: WriterProps) {
  const { song, notes, beatsPerMeasure } = project
  const [songMissing, setSongMissing] = useState(false)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [stepLength, setStepLength] = useState(1)
  const [tapGrid, setTapGrid] = useState(0.5)
  const [tapping, setTapping] = useState(false)
  const [showNames, setShowNames] = useState(true)
  const [whistleAlong, setWhistleAlong] = useState(false)
  const [clicks, setClicks] = useState(false)
  const [whistleId, setWhistleId] = useState<string | null>(null)
  const [whistlePlaying, setWhistlePlaying] = useState(false)
  const [title, setTitle] = useState(project.title)
  const whistle = useRef(new Player())
  const metronome = useRef(new Player())
  const preview = useRef(new Player())
  const tapStart = useRef<number | null>(null)

  const hasSong = !!song && !songMissing
  const songPlayer = useSongPlayer(hasSong ? songAudioUrl(song.id) : null)

  useEffect(() => setTitle(project.title), [project.title])

  // The server keeps only the last few songs (and forgets them when it restarts).
  useEffect(() => {
    setSongMissing(false)
    if (song) void songAvailable(song.id).then((ok) => setSongMissing(!ok))
  }, [song?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNote = cursor?.kind === 'note' ? notes.find((n) => n.id === cursor.id) ?? null : null
  const selectedRest = cursor?.kind === 'rest' ? cursor : null
  // A deleted or overwritten note leaves nothing selected.
  useEffect(() => {
    if (cursor?.kind === 'note' && !selectedNote) setCursor(null)
  }, [cursor, selectedNote])

  const pos = song ? timeToPos(song, songPlayer.time) : null

  // --- Playback -------------------------------------------------------------

  const stopWhistle = useCallback(() => {
    whistle.current.stop()
    setWhistlePlaying(false)
    setWhistleId(null)
  }, [])

  const playSong = useCallback(
    (from?: number, stopAt?: number) => {
      if (!song || !hasSong) return
      stopWhistle()
      const start = Math.max(0, from ?? songPlayer.time)
      const rate = songPlayer.rate
      songPlayer.play(start, stopAt)
      const until = stopAt !== undefined ? timeToPos(song, stopAt) : undefined
      if (whistleAlong) {
        whistle.current.play(notes, {
          tempo: song.tempo,
          fromBeat: timeToPos(song, start),
          untilBeat: until,
          timing: (beat) => posToTime(song, beat) / rate,
          beatsPerMeasure,
        })
      }
      if (clicks) {
        const end = stopAt ?? song.duration
        metronome.current.clicks(
          song.beats
            .map((t, i) => ({ t, i }))
            .filter(({ t }) => t >= start - 0.01 && t <= end)
            .map(({ t, i }) => ({
              at: (t - start) / rate,
              accent: (((Math.round(i - song.origin) % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure) === 0,
            })),
        )
      }
    },
    [song, hasSong, songPlayer, whistleAlong, clicks, notes, beatsPerMeasure, stopWhistle],
  )

  const pauseSong = useCallback(() => {
    songPlayer.pause()
    whistle.current.stop()
    metronome.current.stop()
  }, [songPlayer])

  // Whatever plays along with the song stops when the song does.
  useEffect(() => {
    if (!songPlayer.playing && !whistlePlaying) {
      whistle.current.stop()
      metronome.current.stop()
    }
  }, [songPlayer.playing, whistlePlaying])

  /** Play the written notes on their own (no song, or to check them). */
  const playWhistle = useCallback(
    (fromBeat = 0, untilBeat?: number) => {
      if (notes.length === 0) return
      pauseSong()
      setWhistlePlaying(true)
      whistle.current.play(notes, {
        tempo: song ? song.tempo * songPlayer.rate : project.tempo,
        fromBeat,
        untilBeat,
        timing: song ? (beat) => posToTime(song, beat) / songPlayer.rate : undefined,
        beatsPerMeasure,
        onNote: setWhistleId,
        onEnd: () => {
          setWhistlePlaying(false)
          setWhistleId(null)
        },
      })
    },
    [notes, song, project.tempo, songPlayer.rate, beatsPerMeasure, pauseSong],
  )

  const togglePlay = useCallback(() => {
    if (songPlayer.playing) pauseSong()
    else if (whistlePlaying) stopWhistle()
    else if (hasSong) playSong()
    else {
      const from = selectedNote?.start ?? selectedRest?.start ?? 0
      playWhistle(Math.floor(from / beatsPerMeasure) * beatsPerMeasure)
    }
  }, [songPlayer.playing, whistlePlaying, hasSong, selectedNote, selectedRest, beatsPerMeasure, pauseSong, stopWhistle, playSong, playWhistle])

  /** Hear the selected bit of the song (or of the score, without a song). */
  const listen = useCallback(() => {
    const span = selectedNote
      ? { start: selectedNote.start, end: selectedNote.start + selectedNote.duration }
      : selectedRest
    if (!span) return
    if (song && hasSong) playSong(posToTime(song, span.start), posToTime(song, span.end) + 0.08)
    else playWhistle(span.start, span.end)
  }, [selectedNote, selectedRest, song, hasSong, playSong, playWhistle])

  const sound = useCallback(
    (pitch: number) => {
      if (!songPlayer.playing) preview.current.preview(pitch)
    },
    [songPlayer.playing],
  )

  // With the song paused, choosing a note moves the song there, so ▶ plays from it.
  const cursorStart = selectedNote?.start ?? selectedRest?.start
  useEffect(() => {
    if (cursorStart === undefined || !song || !hasSong || songPlayer.playing) return
    songPlayer.seek(posToTime(song, cursorStart))
  }, [cursorStart]) // eslint-disable-line react-hooks/exhaustive-deps

  // The highlighted note follows the song, or the score when it plays on its own.
  const songNoteId = useMemo(
    () => (songPlayer.playing && pos !== null ? noteAt(notes, pos)?.id ?? null : null),
    [songPlayer.playing, pos, notes],
  )
  const playingId = songPlayer.playing ? songNoteId : whistleId

  // --- Writing notes -----------------------------------------------------------

  const setNotes = useCallback(
    (change: (n: ScoreNote[]) => ScoreNote[]) => edit((p) => ({ ...p, notes: change(p.notes) })),
    [edit],
  )

  /** Where a new score starts: where the song is (to the nearest beat), or the beginning. */
  const startPos = useCallback(() => {
    if (!song || !hasSong) return 0
    return Math.max(0, snap(timeToPos(song, songPlayer.now()), 1))
  }, [song, hasSong, songPlayer])

  /** Put a new note in (in a rest, or after the last note) and select it. */
  const place = useCallback(
    (start: number, beats: number, pitch: number) => {
      const result = placeNote(notes, start, beats, pitch)
      setNotes(() => result.notes)
      setCursor({ kind: 'note', id: result.id })
      sound(pitch)
    },
    [notes, setNotes, sound],
  )

  /** Enter a pitch: change the selected note, fill the selected rest, or add a note at the end. */
  const enterPitch = useCallback(
    (pitch: number) => {
      if (selectedNote) {
        setNotes((n) => n.map((m) => (m.id === selectedNote.id ? { ...m, pitch } : m)))
        sound(pitch)
      } else if (selectedRest) {
        place(selectedRest.start, Math.min(stepLength, selectedRest.end - selectedRest.start), pitch)
      } else {
        place(notes.length ? scoreEnd(notes) : startPos(), stepLength, pitch)
      }
    },
    [selectedNote, selectedRest, stepLength, notes, place, setNotes, sound, startPos],
  )

  const changePitch = useCallback(
    (amount: number, chromatic: boolean) => {
      if (selectedNote) {
        const moved = movePitch([selectedNote], selectedNote.id, amount, chromatic)[0].pitch
        enterPitch(moved)
      } else {
        const start = selectedRest?.start ?? (notes.length ? scoreEnd(notes) : startPos())
        const base = pitchBefore(notes, start)
        enterPitch(chromatic ? base + amount : stepScale(base, amount, true))
      }
    },
    [selectedNote, selectedRest, notes, enterPitch, startPos],
  )

  const navigate = useCallback(
    (dir: 1 | -1) => {
      if (!cursor) {
        if (notes.length === 0) {
          if (dir === 1) place(startPos(), stepLength, pitchBefore(notes, 0))
          return
        }
        // Start from the note where the song is, else the first note.
        const here = pos !== null ? notes.filter((n) => n.start <= pos + EPS).sort((a, b) => b.start - a.start)[0] : undefined
        const first = [...notes].sort((a, b) => a.start - b.start)[0]
        setCursor({ kind: 'note', id: (here ?? first).id })
        return
      }
      const next = step(notes, cursor, dir)
      if (next) {
        setCursor(next)
        if (next.kind === 'note') sound(notes.find((n) => n.id === next.id)!.pitch)
        return
      }
      if (dir === 1) {
        // Past the end: add a note, the same as the one before it.
        if (selectedNote) place(selectedNote.start + selectedNote.duration, stepLength, selectedNote.pitch)
        else if (selectedRest) place(selectedRest.start, Math.min(stepLength, selectedRest.end - selectedRest.start), pitchBefore(notes, selectedRest.start))
      }
    },
    [cursor, notes, pos, selectedNote, selectedRest, stepLength, place, sound, startPos],
  )

  const setNoteLength = useCallback(
    (beats: number) => {
      const plain = LENGTHS.find((l) => Math.abs(l.beats - beats) < EPS || Math.abs(l.beats * 1.5 - beats) < EPS)
      setStepLength(plain ? plain.beats : beats)
      if (selectedNote) setNotes((n) => setLength(n, selectedNote.id, beats))
    },
    [selectedNote, setNotes],
  )

  const toggleDotted = useCallback(() => {
    if (!selectedNote) return
    const d = selectedNote.duration
    const dotted = LENGTHS.some((l) => Math.abs(l.beats * 1.5 - d) < EPS)
    setNotes((n) => setLength(n, selectedNote.id, dotted ? d / 1.5 : d * 1.5))
  }, [selectedNote, setNotes])

  const makeRest = useCallback(() => {
    if (!selectedNote) return
    const { start, duration } = selectedNote
    const rest = deleteNote(notes, selectedNote.id)
    setNotes(() => rest)
    setCursor({ kind: 'rest', ...gapAt(rest, start, start + duration) })
  }, [selectedNote, notes, setNotes])

  // Tapping: hold a key or button for as long as each note lasts while the song plays.
  const tapDown = useCallback(() => {
    if (!song || !songPlayer.playing || tapStart.current !== null) return
    tapStart.current = timeToPos(song, songPlayer.now())
    setTapping(true)
  }, [song, songPlayer])

  const tapUp = useCallback(() => {
    if (!song || tapStart.current === null) return
    const start = Math.max(0, snap(tapStart.current, tapGrid))
    const end = Math.max(start + tapGrid, snap(timeToPos(song, songPlayer.now()), tapGrid))
    tapStart.current = null
    setTapping(false)
    const result = placeNote(notes, start, end - start, pitchBefore(notes, start))
    setNotes(() => result.notes)
    setCursor({ kind: 'note', id: result.id })
  }, [song, songPlayer, tapGrid, notes, setNotes])

  const selectFromScore = useCallback(
    (id: string | null) => {
      if (!id) return setCursor(null)
      const rest = parseRestId(id)
      if (!rest) {
        setCursor({ kind: 'note', id })
        const n = notes.find((m) => m.id === id)
        if (n) sound(n.pitch)
        return
      }
      setCursor({ kind: 'rest', ...gapAt(notes, rest.start, rest.start + rest.beats) })
    },
    [notes, sound],
  )

  // --- Keyboard ------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const type = (el as HTMLInputElement).type
      if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return
      if (el.tagName === 'INPUT' && type !== 'checkbox' && type !== 'range') return
      if (type === 'range' && e.key.startsWith('Arrow')) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key
      const lower = key.toLowerCase()
      if (mod) {
        if (lower === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
        } else if (lower === 'y') {
          e.preventDefault()
          redo()
        }
        return
      }
      if (e.altKey) return
      const run = (f: () => void) => {
        e.preventDefault()
        f()
      }
      if (key === ' ') return run(togglePlay)
      if (lower === 'n') return run(() => !e.repeat && tapDown())
      if (e.repeat && !key.startsWith('Arrow')) return
      if (key === 'ArrowRight') return run(() => navigate(1))
      if (key === 'ArrowLeft') return run(() => navigate(-1))
      if (key === 'ArrowUp') return run(() => changePitch(1, e.shiftKey))
      if (key === 'ArrowDown') return run(() => changePitch(-1, e.shiftKey))
      if (key === 'Enter') return run(listen)
      if (key === 'Escape') return run(() => setCursor(null))
      if (key === 'Delete' || key === 'Backspace') return run(makeRest)
      if (key === '.') return run(toggleDotted)
      const length = LENGTHS.find((l) => l.key === key)
      if (length) return run(() => setNoteLength(length.beats))
      if (key.length !== 1) return
      const letter = pitchFromLetter(lower, selectedNote?.pitch ?? pitchBefore(notes, selectedRest?.start ?? scoreEnd(notes)))
      if (letter !== null) return run(() => enterPitch(letter))
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'n') tapUp()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [togglePlay, tapDown, tapUp, navigate, changePitch, listen, makeRest, toggleDotted, setNoteLength, enterPitch, undo, redo, selectedNote, selectedRest, notes])

  // --- Files -----------------------------------------------------------------------

  const saveFile = () => {
    const blob = new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${project.title || 'whistle-score'}.whistle.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const commitTitle = () => {
    const t = title.trim() || 'Untitled'
    if (t !== project.title) edit((p) => ({ ...p, title: t }))
  }

  const score = useMemo(() => ({ notes, beatsPerMeasure }), [notes, beatsPerMeasure])
  const bar = pos !== null ? Math.floor(pos / beatsPerMeasure) + 1 : 1

  return (
    <main className="score-screen">
      <section className="score-head">
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Title"
        />
        <p className="muted">
          D whistle · {beatsPerMeasure}/4 · {notes.length} note{notes.length === 1 ? '' : 's'}
          {song ? (song.title && song.title !== project.title ? ` · ${song.title}` : '') : ' · no song'}
        </p>
      </section>

      {song && songMissing && (
        <p className="warning">
          This song’s audio is no longer on the server (it keeps the last few songs, and forgets them when it restarts).
          You can still edit, play and print the score.
        </p>
      )}

      {song && hasSong && (
        <>
          <Transport
            player={songPlayer}
            bar={bar}
            onPlayPause={togglePlay}
            onSeek={(t) => {
              if (songPlayer.playing) playSong(Math.max(0, t))
              else songPlayer.seek(t)
            }}
            whistleAlong={whistleAlong}
            onWhistleAlong={setWhistleAlong}
            clicks={clicks}
            onClicks={setClicks}
            tapGrid={tapGrid}
            onTapGrid={setTapGrid}
            tapping={tapping}
            onTapDown={tapDown}
            onTapUp={tapUp}
          />
          <GridPanel song={song} time={songPlayer.time} onChange={(g) => edit((p) => (p.song ? { ...p, song: { ...p.song, ...g } } : p))} />
        </>
      )}

      <section className="toolbar" aria-label="Score controls">
        <div className="group">
          {whistlePlaying ? (
            <button onClick={stopWhistle}>■ Stop</button>
          ) : (
            <button onClick={() => playWhistle(0)} disabled={notes.length === 0} title="Play the notes you have written">
              ▶ Play my score
            </button>
          )}
          {!song && (
            <label className="field-inline">
              <span>♩ =</span>
              <input
                type="number"
                min={30}
                max={260}
                value={project.tempo}
                onChange={(e) => {
                  const t = Number(e.target.value)
                  if (t >= 30 && t <= 260) edit((p) => ({ ...p, tempo: t }))
                }}
                aria-label="Tempo"
              />
            </label>
          )}
        </div>
        <div className="group">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
            ↷ Redo
          </button>
        </div>
        <div className="group">
          <span className="label">Key</span>
          <button onClick={() => setNotes((n) => transposeAll(n, -1))} disabled={!notes.length} title="Everything down a semitone">
            −
          </button>
          <button onClick={() => setNotes((n) => transposeAll(n, 1))} disabled={!notes.length} title="Everything up a semitone">
            +
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

      {notes.length === 0 && (
        <div className="card empty-score">
          <h3>An empty score</h3>
          {hasSong ? (
            <p>
              Press <kbd>Space</kbd> to play the song and pause where the tune starts. Then press <kbd>→</kbd> for the
              first note (or tap a fingering below) and use <kbd>↑</kbd> <kbd>↓</kbd> until it sounds right. Or, while
              the song plays, hold <kbd>N</kbd> for as long as each note lasts to tap in the rhythm, then fix the pitches.
            </p>
          ) : (
            <p>
              Press <kbd>→</kbd> for the first note (or tap a fingering below) and use <kbd>↑</kbd> <kbd>↓</kbd> to
              change it. Letters <kbd>D</kbd> <kbd>E</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd>{' '}
              enter notes directly.
            </p>
          )}
        </div>
      )}

      <ScoreView
        arrangement={score}
        showNames={showNames}
        selectedId={selectedNote?.id ?? null}
        selectedRange={selectedRest}
        playingId={playingId}
        playingPos={songPlayer.playing ? pos : null}
        onSelect={selectFromScore}
      />

      <details className="keys-help">
        <summary>Keyboard shortcuts</summary>
        <ul>
          <li><kbd>Space</kbd> play / pause · <kbd>Enter</kbd> hear the selected note in the song</li>
          <li><kbd>←</kbd> <kbd>→</kbd> previous / next note (<kbd>→</kbd> after the last note adds one)</li>
          <li><kbd>↑</kbd> <kbd>↓</kbd> next whistle note up / down · with <kbd>Shift</kbd>: a semitone</li>
          <li><kbd>D</kbd> <kbd>E</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> that note (F♯ and C♯, the nearest octave)</li>
          <li><kbd>1</kbd>–<kbd>5</kbd> sixteenth, eighth, quarter, half, whole · <kbd>.</kbd> dotted</li>
          <li><kbd>Delete</kbd> make it a rest · <kbd>Esc</kbd> deselect · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</li>
          <li>While the song plays, hold <kbd>N</kbd> for as long as each note lasts to tap notes in</li>
        </ul>
      </details>

      <NotePad
        note={selectedNote}
        rest={selectedRest}
        step={stepLength}
        canListen={notes.length > 0 || hasSong}
        onPitch={enterPitch}
        onLength={setNoteLength}
        onDotted={toggleDotted}
        onRest={makeRest}
        onNavigate={navigate}
        onOrnament={(o) => selectedNote && setNotes((n) => toggleOrnament(n, selectedNote.id, o))}
        onListen={listen}
        onClose={() => setCursor(null)}
      />
    </main>
  )
}
