/**
 * The open song: the parts scored so far, one arrangement per level, and undo
 * history. Songs are scored part by part: a new part arrives as a draft, and
 * the user keeps or discards it before scoring the next one.
 */

import { useCallback, useEffect, useState } from 'react'
import { appendPart, arrange, removePart } from './arrange'
import type { Arrangement, Level, Melody, MelodySource, Part, Song, SoundExample, SourceNote } from './types'

export interface Project {
  /** The loaded song; null for the built-in demo tunes, which have no audio. */
  song: Song | null
  title: string
  tempo: number
  beatsPerMeasure: number
  parts: Part[]
  /** The instrument to take the next part's melody from. */
  source?: MelodySource
  /** Notes marked as the right / wrong sound, sent along when scoring parts. */
  examples?: SoundExample[]
  level: Level
  arrangements: Partial<Record<Level, Arrangement>>
}

interface History {
  past: Arrangement[]
  future: Arrangement[]
}

const STORAGE_KEY = 'tinwhistle:project:v2'
const MAX_HISTORY = 100

function loadStored(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Project) : null
  } catch {
    return null
  }
}

export function melodyOf(p: Project): Melody {
  const notes: SourceNote[] = p.parts.flatMap((part) => part.notes.map((n) => ({ ...n, part: part.id })))
  return { tempo: p.tempo, beatsPerMeasure: p.beatsPerMeasure, notes }
}

/** Where scoring has got to in the song, in seconds. */
export function scoredUntil(p: Project): number {
  return p.parts.reduce((m, part) => Math.max(m, part.end), 0)
}

export function draftPart(p: Project): Part | undefined {
  return p.parts.find((part) => part.status === 'draft')
}

function withLevel(p: Project, level: Level): Project {
  if (p.arrangements[level] || p.parts.every((part) => part.notes.length === 0)) return { ...p, level }
  return { ...p, level, arrangements: { ...p.arrangements, [level]: arrange(melodyOf(p), level) } }
}

let partCounter = 0
function newPartId(): string {
  partCounter += 1
  return `p${Date.now().toString(36)}${partCounter}`
}

export function useProject() {
  const [project, setProject] = useState<Project | null>(loadStored)
  const [history, setHistory] = useState<Partial<Record<Level, History>>>({})

  useEffect(() => {
    try {
      if (project) localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage may be unavailable (private mode); the app still works.
    }
  }, [project])

  /** Start working on a freshly loaded song (nothing scored yet). */
  const openSong = useCallback((song: Song) => {
    setHistory({})
    setProject({
      song,
      title: song.title,
      tempo: song.tempo,
      beatsPerMeasure: song.beatsPerMeasure,
      parts: [],
      level: 'beginner',
      arrangements: {},
    })
  }, [])

  /** Open a demo tune: one kept part, no audio. */
  const openTune = useCallback((title: string, melody: Melody) => {
    setHistory({})
    const part: Part = {
      id: 'demo',
      start: 0,
      end: 0,
      kind: 'scored',
      status: 'kept',
      notes: melody.notes,
      separated: false,
      warnings: [],
    }
    const base: Project = {
      song: null,
      title,
      tempo: melody.tempo,
      beatsPerMeasure: melody.beatsPerMeasure,
      parts: [part],
      level: 'beginner',
      arrangements: {},
    }
    setProject(withLevel(base, 'beginner'))
  }, [])

  const restore = useCallback((p: Project) => {
    setHistory({})
    setProject(withLevel(p, p.level))
  }, [])

  const close = useCallback(() => {
    setHistory({})
    setProject(null)
  }, [])

  const setSource = useCallback((source: MelodySource) => {
    setProject((p) => (p ? { ...p, source } : p))
  }, [])

  const setExamples = useCallback((change: (examples: SoundExample[]) => SoundExample[]) => {
    setProject((p) => (p ? { ...p, examples: change(p.examples ?? []) } : p))
  }, [])

  const setLevel = useCallback((level: Level) => {
    setProject((p) => (p ? withLevel(p, level) : p))
  }, [])

  /** Add a newly scored (or skipped) stretch of the song as a draft. */
  const addPart = useCallback((part: Omit<Part, 'id' | 'status'>, status: Part['status'] = 'draft') => {
    const id = newPartId()
    setHistory({})
    setProject((p) => {
      if (!p) return p
      const full: Part = { ...part, id, status }
      const next: Project = { ...p, parts: [...p.parts, full] }
      const arrangements: Project['arrangements'] = {}
      for (const [level, arr] of Object.entries(p.arrangements) as [Level, Arrangement][]) {
        arrangements[level] = appendPart(arr, id, full.notes)
      }
      next.arrangements = arrangements
      return withLevel(next, p.level)
    })
    return id
  }, [])

  const keepPart = useCallback((id: string) => {
    setProject((p) =>
      p ? { ...p, parts: p.parts.map((part) => (part.id === id ? { ...part, status: 'kept' } : part)) } : p,
    )
  }, [])

  const discardPart = useCallback((id: string) => {
    setHistory({})
    setProject((p) => {
      if (!p) return p
      const parts = p.parts.filter((part) => part.id !== id)
      const arrangements: Project['arrangements'] = {}
      if (parts.some((part) => part.notes.length > 0)) {
        for (const [level, arr] of Object.entries(p.arrangements) as [Level, Arrangement][]) {
          arrangements[level] = removePart(arr, id)
        }
      }
      return { ...p, parts, arrangements }
    })
  }, [])

  /** Apply an edit to the current level's arrangement, recording undo history. */
  const edit = useCallback(
    (change: (a: Arrangement) => Arrangement) => {
      if (!project) return
      const level = project.level
      const before = project.arrangements[level]
      if (!before) return
      const after = change(before)
      if (after === before) return
      setHistory((h) => ({
        ...h,
        [level]: { past: [...(h[level]?.past ?? []), before].slice(-MAX_HISTORY), future: [] },
      }))
      setProject({ ...project, arrangements: { ...project.arrangements, [level]: after } })
    },
    [project],
  )

  /** Rebuild the current level from the scored parts (drops edits on this level). */
  const resetLevel = useCallback(() => {
    if (project) edit(() => arrange(melodyOf(project), project.level))
  }, [project, edit])

  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      if (!project) return
      const level = project.level
      const h = history[level]
      const current = project.arrangements[level]
      if (!h || !current) return
      const from = direction === 'undo' ? h.past : h.future
      if (from.length === 0) return
      const target = from[from.length - 1]
      const rest = from.slice(0, -1)
      setHistory({
        ...history,
        [level]:
          direction === 'undo'
            ? { past: rest, future: [...h.future, current] }
            : { past: [...h.past, current], future: rest },
      })
      setProject({ ...project, arrangements: { ...project.arrangements, [level]: target } })
    },
    [project, history],
  )

  const level = project?.level
  return {
    project,
    arrangement: project && level ? project.arrangements[level] ?? null : null,
    canUndo: !!(level && history[level]?.past.length),
    canRedo: !!(level && history[level]?.future.length),
    openSong,
    openTune,
    restore,
    close,
    setLevel,
    setSource,
    setExamples,
    addPart,
    keepPart,
    discardPart,
    edit,
    resetLevel,
    undo: () => step('undo'),
    redo: () => step('redo'),
  }
}
