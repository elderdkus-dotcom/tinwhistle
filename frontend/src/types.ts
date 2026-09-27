/** The analysis result returned by the backend (see backend/app/music/model.py). */
export interface Melody {
  tempo: number
  beatsPerMeasure: number
  key: string
  notes: SourceNote[]
  durationSeconds: number
  title: string
  separated: boolean
  warnings: string[]
}

/** A note as heard in the song: MIDI pitch, times in beats. */
export interface SourceNote {
  pitch: number
  start: number
  duration: number
}

export type Level = 'beginner' | 'intermediate' | 'expert'
export const LEVELS: Level[] = ['beginner', 'intermediate', 'expert']

export type Ornament = 'cut' | 'roll'

/**
 * A note in the whistle score. Pitches are *written* pitches: whistle music is
 * notated an octave below how a D whistle sounds, so the bottom D is D4 (62).
 */
export interface ScoreNote {
  id: string
  pitch: number
  start: number // beats from the start of the first measure
  duration: number // beats
  ornament?: Ornament
}

export interface Arrangement {
  level: Level
  transpose: number // semitones applied to the source melody
  notes: ScoreNote[]
  beatsPerMeasure: number
  tempo: number // suggested playback tempo in BPM
}
