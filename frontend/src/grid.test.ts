import { describe, expect, it } from 'vitest'
import { doubleTempo, halveTempo, shiftBars, steadyGrid } from './grid'
import { posToTime } from './sync'
import type { Song } from './types'

const song = (beats: number[], origin: number): Song => ({
  id: 's', title: '', duration: 10, tempo: 120, beatsPerMeasure: 4, beats, origin,
})

describe('beat grid fixes', () => {
  const s = song([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], -1)

  it('halves the tempo keeping bar 1 in place', () => {
    const half = { ...s, ...halveTempo(s) }
    expect(half.tempo).toBe(60)
    expect(posToTime(half, 0)).toBeCloseTo(posToTime(s, 0))
    expect(posToTime(half, 1)).toBeCloseTo(posToTime(s, 2))
  })

  it('doubles the tempo keeping bar 1 in place', () => {
    const dbl = { ...s, ...doubleTempo(s) }
    expect(dbl.tempo).toBe(240)
    expect(posToTime(dbl, 0)).toBeCloseTo(posToTime(s, 0))
    expect(posToTime(dbl, 2)).toBeCloseTo(posToTime(s, 1))
  })

  it('moves bar lines by a beat', () => {
    const later = { ...s, ...shiftBars(s, 1) }
    expect(posToTime(later, 0)).toBeCloseTo(posToTime(s, 1))
  })

  it('builds a steady grid from a tempo and a downbeat', () => {
    const g = { ...song([], 0), ...steadyGrid(10, 2.25, 120, 4) }
    expect(posToTime(g, 0)).toBeLessThanOrEqual(0.001)
    // The downbeat at 2.25 s is a bar line: a whole number of bars from position 0.
    const posOfDownbeat = (2.25 - posToTime(g, 0)) / 0.5
    expect(posOfDownbeat % 4).toBeCloseTo(0)
    expect(posToTime(g, posOfDownbeat + 1)).toBeCloseTo(2.75)
  })
})
