/** Lay a note list out as measures of notatable notes, rests and ties. */

import type { Ornament, ScoreNote } from './types'

export const SIXTEENTHS_PER_BEAT = 4

export interface Token {
  kind: 'note' | 'rest'
  /** Length in sixteenths: one of 16, 12, 8, 6, 4, 3, 2, 1. */
  sixteenths: number
  pitch?: number
  noteId?: string
  /** True for every piece of a note except the last (tied into the next). */
  tieToNext?: boolean
  /** True for the pieces after the first: same note, no new fingering. */
  continuation?: boolean
  ornament?: Ornament
  /** Beat position of this token from the start of the piece. */
  start: number
}

export interface Measure {
  index: number
  tokens: Token[]
  /** Set when this measure stands for several empty ones (a multi-bar rest). */
  restMeasures?: number
}

const VALUES = [16, 12, 8, 6, 4, 3, 2, 1]

const DOTTED = [12, 6, 3]

/**
 * Split a span (in sixteenths from the bar line) into notatable values,
 * largest first, so that off-beat values are broken up the way they are
 * usually written: a quarter on the "and" becomes tied eighths, dotted notes
 * start on a beat, and rests are never dotted and sit on their own grid.
 */
export function splitSpan(offset: number, length: number, rest = false): number[] {
  const parts: number[] = []
  let pos = offset
  let left = length
  while (left > 0) {
    const value = VALUES.find((v) => v <= left && fits(pos, v, rest)) ?? 1
    parts.push(value)
    pos += value
    left -= value
  }
  return parts
}

function fits(pos: number, value: number, rest: boolean): boolean {
  if (DOTTED.includes(value)) return !rest && pos % 4 === 0
  return pos % Math.min(value, rest ? 8 : 4) === 0
}

export function toMeasures(notes: ScoreNote[], beatsPerMeasure: number): Measure[] {
  const perMeasure = beatsPerMeasure * SIXTEENTHS_PER_BEAT
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const endSixteenths = sorted.reduce(
    (m, n) => Math.max(m, Math.round((n.start + n.duration) * SIXTEENTHS_PER_BEAT)),
    0,
  )
  const count = Math.max(1, Math.ceil(endSixteenths / perMeasure))
  const measures: Measure[] = Array.from({ length: count }, (_, index) => ({ index, tokens: [] }))

  const push = (
    from: number,
    to: number,
    isRest: boolean,
    make: (len: number, first: boolean, last: boolean) => Token,
  ) => {
    let pos = from
    let first = true
    while (pos < to) {
      const m = Math.floor(pos / perMeasure)
      const measureEnd = (m + 1) * perMeasure
      const segEnd = Math.min(to, measureEnd)
      const parts = splitSpan(pos - m * perMeasure, segEnd - pos, isRest)
      for (const len of parts) {
        const last = pos + len >= to
        measures[m].tokens.push({ ...make(len, first, last), start: pos / SIXTEENTHS_PER_BEAT })
        first = false
        pos += len
      }
    }
  }

  const rest = (len: number): Token => ({ kind: 'rest', sixteenths: len, start: 0 })
  let cursor = 0
  for (const n of sorted) {
    const s = Math.round(n.start * SIXTEENTHS_PER_BEAT)
    const e = Math.round((n.start + n.duration) * SIXTEENTHS_PER_BEAT)
    if (e <= s || s < cursor) continue
    if (s > cursor) push(cursor, s, true, rest)
    push(s, e, false, (len, first, last) => ({
      kind: 'note',
      sixteenths: len,
      pitch: n.pitch,
      noteId: n.id,
      tieToNext: !last,
      continuation: !first,
      ornament: first ? n.ornament : undefined,
      start: 0,
    }))
    cursor = e
  }
  if (cursor < count * perMeasure) push(cursor, count * perMeasure, true, rest)
  return compactRests(measures)
}

const isEmpty = (m: Measure) => m.tokens.every((t) => t.kind === 'rest')

/**
 * Drop the empty measures before the first note (e.g. an unscored intro) and
 * show longer runs of empty measures as one multi-bar rest.
 */
function compactRests(measures: Measure[]): Measure[] {
  const first = measures.findIndex((m) => !isEmpty(m))
  if (first < 0) return measures.slice(0, 1)
  const out: Measure[] = []
  for (let i = first; i < measures.length; ) {
    let j = i
    while (j < measures.length && isEmpty(measures[j])) j++
    if (j - i >= 2) {
      out.push({ ...measures[i], restMeasures: j - i })
      i = j
    } else {
      out.push(measures[i])
      i += 1
    }
  }
  return out
}
