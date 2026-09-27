/** Facts about the D tin whistle: range, fingerings and how hard each note is. */

/** Written pitch of the bottom note (all holes covered). Sounds as D5. */
export const LOW_D = 62
/** Highest note in the second octave (C#, all holes open, blown hard). */
export const HIGH_C_SHARP = 85
/** A D whistle sounds an octave above written pitch. */
export const SOUNDING_OFFSET = 12

/** 1 = covered, 0.5 = half-holed, 0 = open; top hole first. */
export type Hole = 0 | 0.5 | 1
export type Fingering = [Hole, Hole, Hole, Hole, Hole, Hole]

/** Fingerings by semitones above D. */
const FINGERINGS: Fingering[] = [
  [1, 1, 1, 1, 1, 1], // D
  [1, 1, 1, 1, 1, 0.5], // D#/Eb (half-hole)
  [1, 1, 1, 1, 1, 0], // E
  [1, 1, 1, 1, 0.5, 0], // F (half-hole)
  [1, 1, 1, 1, 0, 0], // F#
  [1, 1, 1, 0, 0, 0], // G
  [1, 1, 0.5, 0, 0, 0], // G#/Ab (half-hole)
  [1, 1, 0, 0, 0, 0], // A
  [1, 0.5, 0, 0, 0, 0], // A#/Bb (half-hole)
  [1, 0, 0, 0, 0, 0], // B
  [0, 1, 1, 0, 0, 0], // C natural (cross-fingering)
  [0, 0, 0, 0, 0, 0], // C#
]

export type Technique = 'plain' | 'cross' | 'half-hole'
const TECHNIQUE: Technique[] = [
  'plain', 'half-hole', 'plain', 'half-hole', 'plain', 'plain',
  'half-hole', 'plain', 'half-hole', 'plain', 'cross', 'plain',
]

/** Semitones above D of the D major scale, the whistle's natural notes. */
export const D_MAJOR = [0, 2, 4, 5, 7, 9, 11]

export function degree(pitch: number): number {
  return (((pitch - LOW_D) % 12) + 12) % 12
}

export function inRange(pitch: number): boolean {
  return pitch >= LOW_D && pitch <= HIGH_C_SHARP
}

export function fingering(pitch: number): Fingering {
  return FINGERINGS[degree(pitch)]
}

export function technique(pitch: number): Technique {
  return TECHNIQUE[degree(pitch)]
}

/** 1 for the bottom octave, 2 for the second (overblown) octave. */
export function register(pitch: number): 1 | 2 {
  return pitch >= LOW_D + 12 ? 2 : 1
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Letter name as whistlers say it (sharps, except Bb). */
export function noteName(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12
  return pc === 10 ? FLAT_NAMES[pc] : SHARP_NAMES[pc]
}

/** Name with octave, e.g. "F#4", used by the notation renderer. */
export function scientificName(pitch: number): { letter: string; accidental: '' | '#' | 'b'; octave: number } {
  const name = noteName(pitch)
  return {
    letter: name[0].toLowerCase(),
    accidental: (name.slice(1) as '' | '#' | 'b'),
    octave: Math.floor(pitch / 12) - 1,
  }
}

/** Move by scale steps within D major (plus C natural when asked). */
export function stepScale(pitch: number, steps: number, allowCNatural = false): number {
  const scale = allowCNatural ? [...D_MAJOR, 10].sort((a, b) => a - b) : D_MAJOR
  let p = pitch
  const dir = Math.sign(steps)
  for (let i = 0; i < Math.abs(steps); i++) {
    do {
      p += dir
    } while (!scale.includes(degree(p)))
  }
  return p
}
