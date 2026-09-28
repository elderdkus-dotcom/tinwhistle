import { describe, expect, it } from 'vitest'
import { addNoteAt, changeDuration, deleteNote, insertAfter, joinWithNext, movePitch, neighbour, toggleOrnament, transposeAll } from './editor'
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
})
