import { describe, expect, it } from 'vitest'
import { addNoteAt, changeDuration, gapAt, pitchFromLetter, placeNote, setLength, step, deleteNote, insertAfter, joinWithNext, movePitch, neighbour, toggleOrnament, transposeAll } from './editor'
import type { ScoreNote } from './types'

const notes: ScoreNote[] = [
  { id: 'a', pitch: 62, start: 0, duration: 1 },
  { id: 'b', pitch: 71, start: 1, duration: 1 },
  { id: 'c', pitch: 74, start: 2, duration: 2 },
]

describe('editor', () => {
  it('moves along the scale or by semitone', () => {
    expect(movePitch(notes, 'b', 1, false)[1].pitch).toBe(72) // B -> C natural
    expect(movePitch(notes, 'b', 1, true)[1].pitch).toBe(72)
    expect(movePitch(notes, 'a', -1, false)[0].pitch).toBe(62) // clamped at low D
  })

  it('changes duration and shifts what follows', () => {
    const longer = changeDuration(notes, 'a', 1)
    expect(longer.map((n) => [n.start, n.duration])).toEqual([[0, 1.5], [1.5, 1], [2.5, 2]])
    const shorter = changeDuration(notes, 'b', -1)
    expect(shorter.map((n) => [n.start, n.duration])).toEqual([[0, 1], [1, 0.75], [1.75, 2]])
  })

  it('inserts, deletes and ornaments', () => {
    const { notes: withNew, id } = insertAfter(notes, 'a')
    expect(withNew.map((n) => n.start)).toEqual([0, 1, 2, 3])
    expect(withNew[1].id).toBe(id)
    expect(deleteNote(notes, 'b').map((n) => n.id)).toEqual(['a', 'c'])
    expect(toggleOrnament(notes, 'c', 'roll')[2].ornament).toBe('roll')
    expect(toggleOrnament(toggleOrnament(notes, 'c', 'roll'), 'c', 'roll')[2].ornament).toBeUndefined()
  })

  it('transposes everything and finds neighbours', () => {
    expect(transposeAll(notes, 2).map((n) => n.pitch)).toEqual([64, 73, 76])
    expect(neighbour(notes, 'b', 1)).toBe('c')
    expect(neighbour(notes, 'a', -1)).toBeUndefined()
  })

  it('joins a split note and adds notes in rests', () => {
    const split: ScoreNote[] = [
      { id: 'a', pitch: 67, start: 0, duration: 0.5 },
      { id: 'b', pitch: 67, start: 0.5, duration: 1 },
      { id: 'c', pitch: 69, start: 2, duration: 1 },
    ]
    expect(joinWithNext(split, 'a').map((n) => [n.id, n.start, n.duration])).toEqual([
      ['a', 0, 1.5],
      ['c', 2, 1],
    ])
    const { notes: added, id } = addNoteAt(split, 1.5, 0.5)
    expect(added.map((n) => n.start)).toEqual([0, 0.5, 1.5, 2])
    expect(added.find((n) => n.id === id)).toMatchObject({ pitch: 67, start: 1.5, duration: 0.5 })
  })

  it('edits in place so later notes stay in time', () => {
    const tune: ScoreNote[] = [
      { id: 'a', pitch: 62, start: 0, duration: 1 },
      { id: 'b', pitch: 64, start: 1, duration: 1 },
      { id: 'c', pitch: 66, start: 2, duration: 1 },
    ]
    // Longer: covers b and cuts nothing else; c stays at beat 2.
    expect(setLength(tune, 'a', 2).map((n) => [n.id, n.start, n.duration])).toEqual([
      ['a', 0, 2],
      ['c', 2, 1],
    ])
    // Shorter: leaves a rest, nothing moves.
    expect(setLength(tune, 'a', 0.5).map((n) => [n.id, n.start, n.duration])).toEqual([
      ['a', 0, 0.5],
      ['b', 1, 1],
      ['c', 2, 1],
    ])
    // A placed note replaces what starts under it (c) and trims a note running into it (b).
    const { notes, id } = placeNote(tune, 1.5, 1, 69)
    expect(notes.map((n) => [n.id === id ? 'new' : n.id, n.start, n.duration])).toEqual([
      ['a', 0, 1],
      ['b', 1, 0.5],
      ['new', 1.5, 1],
    ])
  })

  it('steps through notes and the rests between them', () => {
    const tune: ScoreNote[] = [
      { id: 'a', pitch: 62, start: 0, duration: 1 },
      { id: 'b', pitch: 64, start: 1, duration: 1 },
      { id: 'c', pitch: 66, start: 3, duration: 1 },
    ]
    expect(step(tune, { kind: 'note', id: 'a' }, 1)).toEqual({ kind: 'note', id: 'b' })
    expect(step(tune, { kind: 'note', id: 'b' }, 1)).toEqual({ kind: 'rest', start: 2, end: 3 })
    expect(step(tune, { kind: 'rest', start: 2, end: 3 }, 1)).toEqual({ kind: 'note', id: 'c' })
    expect(step(tune, { kind: 'note', id: 'c' }, 1)).toBeNull()
    expect(step(tune, { kind: 'note', id: 'c' }, -1)).toEqual({ kind: 'rest', start: 2, end: 3 })
    expect(step(tune, { kind: 'rest', start: 2, end: 3 }, -1)).toEqual({ kind: 'note', id: 'b' })
    expect(step(tune, { kind: 'note', id: 'a' }, -1)).toBeNull()
    expect(gapAt(tune, 2.5, 3)).toEqual({ start: 2, end: 3 })
    expect(gapAt(tune, 4, 8)).toEqual({ start: 4, end: 8 })
  })

  it('reads note letters as whistle notes near the last one', () => {
    expect(pitchFromLetter('d', 70)).toBe(74)
    expect(pitchFromLetter('d', 64)).toBe(62)
    expect(pitchFromLetter('f', 62)).toBe(66) // F sharp
    expect(pitchFromLetter('c', 74)).toBe(73) // C sharp
    expect(pitchFromLetter('x', 74)).toBeNull()
  })
})
