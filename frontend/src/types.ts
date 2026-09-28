/** A loaded song (see backend/app/songs.py): its audio stays on the server. */
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

/** A note as heard in the song: MIDI pitch, position and length in beats. */
export interface SourceNote {
  pitch: number
  start: number
  duration: number
  /** Where it was heard in the song, in seconds (absent for demo tunes). */
  time?: number
  timeEnd?: number
  /** The part of the song it was scored in. */
  part?: string
}

/** Notes to arrange, with the song's meter and tempo. */
export interface Melody {
  tempo: number
  beatsPerMeasure: number
  notes: SourceNote[]
}

/** Which instrument carries the melody (backend/app/songs.py: SOURCES). */
export type MelodySource = 'voice' | 'whistle' | 'flute' | 'instrument' | 'mix'

export const MELODY_SOURCES: { value: MelodySource; label: string; hint: string }[] = [
  { value: 'voice', label: 'Singer', hint: 'The sung melody' },
  { value: 'whistle', label: 'Tin whistle', hint: 'A tin whistle, piccolo or other high blown instrument (from A4 up)' },
  { value: 'flute', label: 'Flute / low whistle', hint: 'A concert flute or low whistle, which play an octave lower (from A3 up)' },
  { value: 'instrument', label: 'Other instrument', hint: 'Guitar, piano, fiddle… (everything except voice, drums and bass)' },
  { value: 'mix', label: 'Whole band', hint: 'The highest line of the whole recording' },
]

/**
 * A stretch of the song the user has dealt with: scored (with notes) or
 * skipped (e.g. an instrumental intro). A new part is a draft until kept.
 */
export interface Part {
  id: string
  start: number // seconds
  end: number
  kind: 'scored' | 'skipped'
  status: 'draft' | 'kept'
  notes: SourceNote[]
  separated: boolean
  warnings: string[]
  /** What the melody was taken from (scored parts only). */
  source?: MelodySource
}

/**
 * A note the user marked as the sound to catch (wanted) or to ignore, used to
 * teach the analysis which instrument they mean (backend/app/audio/profile.py).
 */
export interface SoundExample {
  id: string
  wanted: boolean
  /** The score note it came from, while it still exists (for "right sound" marks). */
  noteId?: string
  time: number // seconds in the song
  end: number
  pitch: number // MIDI, as heard in the song
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
  part?: string
  /** Where the note was heard in the song, in seconds. */
  time?: number
}

export interface Arrangement {
  level: Level
  transpose: number // semitones applied to the source melody
  notes: ScoreNote[]
  beatsPerMeasure: number
  tempo: number // suggested playback tempo in BPM
}
