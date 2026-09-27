/** Turn a transcribed melody into a whistle score for a difficulty level. */

import type { Arrangement, Level, Melody, ScoreNote, SourceNote } from './types'
import { D_MAJOR, HIGH_C_SHARP, LOW_D, degree, technique } from './whistle'

interface LevelSpec {
  maxPitch: number
  /** Degrees above D the level may use; others are replaced by neighbours. */
  degrees: number[]
  /** Rhythmic resolution in beats. */
  grid: number
  /** Rests shorter than this are removed by lengthening the previous note. */
  minRest: number
  tempoFactor: number
  ornaments: boolean
}

export const LEVEL_SPECS: Record<Level, LevelSpec> = {
  // Bottom octave plus the easy start of the second; D major only; no
  // sixteenths; slower.
  beginner: { maxPitch: LOW_D + 16, degrees: D_MAJOR, grid: 0.5, minRest: 1, tempoFactor: 0.75, ornaments: false },
  // Both octaves up to B; adds C natural (cross-fingered); sixteenths.
  intermediate: {
    maxPitch: LOW_D + 21,
    degrees: [...D_MAJOR, 10],
    grid: 0.25,
    minRest: 0.5,
    tempoFactor: 0.9,
    ornaments: false,
  },
  // Full range, every chromatic note via half-holing, ornaments.
  expert: {
    maxPitch: HIGH_C_SHARP,
    degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    grid: 0.25,
    minRest: 0.25,
    tempoFactor: 1,
    ornaments: true,
  },
}

const TECHNIQUE_COST = { plain: 0, cross: 0.2, 'half-hole': 0.6 }
/**
 * Costs per beat. Folding a stray note by an octave is cheaper than pushing
 * the whole tune up into the harder second octave, so a C major tune lands in
 * D major rather than A major.
 */
const OUT_OF_RANGE_COST = 1
const NOT_ALLOWED_COST = 2
const SECOND_OCTAVE_COST = 0.3

function pitchCost(pitch: number, spec: LevelSpec): number {
  let cost = 0
  if (pitch < LOW_D || pitch > spec.maxPitch) cost += OUT_OF_RANGE_COST
  if (!spec.degrees.includes(degree(pitch))) cost += NOT_ALLOWED_COST
  else cost += TECHNIQUE_COST[technique(pitch)]
  if (pitch >= LOW_D + 12) cost += SECOND_OCTAVE_COST
  return cost
}

/** The transposition (in semitones) that makes the melody easiest to play. */
export function chooseTranspose(notes: SourceNote[], level: Level): number {
  if (notes.length === 0) return 0
  const spec = LEVEL_SPECS[level]
  let best = 0
  let bestCost = Infinity
  for (let shift = -36; shift <= 36; shift++) {
    let cost = Math.abs(shift) * 0.001
    for (const n of notes) cost += n.duration * pitchCost(n.pitch + shift, spec)
    if (cost < bestCost - 1e-9) {
      best = shift
      bestCost = cost
    }
  }
  return best
}

/** Move a pitch into the level's range and onto a note the level allows. */
export function fitPitch(pitch: number, level: Level, previous?: number): number {
  const spec = LEVEL_SPECS[level]
  const fold = (p: number) => {
    while (p < LOW_D) p += 12
    while (p > spec.maxPitch) p -= 12
    return p
  }
  let p = fold(pitch)
  if (!spec.degrees.includes(degree(p))) {
    const down = p - 1
    const up = p + 1
    const candidates = [down, up].filter((c) => spec.degrees.includes(degree(c)))
    if (candidates.length === 1) p = candidates[0]
    else {
      // Both neighbours work: follow the melody's direction, else go down.
      const ref = previous ?? p
      p = Math.abs(up - ref) < Math.abs(down - ref) ? up : down
    }
    p = fold(p)
  }
  return p
}

/** Snap to the level's grid, keep the line monophonic, and close short rests. */
export function simplifyRhythm(notes: ScoreNote[], grid: number, minRest: number): ScoreNote[] {
  const snap = (x: number) => Math.round(x / grid) * grid
  const out: ScoreNote[] = []
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    const start = snap(n.start)
    const end = snap(n.start + n.duration)
    if (end <= start) continue // too short for this level
    const prev = out[out.length - 1]
    if (prev && start < prev.start + prev.duration) {
      if (start <= prev.start) {
        // Same slot: keep the longer note.
        if (end - start > prev.duration) out[out.length - 1] = { ...n, start, duration: end - start }
        continue
      }
      prev.duration = start - prev.start
    }
    out.push({ ...n, start, duration: end - start })
  }
  for (let i = 0; i + 1 < out.length; i++) {
    const gap = out[i + 1].start - (out[i].start + out[i].duration)
    if (gap > 1e-9 && gap < minRest - 1e-9) out[i].duration += gap
  }
  return out
}

const ROLLABLE = [2, 4, 5, 7, 9] // E F# G A B in the bottom octave
const ROLL_LENGTHS = [1.5, 3] // dotted notes, where rolls sit naturally

/**
 * Traditional ornaments: cuts between repeated notes, and rolls on dotted
 * notes (never two rolls in a row, so the tune is not smothered).
 */
export function addOrnaments(notes: ScoreNote[]): ScoreNote[] {
  const out: ScoreNote[] = []
  notes.forEach((n, i) => {
    out.push(ornamentFor(n, notes[i - 1], out[i - 1]))
  })
  return out
}

function ornamentFor(n: ScoreNote, prev: ScoreNote | undefined, prevOut: ScoreNote | undefined): ScoreNote {
  if (
    ROLL_LENGTHS.includes(n.duration) &&
    n.pitch < LOW_D + 12 &&
    ROLLABLE.includes(degree(n.pitch)) &&
    prevOut?.ornament !== 'roll'
  ) {
    return { ...n, ornament: 'roll' }
  }
  if (prev && prev.pitch === n.pitch && Math.abs(prev.start + prev.duration - n.start) < 1e-9) {
    return { ...n, ornament: 'cut' }
  }
  return { ...n, ornament: undefined }
}

export function arrange(melody: Melody, level: Level, transpose?: number): Arrangement {
  const spec = LEVEL_SPECS[level]
  const shift = transpose ?? chooseTranspose(melody.notes, level)
  let previous: number | undefined
  const pitched: ScoreNote[] = melody.notes.map((n, i) => {
    const pitch = fitPitch(n.pitch + shift, level, previous)
    previous = pitch
    return { id: `n${i}`, pitch, start: n.start, duration: n.duration }
  })
  let notes = simplifyRhythm(pitched, spec.grid, spec.minRest)
  if (spec.ornaments) notes = addOrnaments(notes)
  return {
    level,
    transpose: shift,
    notes,
    beatsPerMeasure: melody.beatsPerMeasure,
    tempo: Math.round(melody.tempo * spec.tempoFactor),
  }
}

/** D major (two sharps) unless C naturals outnumber C sharps. */
export function keySignature(notes: ScoreNote[]): 'D' | 'G' {
  let cNatural = 0
  let cSharp = 0
  for (const n of notes) {
    if (degree(n.pitch) === 10) cNatural += n.duration
    if (degree(n.pitch) === 11) cSharp += n.duration
  }
  return cNatural > cSharp ? 'G' : 'D'
}
