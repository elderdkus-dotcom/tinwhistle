/**
 * Mapping between song time (seconds) and score position (beats), using the
 * song's tracked beats so the score follows the music's own tempo changes.
 * Mirrors seconds_to_beats in backend/app/music/rhythm.py.
 */

import type { Song } from './types'

function period(beats: number[]): number {
  if (beats.length < 2) return 0.5
  const diffs = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

/** Score position (beats) at a time in the song. */
export function timeToPos(song: Song, t: number): number {
  const { beats } = song
  const p = period(beats)
  if (beats.length === 0) return t / p - song.origin
  let index: number
  if (t <= beats[0]) index = (t - beats[0]) / p
  else if (t >= beats[beats.length - 1]) index = beats.length - 1 + (t - beats[beats.length - 1]) / p
  else {
    let lo = 0
    let hi = beats.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (beats[mid] <= t) lo = mid
      else hi = mid
    }
    index = lo + (t - beats[lo]) / (beats[hi] - beats[lo])
  }
  return index - song.origin
}

/** Time in the song (seconds) of a score position. */
export function posToTime(song: Song, pos: number): number {
  const { beats } = song
  const p = period(beats)
  const index = pos + song.origin
  if (beats.length === 0) return index * p
  if (index <= 0) return beats[0] + index * p
  const last = beats.length - 1
  if (index >= last) return beats[last] + (index - last) * p
  const lo = Math.floor(index)
  return beats[lo] + (index - lo) * (beats[lo + 1] - beats[lo])
}
