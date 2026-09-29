import type { Ornament, ScoreNote } from '../types'
import { noteName, register } from '../whistle'
import { FingeringIcon } from './FingeringIcon'

/** The whistle's notes, bottom D to top C#, as written. */
export const PAD_PITCHES = [62, 64, 66, 67, 69, 71, 72, 73, 74, 76, 78, 79, 81, 83, 85]

export const LENGTHS: { beats: number; label: string; key: string; name: string }[] = [
  { beats: 0.25, label: '𝅘𝅥𝅯', key: '1', name: 'Sixteenth' },
  { beats: 0.5, label: '♪', key: '2', name: 'Eighth' },
  { beats: 1, label: '♩', key: '3', name: 'Quarter' },
  { beats: 2, label: '𝅗𝅥', key: '4', name: 'Half' },
  { beats: 4, label: '𝅝', key: '5', name: 'Whole' },
]

const isDotted = (beats: number) => LENGTHS.some((l) => Math.abs(l.beats * 1.5 - beats) < 1e-9)

export function lengthName(beats: number): string {
  const base = LENGTHS.find((l) => Math.abs(l.beats - beats) < 1e-9 || Math.abs(l.beats * 1.5 - beats) < 1e-9)
  if (!base) return `${beats} beats`
  return `${isDotted(beats) ? 'Dotted ' + base.name.toLowerCase() : base.name} (${beats} beat${beats === 1 ? '' : 's'})`
}

interface Props {
  /** The selected note, or a selected rest (start and length), or nothing. */
  note: ScoreNote | null
  rest: { start: number; end: number } | null
  /** Length new notes get. */
  step: number
  canListen: boolean
  onPitch: (pitch: number) => void
  onLength: (beats: number) => void
  onDotted: () => void
  onRest: () => void
  onNavigate: (dir: 1 | -1) => void
  onOrnament: (o: Ornament) => void
  onListen: () => void
  onClose: () => void
}

export function NotePad({ note, rest, step, canListen, onPitch, onLength, onDotted, onRest, onNavigate, onOrnament, onListen, onClose }: Props) {
  const current = note ? note.duration : step
  const undotted = isDotted(current) ? current / 1.5 : current
  const title = note
    ? `${noteName(note.pitch)}${register(note.pitch) === 2 ? ' (high)' : ''} · ${lengthName(note.duration)}`
    : rest
      ? `Rest · ${lengthName(rest.end - rest.start)}`
      : 'Nothing selected'
  const hint = note
    ? '↑ ↓ change the note · ← → move · 1–5 length'
    : rest
      ? 'Pick a fingering (or press ↑ ↓) to put a note here'
      : 'Tap a note in the score, or press → to start'

  return (
    <section className="note-pad" aria-label="Note entry">
      <div className="pad-head">
        <button onClick={() => onNavigate(-1)} aria-label="Previous note" title="Previous (←)">
          ←
        </button>
        <div className="pad-title">
          <strong>{title}</strong>
          <small>{hint}</small>
        </div>
        <button onClick={() => onNavigate(1)} aria-label="Next note" title="Next, or add a note at the end (→)">
          →
        </button>
        {(note || rest) && (
          <button className="icon" onClick={onClose} aria-label="Deselect" title="Deselect (Esc)">
            ×
          </button>
        )}
      </div>

      <div className="pad-pitches" role="group" aria-label="Whistle notes">
        {PAD_PITCHES.map((p) => (
          <button
            key={p}
            aria-pressed={note?.pitch === p}
            onClick={() => onPitch(p)}
            title={`${noteName(p)}${register(p) === 2 ? ', second octave (blow harder)' : ''}`}
          >
            <span>
              {noteName(p)}
              {register(p) === 2 && <sup>+</sup>}
            </span>
            <FingeringIcon pitch={p} />
          </button>
        ))}
      </div>

      <div className="pad-row">
        <div className="group" role="group" aria-label="Note length">
          {LENGTHS.map((l) => (
            <button
              key={l.beats}
              className="len"
              aria-pressed={Math.abs(undotted - l.beats) < 1e-9}
              onClick={() => onLength(isDotted(current) ? l.beats * 1.5 : l.beats)}
              title={`${l.name} (${l.key})`}
            >
              {l.label}
            </button>
          ))}
          <button aria-pressed={isDotted(current)} onClick={onDotted} title="Dotted: half as long again (.)">
            •
          </button>
        </div>
        <div className="group">
          <button onClick={onRest} disabled={!note} title="Make it a rest (Delete)">
            Rest
          </button>
          <button onClick={() => onOrnament('cut')} disabled={!note} aria-pressed={note?.ornament === 'cut'} title="Cut: a quick grace note above">
            Cut
          </button>
          <button onClick={() => onOrnament('roll')} disabled={!note} aria-pressed={note?.ornament === 'roll'} title="Roll: note, cut, note, tap, note">
            Roll
          </button>
          <button onClick={onListen} disabled={!canListen || (!note && !rest)} title="Hear this bit of the song (Enter)">
            🔊 Hear it
          </button>
        </div>
      </div>
    </section>
  )
}
