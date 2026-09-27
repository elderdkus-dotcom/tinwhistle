import { describe, expect, it } from 'vitest'
import { posToTime, timeToPos } from './sync'
import type { Song } from './types'

const song: Song = {
  id: 's',
  title: '',
  duration: 30,
  tempo: 120,
  beatsPerMeasure: 4,
  beats: [0.5, 1.0, 1.5, 2.1, 2.7, 3.2], // tempo wobbles
  origin: -3,
}

describe('sync', () => {
  it('maps song time to score position and back', () => {
    expect(timeToPos(song, 0.5)).toBeCloseTo(3) // beat index 0 = position 3
    expect(timeToPos(song, 1.8)).toBeCloseTo(3 + 2.5)
    for (const t of [0.1, 0.5, 1.8, 2.4, 3.2, 10]) {
      expect(posToTime(song, timeToPos(song, t))).toBeCloseTo(t)
    }
  })
})
