/**
 * Fixes for a song's beat grid (the beats that score positions map to). Beat
 * tracking can land on half or double the real tempo, or put bar lines in the
 * wrong place, and a hummed tune may have no clear beat at all; these let the
 * user put that right. Notes keep their score positions.
 */

import type { Song } from './types'

type Grid = Pick<Song, 'beats' | 'origin' | 'tempo'>

const mod = (a: number, n: number) => ((a % n) + n) % n

/** Every other beat (the tracker counted twice as many beats as there are). */
export function halveTempo(song: Grid): Grid {
  if (song.beats.length < 4) return song
  const keep = mod(Math.round(song.origin), 2)
  return {
    beats: song.beats.filter((_, i) => i % 2 === keep),
    origin: (song.origin - keep) / 2,
    tempo: song.tempo / 2,
  }
}

/** A beat between every two (the tracker found only half the beats). */
export function doubleTempo(song: Grid): Grid {
  const beats: number[] = []
  song.beats.forEach((b, i) => {
    beats.push(b)
    const next = song.beats[i + 1]
    if (next !== undefined) beats.push((b + next) / 2)
  })
  return { beats, origin: song.origin * 2, tempo: song.tempo * 2 }
}

/** Move the bar lines by whole beats (positive: the first beat of a bar comes later). */
export function shiftBars(song: Grid, beats: number): Grid {
  return { ...song, origin: song.origin + beats }
}

/**
 * A steady grid: `bpm` beats a minute with a bar starting at `firstDownbeat`
 * seconds, covering `duration` seconds. Score position 0 is a bar line at or
 * before the start.
 */
export function steadyGrid(duration: number, firstDownbeat: number, bpm: number, beatsPerMeasure: number): Grid {
  const period = 60 / bpm
  const before = Math.max(0, Math.floor(firstDownbeat / period + 1e-9))
  const start = firstDownbeat - before * period
  const beats: number[] = []
  for (let t = start; t <= duration + period; t += period) beats.push(t)
  // Beat index of time 0, then the bar line at or before it (as score_origin in rhythm.py).
  const atZero = -start / period
  const origin = before - Math.ceil((before - atZero) / beatsPerMeasure - 1e-9) * beatsPerMeasure
  return { beats, origin, tempo: bpm }
}
