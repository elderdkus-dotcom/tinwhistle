/** Pure editing operations on a score's notes. Each returns a new array. */

import type { Ornament, ScoreNote } from './types'
import { HIGH_C_SHARP, LOW_D, stepScale } from './whistle'

export const DURATIONS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

let nextId = 0
export function newId(): string {
  nextId += 1
  return `e${Date.now().toString(36)}${nextId}`
}

const clampPitch = (p: number) => Math.min(HIGH_C_SHARP, Math.max(LOW_D, p))

function update(notes: ScoreNote[], id: string, change: (n: ScoreNote) => ScoreNote): ScoreNote[] {
  return notes.map((n) => (n.id === id ? change(n) : n))
}

/** Move a note by scale steps (D major plus C natural) or by semitones. */
export function movePitch(notes: ScoreNote[], id: string, amount: number, chromatic: boolean): ScoreNote[] {
  return update(notes, id, (n) => ({
    ...n,
    pitch: clampPitch(chromatic ? n.pitch + amount : stepScale(n.pitch, amount, true)),
  }))
}

/**
 * Make a note longer or shorter by one step of DURATIONS; everything after it
 * moves by the same amount so no notes overlap.
 */
export function changeDuration(notes: ScoreNote[], id: string, steps: number): ScoreNote[] {
  const target = notes.find((n) => n.id === id)
  if (!target) return notes
  const current = DURATIONS.findIndex((d) => d >= target.duration - 1e-9)
  const index = Math.min(DURATIONS.length - 1, Math.max(0, (current < 0 ? DURATIONS.length - 1 : current) + steps))
  const duration = DURATIONS[index]
  const delta = duration - target.duration
  if (delta === 0) return notes
  const end = target.start + target.duration
  return notes.map((n) => {
    if (n.id === id) return { ...n, duration }
    if (n.start >= end - 1e-9) return { ...n, start: n.start + delta }
    return n
  })
}

/** Remove a note, leaving a rest in its place. */
export function deleteNote(notes: ScoreNote[], id: string): ScoreNote[] {
  return notes.filter((n) => n.id !== id)
}

/** Insert a copy of a note right after it, pushing later notes back. */
export function insertAfter(notes: ScoreNote[], id: string): { notes: ScoreNote[]; id: string } {
  const target = notes.find((n) => n.id === id)
  if (!target) return { notes, id }
  const end = target.start + target.duration
  const inserted: ScoreNote = { id: newId(), pitch: target.pitch, start: end, duration: target.duration }
  const shifted = notes.map((n) => (n.start >= end - 1e-9 ? { ...n, start: n.start + target.duration } : n))
  const at = shifted.findIndex((n) => n.id === id) + 1
  return { notes: [...shifted.slice(0, at), inserted, ...shifted.slice(at)], id: inserted.id }
}

export function toggleOrnament(notes: ScoreNote[], id: string, ornament: Ornament): ScoreNote[] {
  return update(notes, id, (n) => ({ ...n, ornament: n.ornament === ornament ? undefined : ornament }))
}

/** Shift every note by semitones, staying on the whistle. */
export function transposeAll(notes: ScoreNote[], semitones: number): ScoreNote[] {
  return notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch + semitones) }))
}

export function neighbour(notes: ScoreNote[], id: string, direction: 1 | -1): string | undefined {
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const i = sorted.findIndex((n) => n.id === id)
  return sorted[i + direction]?.id
}

/** Merge a note with the one after it into one longer note (for a note that was split). */
export function joinWithNext(notes: ScoreNote[], id: string): ScoreNote[] {
  const next = neighbour(notes, id, 1)
  const target = notes.find((n) => n.id === id)
  const after = notes.find((n) => n.id === next)
  if (!target || !after) return notes
  const end = Math.max(target.start + target.duration, after.start + after.duration)
  return notes
    .filter((n) => n.id !== after.id)
    .map((n) => (n.id === id ? { ...n, duration: end - n.start } : n))
}

/** Add a note in a rest; it takes the pitch of the note before it, to be adjusted. */
export function addNoteAt(notes: ScoreNote[], start: number, beats: number): { notes: ScoreNote[]; id: string } {
  const before = [...notes].filter((n) => n.start < start).sort((a, b) => b.start - a.start)[0]
  const note: ScoreNote = {
    id: newId(),
    pitch: before?.pitch ?? LOW_D + 12,
    start,
    duration: Math.min(beats, 1),
  }
  return { notes: [...notes, note].sort((a, b) => a.start - b.start), id: note.id }
}

// --- Writing a score against a song ("overwrite" editing, as in MuseScore):
// notes keep their place in time, so the score stays in step with the song.

const EPS = 1e-9

/** Remove what overlaps [start, end): notes starting inside go, a note running into it is cut short. */
function clear(notes: ScoreNote[], start: number, end: number, keep?: string): ScoreNote[] {
  return notes
    .filter((n) => n.id === keep || !(n.start >= start - EPS && n.start < end - EPS))
    .map((n) => (n.id !== keep && n.start < start && n.start + n.duration > start + EPS ? { ...n, duration: start - n.start } : n))
}

/** Set a note's length. Longer covers the notes after it; shorter leaves a rest. */
export function setLength(notes: ScoreNote[], id: string, beats: number): ScoreNote[] {
  const target = notes.find((n) => n.id === id)
  if (!target || beats <= 0) return notes
  const end = target.start + beats
  return clear(update(notes, id, (n) => ({ ...n, duration: beats })), target.start + target.duration, end, id).filter(
    (n) => n.id === id || !(n.start > target.start && n.start < end - EPS),
  )
}

/** Put a note over [start, start + beats), replacing whatever sounded there. */
export function placeNote(
  notes: ScoreNote[],
  start: number,
  beats: number,
  pitch: number,
): { notes: ScoreNote[]; id: string } {
  const note: ScoreNote = { id: newId(), pitch: clampPitch(pitch), start, duration: beats }
  return { notes: [...clear(notes, start, start + beats), note].sort((a, b) => a.start - b.start), id: note.id }
}

/** The pitch to give a new note at `start`: the note before it, or the whistle's middle D. */
export function pitchBefore(notes: ScoreNote[], start: number): number {
  const before = notes.filter((n) => n.start < start - EPS).sort((a, b) => b.start - a.start)[0]
  return before?.pitch ?? LOW_D + 12
}

/** What is selected while writing: a note, or a stretch of rest between notes. */
export type Cursor = { kind: 'note'; id: string } | { kind: 'rest'; start: number; end: number }

const byStart = (notes: ScoreNote[]) => [...notes].sort((a, b) => a.start - b.start)

/** The whole rest around a position: from the note before it to the note after it (or `fallbackEnd`). */
export function gapAt(notes: ScoreNote[], pos: number, fallbackEnd: number): { start: number; end: number } {
  const before = notes.filter((n) => n.start + n.duration <= pos + EPS)
  const after = notes.filter((n) => n.start >= pos - EPS)
  const start = before.reduce((m, n) => Math.max(m, n.start + n.duration), Math.min(pos, 0))
  const end = after.reduce((m, n) => Math.min(m, n.start), Math.max(fallbackEnd, pos))
  return { start: Math.max(start, 0), end }
}

/**
 * Where ← or → goes from the cursor: the neighbouring note, or the rest in
 * between. Null when there is nothing further that way.
 */
export function step(notes: ScoreNote[], cur: Cursor, dir: 1 | -1): Cursor | null {
  const s = byStart(notes)
  let from: number
  let to: number
  if (cur.kind === 'note') {
    const n = s.find((m) => m.id === cur.id)
    if (!n) return null
    from = n.start
    to = n.start + n.duration
  } else {
    from = cur.start
    to = cur.end
  }
  if (dir === 1) {
    const next = s.find((m) => m.start >= to - EPS && (cur.kind === 'rest' || m.id !== cur.id))
    if (!next) return null
    if (cur.kind === 'note' && next.start > to + EPS) return { kind: 'rest', start: to, end: next.start }
    return { kind: 'note', id: next.id }
  }
  const prev = [...s].reverse().find((m) => m.start + m.duration <= from + EPS && (cur.kind === 'rest' || m.id !== cur.id))
  if (!prev) return null
  const prevEnd = prev.start + prev.duration
  if (cur.kind === 'note' && prevEnd < from - EPS) return { kind: 'rest', start: prevEnd, end: from }
  return { kind: 'note', id: prev.id }
}

/** The pitch a letter key means: that note of D major nearest to `near`. */
export function pitchFromLetter(letter: string, near: number): number | null {
  const pcs: Record<string, number> = { c: 1, d: 2, e: 4, f: 6, g: 7, a: 9, b: 11 } // C# and F#, as on a D whistle
  const pc = pcs[letter.toLowerCase()]
  if (pc === undefined) return null
  const options: number[] = []
  for (let p = LOW_D; p <= HIGH_C_SHARP; p++) if (p % 12 === pc) options.push(p)
  return options.reduce((best, p) => (Math.abs(p - near) < Math.abs(best - near) ? p : best))
}

/** Where the score ends (after its last note). */
export function scoreEnd(notes: ScoreNote[]): number {
  return notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0)
}
