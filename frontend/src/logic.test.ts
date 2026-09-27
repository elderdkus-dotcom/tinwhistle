import { describe, expect, it } from 'vitest'
import { addOrnaments, appendPart, arrange, chooseTranspose, fitPitch, keySignature, removePart, simplifyRhythm } from './arrange'
import { splitSpan, toMeasures } from './notation'
import type { Melody, ScoreNote } from './types'
import { fingering, noteName, register, stepScale, technique } from './whistle'

const melody = (pitches: number[], dur = 1): Melody => ({
  tempo: 100,
  beatsPerMeasure: 4,
  notes: pitches.map((pitch, i) => ({ pitch, start: i * dur, duration: dur })),
})

describe('whistle', () => {
  it('knows the basic fingerings', () => {
    expect(fingering(62)).toEqual([1, 1, 1, 1, 1, 1])
    expect(fingering(67)).toEqual([1, 1, 1, 0, 0, 0])
    expect(fingering(73)).toEqual([0, 0, 0, 0, 0, 0])
    expect(fingering(79)).toEqual([1, 1, 1, 0, 0, 0])
    expect(register(79)).toBe(2)
    expect(technique(72)).toBe('cross')
    expect(technique(65)).toBe('half-hole')
    expect(noteName(70)).toBe('Bb')
  })

  it('steps along the D major scale', () => {
    expect(stepScale(62, 1)).toBe(64)
    expect(stepScale(71, 1)).toBe(73)
    expect(stepScale(71, 1, true)).toBe(72)
    expect(stepScale(62, -1)).toBe(61)
  })
})

describe('arrange', () => {
  it('transposes a C major tune into D major', () => {
    const cMajor = [60, 62, 64, 65, 67, 69, 71, 72]
    expect(chooseTranspose(melody(cMajor).notes, 'beginner')).toBe(2)
  })

  it('prefers D major over a high key when one low note must be folded', () => {
    const ode = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 55]
    expect(chooseTranspose(melody(ode).notes, 'intermediate')).toBe(2)
  })

  it('keeps a tune that already fits', () => {
    expect(chooseTranspose(melody([62, 66, 69, 74]).notes, 'intermediate')).toBe(0)
  })

  it('moves a high G major tune into the beginner range', () => {
    // G A B D G fits as D E F# A D once moved down a fourth and an octave.
    expect(chooseTranspose(melody([79, 81, 83, 86, 91]).notes, 'beginner')).toBe(-17)
  })

  it('folds and snaps notes a level cannot play', () => {
    expect(fitPitch(90, 'beginner')).toBe(78) // F#6 -> F#5, the top of the range
    expect(fitPitch(72, 'beginner', 71)).toBe(71) // C natural -> B, towards previous
    expect(fitPitch(72, 'intermediate')).toBe(72)
    expect(fitPitch(65, 'expert')).toBe(65)
    expect(fitPitch(50, 'expert')).toBe(62)
  })

  it('simplifies rhythm to the grid and removes short rests', () => {
    const notes: ScoreNote[] = [
      { id: 'a', pitch: 62, start: 0, duration: 0.25 },
      { id: 'b', pitch: 64, start: 0.25, duration: 0.25 },
      { id: 'c', pitch: 66, start: 0.5, duration: 0.5 },
      { id: 'd', pitch: 67, start: 1.5, duration: 1 },
    ]
    expect(simplifyRhythm(notes, 0.5, 1).map((n) => [n.id, n.start, n.duration])).toEqual([
      ['a', 0, 0.5],
      ['c', 0.5, 1],
      ['d', 1.5, 1],
    ])
  })

  it('adds cuts and rolls', () => {
    const notes = addOrnaments([
      { id: 'a', pitch: 67, start: 0, duration: 1 },
      { id: 'b', pitch: 67, start: 1, duration: 1 },
      { id: 'c', pitch: 66, start: 2, duration: 1.5 },
      { id: 'd', pitch: 67, start: 3.5, duration: 1.5 },
      { id: 'e', pitch: 69, start: 5, duration: 2 },
    ])
    expect(notes.map((n) => n.ornament)).toEqual([undefined, 'cut', 'roll', undefined, undefined])
  })

  it('produces different levels', () => {
    const m = melody([60, 61, 63, 65, 67, 68, 70, 84, 86], 0.25)
    const beginner = arrange(m, 'beginner')
    const expert = arrange(m, 'expert')
    expect(beginner.notes.every((n) => n.duration >= 0.5)).toBe(true)
    expect(beginner.notes.every((n) => n.pitch >= 62 && n.pitch <= 78)).toBe(true)
    expect(expert.notes.length).toBe(9)
    expect(beginner.tempo).toBeLessThan(expert.tempo)
  })

  it('appends and removes parts, keeping key and edits', () => {
    const first = arrange(melody([60, 62, 64, 65]), 'intermediate')
    expect(first.transpose).toBe(2)
    const edited = { ...first, notes: first.notes.map((n, i) => (i === 0 ? { ...n, pitch: 74 } : n)) }
    // The new part overlaps the last note, which gets cut short.
    const next = appendPart(edited, 'p2', [
      { pitch: 67, start: 3.5, duration: 1 },
      { pitch: 69, start: 4.5, duration: 1 },
    ])
    expect(next.notes.map((n) => [n.pitch, n.start, n.duration, n.part ?? ''])).toEqual([
      [74, 0, 1, ''],
      [64, 1, 1, ''],
      [66, 2, 1, ''],
      [67, 3, 0.5, ''],
      [69, 3.5, 1, 'p2'],
      [71, 4.5, 1, 'p2'],
    ])
    expect(removePart(next, 'p2').notes).toHaveLength(4)
  })

  it('picks a G major key signature for C natural tunes', () => {
    expect(keySignature([{ id: 'a', pitch: 72, start: 0, duration: 1 }])).toBe('G')
    expect(keySignature([{ id: 'a', pitch: 73, start: 0, duration: 1 }])).toBe('D')
  })
})

describe('notation', () => {
  it('splits spans into readable values', () => {
    expect(splitSpan(0, 16)).toEqual([16])
    expect(splitSpan(0, 6)).toEqual([6])
    expect(splitSpan(2, 4)).toEqual([2, 2])
    expect(splitSpan(4, 8)).toEqual([8])
    expect(splitSpan(0, 5)).toEqual([4, 1])
    expect(splitSpan(4, 12, true)).toEqual([4, 8])
  })

  it('fills rests and ties notes over bar lines', () => {
    const measures = toMeasures(
      [
        { id: 'a', pitch: 62, start: 1, duration: 2 },
        { id: 'b', pitch: 64, start: 3, duration: 2 },
      ],
      4,
    )
    expect(measures).toHaveLength(2)
    const m0 = measures[0].tokens.map((t) => [t.kind, t.sixteenths, t.tieToNext ?? false])
    expect(m0).toEqual([
      ['rest', 4, false],
      ['note', 8, false],
      ['note', 4, true],
    ])
    const m1 = measures[1].tokens
    expect(m1[0]).toMatchObject({ kind: 'note', sixteenths: 4, continuation: true, noteId: 'b' })
    expect(m1.slice(1).map((t) => t.kind)).toEqual(['rest', 'rest'])
  })

  it('skips leading empty bars and collapses long gaps', () => {
    const measures = toMeasures(
      [
        { id: 'a', pitch: 62, start: 16, duration: 4 }, // bar 5 (bars 1-4 empty)
        { id: 'b', pitch: 64, start: 36, duration: 4 }, // bar 10 (bars 6-9 empty)
      ],
      4,
    )
    expect(measures.map((m) => [m.index, m.restMeasures ?? 0])).toEqual([
      [4, 0],
      [5, 4],
      [9, 0],
    ])
  })
})
