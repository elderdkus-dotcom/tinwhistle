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
