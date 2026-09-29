/** The score being written, with undo/redo, kept in the browser between visits. */

import { useCallback, useEffect, useState } from 'react'
import type { ScoreNote, Song } from './types'

export interface Project {
  version: 3
  title: string
  /** The song or recording it is written against; null for a score on its own. */
  song: Song | null
  beatsPerMeasure: number
  /** Playback tempo for the score when there is no song. */
  tempo: number
  notes: ScoreNote[]
}

const STORAGE_KEY = 'tinwhistle.project.v3'
const MAX_UNDO = 200

export function newProject(title: string, song: Song | null, beatsPerMeasure: number, notes: ScoreNote[] = [], tempo = 100): Project {
  return { version: 3, title, song, beatsPerMeasure, tempo: Math.round(song?.tempo ?? tempo), notes }
}

/** Check a saved file and bring it to the current format. Throws if it is not a score. */
export function parseProject(data: unknown): Project {
  const p = data as Partial<Project>
  if (!p || p.version !== 3 || !Array.isArray(p.notes) || typeof p.beatsPerMeasure !== 'number') {
    throw new Error('That file is not a saved whistle score (or was saved by an older version).')
  }
  return {
    version: 3,
    title: String(p.title ?? ''),
    song: p.song ?? null,
    beatsPerMeasure: p.beatsPerMeasure,
    tempo: typeof p.tempo === 'number' ? p.tempo : 100,
    notes: p.notes.map((n, i) => ({ ...n, id: n.id || `n${i}` })),
  }
}

/** The score from the last visit, if any. */
export function savedProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseProject(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

interface History {
  project: Project | null
  past: Project[]
  future: Project[]
}

export function useProject() {
  const [h, setH] = useState<History>({ project: null, past: [], future: [] })

  useEffect(() => {
    if (!h.project) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(h.project))
      } catch {
        // storage full or blocked: the score still works, it just is not kept
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [h.project])

  const open = useCallback((project: Project) => setH({ project, past: [], future: [] }), [])

  const close = useCallback(() => {
    setH({ project: null, past: [], future: [] })
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  /** Change the project as one undoable step. */
  const edit = useCallback((change: (p: Project) => Project) => {
    setH((prev) => {
      if (!prev.project) return prev
      const next = change(prev.project)
      if (next === prev.project) return prev
      return { project: next, past: [...prev.past.slice(-MAX_UNDO), prev.project], future: [] }
    })
  }, [])

  const undo = useCallback(() => {
    setH((prev) =>
      prev.past.length && prev.project
        ? { project: prev.past[prev.past.length - 1], past: prev.past.slice(0, -1), future: [prev.project, ...prev.future] }
        : prev,
    )
  }, [])

  const redo = useCallback(() => {
    setH((prev) =>
      prev.future.length && prev.project
        ? { project: prev.future[0], past: [...prev.past, prev.project], future: prev.future.slice(1) }
        : prev,
    )
  }, [])

  return {
    project: h.project,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    open,
    close,
    edit,
    undo,
    redo,
  }
}
