/** The open song: its melody, one arrangement per level, and undo history. */

import { useCallback, useEffect, useState } from 'react'
import { arrange } from './arrange'
import type { Arrangement, Level, Melody } from './types'

export interface Project {
  melody: Melody
  jobId: string | null
  level: Level
  arrangements: Partial<Record<Level, Arrangement>>
}

interface History {
  past: Arrangement[]
  future: Arrangement[]
}

const STORAGE_KEY = 'tinwhistle:project:v1'
const MAX_HISTORY = 100

function loadStored(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Project) : null
  } catch {
    return null
  }
}

function withLevel(p: Project, level: Level): Project {
  if (p.arrangements[level]) return { ...p, level }
  return { ...p, level, arrangements: { ...p.arrangements, [level]: arrange(p.melody, level) } }
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

  const open = useCallback((melody: Melody, jobId: string | null, level: Level = 'beginner') => {
    setHistory({})
    setProject(withLevel({ melody, jobId, level, arrangements: {} }, level))
  }, [])

  const restore = useCallback((p: Project) => {
    setHistory({})
    setProject(withLevel(p, p.level))
  }, [])

  const close = useCallback(() => {
    setHistory({})
    setProject(null)
  }, [])

  const setLevel = useCallback((level: Level) => {
    setProject((p) => (p ? withLevel(p, level) : p))
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
    open,
    restore,
    close,
    setLevel,
    edit,
    undo: () => step('undo'),
    redo: () => step('redo'),
  }
}
