/**
 * Draws the score: a treble staff (VexFlow) with a tin whistle fingering chart
 * under every note, plus invisible tap targets for selecting notes.
 */

import {
  Accidental,
  Beam,
  Dot,
  Formatter,
  GraceNote,
  GraceNoteGroup,
  Ornament,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
} from 'vexflow/bravura'
import { keySignature } from './arrange'
import { toMeasures, type Measure, type Token } from './notation'
import type { Arrangement } from './types'
import { fingering, noteName, register, scientificName, stepScale } from './whistle'

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface RenderOptions {
  width: number
  showNames: boolean
  title?: string
}

export interface NoteShapes {
  /** Highlight rectangles, one per notated piece of the note (ties). */
  highlights: SVGRectElement[]
}

// Layout constants (px).
const MARGIN_X = 8
const STAVE_TOP = 38 // room above the staff for high notes and ornaments
const STAVE_HEIGHT = 40
const FINGERING_TOP = STAVE_TOP + STAVE_HEIGHT + 42
const HOLE_R = 4.6
const HOLE_GAP = 11.5
const HAND_GAP = 6
const ROW_HEIGHT = FINGERING_TOP + 6 * HOLE_GAP + HAND_GAP + 36
const CLEF_WIDTH = 62
const TIME_WIDTH = 26
/** Rows may be squeezed to this fraction of their natural width to fit more measures. */
const MIN_SQUEEZE = 0.78

const DURATION_CODE: Record<number, string> = {
  16: 'w', 12: 'h', 8: 'h', 6: 'q', 4: 'q', 3: '8', 2: '8', 1: '16',
}
const DOTTED = [12, 6, 3]

/** Narrow screens (phones) use tighter spacing so two measures fit a row. */
const COMPACT_BELOW = 560
let compact = false

function tokenWidth(t: Token): number {
  // Every note needs room for its fingering chart; long notes get more.
  const base = t.kind === 'note' ? (compact ? 23 : 30) : compact ? 16 : 22
  return base + Math.log2(t.sixteenths) * (compact ? 5 : 7)
}

function measureWidth(m: Measure): number {
  return Math.max(compact ? 56 : 70, m.tokens.reduce((w, t) => w + tokenWidth(t), compact ? 18 : 24))
}

/** Break measures into rows that fit the width. */
function layoutRows(measures: Measure[], width: number) {
  const rows: { measures: Measure[]; widths: number[] }[] = []
  let current: Measure[] = []
  let used = 0
  const avail = width - 2 * MARGIN_X
  const prefix = (rowIndex: number) => CLEF_WIDTH + (rowIndex === 0 ? TIME_WIDTH : 0)
  for (const m of measures) {
    const w = measureWidth(m)
    const extra = current.length === 0 ? prefix(rows.length) : 0
    if (current.length > 0 && (used + w) * MIN_SQUEEZE > avail) {
      rows.push({ measures: current, widths: [] })
      current = []
      used = prefix(rows.length)
    } else {
      used += extra
    }
    current.push(m)
    used += w
  }
  if (current.length) rows.push({ measures: current, widths: [] })

  // Stretch each full row to the width; leave a short last row natural.
  rows.forEach((row, r) => {
    const natural = row.measures.map(measureWidth)
    natural[0] += prefix(r)
    const total = natural.reduce((a, b) => a + b, 0)
    const isLast = r === rows.length - 1
    const scale = isLast && total < avail * 0.7 ? 1 : avail / total
    row.widths = natural.map((w) => w * scale)
  })
  return rows
}

function vexKey(pitch: number): string {
  const { letter, accidental, octave } = scientificName(pitch)
  return `${letter}${accidental}/${octave}`
}

function makeNote(t: Token, clef: string): StaveNote {
  const code = DURATION_CODE[t.sixteenths]
  const dotted = DOTTED.includes(t.sixteenths)
  const note =
    t.kind === 'rest'
      ? new StaveNote({ keys: [t.sixteenths === 16 ? 'd/5' : 'b/4'], duration: `${code}r`, clef })
      : new StaveNote({ keys: [vexKey(t.pitch!)], duration: code, clef, auto_stem: true })
  if (dotted) Dot.buildAndAttach([note], { all: true })
  if (t.kind === 'note' && t.ornament === 'roll') {
    note.addModifier(new Ornament('turn'), 0)
  }
  if (t.kind === 'note' && t.ornament === 'cut') {
    const grace = new GraceNote({ keys: [vexKey(stepScale(t.pitch!, 2))], duration: '8', slash: true })
    note.addModifier(new GraceNoteGroup([grace], false), 0)
  }
  return note
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent.appendChild(node)
  return node
}

function drawFingering(g: SVGGElement, cx: number, top: number, pitch: number, showName: boolean) {
  const holes = fingering(pitch)
  holes.forEach((hole, i) => {
    const cy = top + i * HOLE_GAP + (i >= 3 ? HAND_GAP : 0)
    if (hole === 0.5) {
      el('circle', { cx, cy, r: HOLE_R, class: 'hole open' }, g)
      // Left half filled: the lower half of the hole is covered.
      el('path', { d: `M ${cx} ${cy - HOLE_R} A ${HOLE_R} ${HOLE_R} 0 0 0 ${cx} ${cy + HOLE_R} Z`, class: 'hole-fill' }, g)
    } else {
      el('circle', { cx, cy, r: HOLE_R, class: hole ? 'hole closed' : 'hole open' }, g)
    }
  })
  let y = top + 5 * HOLE_GAP + HAND_GAP + HOLE_R + 14
  if (register(pitch) === 2) {
    el('text', { x: cx, y, class: 'octave-mark', 'text-anchor': 'middle' }, g).textContent = '+'
    y += 13
  } else {
    y += 2
  }
  if (showName) {
    el('text', { x: cx, y, class: 'note-name', 'text-anchor': 'middle' }, g).textContent = noteName(pitch)
  }
}

export function renderScore(
  container: HTMLElement,
  arrangement: Arrangement,
  options: RenderOptions,
): Map<string, NoteShapes> {
  container.innerHTML = ''
  compact = options.width < COMPACT_BELOW
  const shapes = new Map<string, NoteShapes>()
  const measures = toMeasures(arrangement.notes, arrangement.beatsPerMeasure)
  const rows = layoutRows(measures, options.width)
  const height = rows.length * ROW_HEIGHT + 10

  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG)
  renderer.resize(options.width, height)
  const ctx = renderer.getContext()
  const svg = container.querySelector('svg')!
  svg.setAttribute('class', 'score-svg')
  svg.setAttribute('viewBox', `0 0 ${options.width} ${height}`)

  // Highlights go underneath the notation; charts and tap targets on top.
  const under = el('g', { class: 'highlights' }, svg)
  const key = keySignature(arrangement.notes)
  const clef = 'treble'
  let prevLastNote: { note: StaveNote; tie: boolean } | null = null
  const overlays: (() => void)[] = []

  rows.forEach((row, r) => {
    let x = MARGIN_X
    const y = r * ROW_HEIGHT + STAVE_TOP - 30
    row.measures.forEach((m, i) => {
      const stave = new Stave(x, y, row.widths[i])
      if (i === 0) {
        stave.addClef(clef).addKeySignature(key)
        if (r === 0) stave.addTimeSignature(`${arrangement.beatsPerMeasure}/4`)
      }
      if (r === rows.length - 1 && i === row.measures.length - 1) stave.setEndBarType(3) // final bar
      stave.setContext(ctx).draw()
      if (m.restMeasures) {
        // A multi-bar rest: one whole rest with the number of bars above it.
        const label = `${m.restMeasures} bars rest`
        el('text', {
          x: (stave.getNoteStartX() + stave.getNoteEndX()) / 2,
          y: stave.getYForLine(0) - 10,
          class: 'multirest',
          'text-anchor': 'middle',
        }, svg).textContent = label
      }

      const notes = m.tokens.map((t) => makeNote(t, clef))
      const voice = new Voice({ num_beats: arrangement.beatsPerMeasure, beat_value: 4 })
      voice.setMode(Voice.Mode.SOFT)
      voice.addTickables(notes)
      Accidental.applyAccidentals([voice], key)
      const beams = Beam.generateBeams(notes)
      const formatWidth = stave.getNoteEndX() - stave.getNoteStartX() - 12
      new Formatter().joinVoices([voice]).format([voice], Math.max(formatWidth, 20))
      voice.draw(ctx, stave)
      beams.forEach((b) => b.setContext(ctx).draw())

      m.tokens.forEach((t, k) => {
        const note = notes[k]
        // Ties within and across measures (and rows).
        if (prevLastNote?.tie && t.kind === 'note' && t.continuation) {
          new StaveTie({ first_note: prevLastNote.note, last_note: note, first_indices: [0], last_indices: [0] })
            .setContext(ctx)
            .draw()
        }
        prevLastNote = t.kind === 'note' ? { note, tie: !!t.tieToNext } : null
        if (t.kind !== 'note') return
        const cx = (note.getNoteHeadBeginX() + note.getNoteHeadEndX()) / 2
        const top = r * ROW_HEIGHT + FINGERING_TOP
        const colW = Math.max(18, tokenWidth(t) - 6)
        const id = t.noteId!
        const hl = el('rect', {
          x: cx - colW / 2, y: r * ROW_HEIGHT + 4, width: colW, height: ROW_HEIGHT - 10, rx: 6,
          class: 'note-highlight', 'data-note-id': id,
        }, under)
        const entry = shapes.get(id) ?? { highlights: [] }
        entry.highlights.push(hl)
        shapes.set(id, entry)
        overlays.push(() => {
          const g = el('g', { class: 'fingering', 'data-note-id': id }, svg)
          if (!t.continuation) drawFingering(g, cx, top, t.pitch!, options.showNames)
          el('rect', {
            x: cx - colW / 2, y: r * ROW_HEIGHT + 4, width: colW, height: ROW_HEIGHT - 10,
            class: 'tap-target', 'data-note-id': id,
          }, g)
        })
      })
      x += row.widths[i]
    })
  })
  overlays.forEach((draw) => draw())
  return shapes
}
