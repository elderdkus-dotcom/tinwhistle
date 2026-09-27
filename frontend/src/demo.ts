/** Built-in tunes so the app can be tried without uploading anything. */

import type { Melody } from './types'

export interface Demo {
  title: string
  melody: Melody
}

function tune(title: string, tempo: number, beatsPerMeasure: number, pickup: number, seq: [number, number][]): Demo {
  let t = pickup
  const notes = seq.map(([pitch, duration]) => {
    const n = { pitch, start: t, duration }
    t += duration
    return n
  })
  return { title, melody: { tempo, beatsPerMeasure, notes } }
}

const c = 60, d = 62, E = 64, F = 65, G = 67, A = 69, B = 71, D = 74

/** "Ode to Joy" (Beethoven), in C major so the auto-transpose has work to do. */
export const ODE_TO_JOY = tune('Ode to Joy (demo)', 110, 4, 0, [
  [E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [d, 1],
  [c, 1], [c, 1], [d, 1], [E, 1], [E, 1.5], [d, 0.5], [d, 2],
  [E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [d, 1],
  [c, 1], [c, 1], [d, 1], [E, 1], [d, 1.5], [c, 0.5], [c, 2],
  [d, 1], [d, 1], [E, 1], [c, 1], [d, 1], [E, 0.5], [F, 0.5], [E, 1], [c, 1],
  [d, 1], [E, 0.5], [F, 0.5], [E, 1], [d, 1], [c, 1], [d, 1], [G - 12, 2],
  [E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [d, 1],
  [c, 1], [c, 1], [d, 1], [E, 1], [d, 1.5], [c, 0.5], [c, 2],
])

/** "Amazing Grace" (traditional), 3/4 with a pickup, in G major. */
export const AMAZING_GRACE = tune('Amazing Grace (demo)', 80, 3, 2, [
  [d, 1], [G, 2], [B, 0.5], [G, 0.5], [B, 2], [A, 1], [G, 2], [E, 1], [d, 2], [d, 1],
  [G, 2], [B, 0.5], [G, 0.5], [B, 2], [A, 1], [D, 3], [D, 2], [B, 1],
  [D, 1.5], [B, 0.5], [D, 0.5], [B, 0.5], [G, 2], [d, 1], [E, 1.5], [G, 0.5], [G, 0.5], [E, 0.5], [d, 2], [d, 1],
  [G, 2], [B, 0.5], [G, 0.5], [B, 2], [A, 1], [G, 3], [G, 2],
])

export const DEMOS = [ODE_TO_JOY, AMAZING_GRACE]
