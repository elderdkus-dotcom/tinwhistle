/** A loaded song or recording (see backend/app/songs.py): its audio stays on the server. */
export interface Song {
  id: string
  title: string
  duration: number // seconds
  tempo: number
  beatsPerMeasure: number
  /** Beat times in seconds; score position p is at beat index p + origin. */
  beats: number[]
  origin: number
}

/** A note as heard in a tune: MIDI pitch, position and length in beats. */
export interface SourceNote {
  pitch: number
  start: number
  duration: number
}

/** Notes with a meter and tempo (the demo tunes; input to the arranger). */
export interface Melody {
  tempo: number
  beatsPerMeasure: number
  notes: SourceNote[]
}

export type Level = 'beginner' | 'intermediate' | 'expert'

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

/** What the score renderer draws. */
export interface Score {
  notes: ScoreNote[]
  beatsPerMeasure: number
}

export interface Arrangement extends Score {
  level: Level
  transpose: number // semitones applied to the source melody
  tempo: number // suggested playback tempo in BPM
}
