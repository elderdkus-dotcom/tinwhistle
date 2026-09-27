import type { Ornament, ScoreNote } from '../types'
import { noteName, technique } from '../whistle'
import { FingeringIcon } from './FingeringIcon'

interface Props {
  note: ScoreNote
  onPitch: (amount: number, chromatic: boolean) => void
  onDuration: (steps: number) => void
  onInsert: () => void
  onDelete: () => void
  onOrnament: (o: Ornament) => void
  onPlayFrom: () => void
  /** Play the original song from where this note was heard. */
  onPlaySongFrom?: () => void
  onNavigate: (dir: 1 | -1) => void
  onClose: () => void
}

const LENGTH_NAMES: Record<number, string> = {
  0.25: 'sixteenth', 0.5: 'eighth', 0.75: 'dotted eighth', 1: 'quarter',
  1.5: 'dotted quarter', 2: 'half', 3: 'dotted half', 4: 'whole',
}

const TECHNIQUE_HINT = {
  plain: '',
  cross: 'cross-fingered',
  'half-hole': 'half-hole the marked hole',
}

export function EditorBar({ note, onPitch, onDuration, onInsert, onDelete, onOrnament, onPlayFrom, onPlaySongFrom, onNavigate, onClose }: Props) {
  const hint = TECHNIQUE_HINT[technique(note.pitch)]
  return (
    <div className="editor-bar" role="toolbar" aria-label="Edit note">
      <div className="editor-info">
        <button className="icon" onClick={() => onNavigate(-1)} aria-label="Previous note" title="Previous note (←)">‹</button>
        <div>
          <strong>{noteName(note.pitch)}</strong> <FingeringIcon pitch={note.pitch} />
          <small>
            {LENGTH_NAMES[note.duration] ?? `${note.duration} beats`}
            {hint && ` · ${hint}`}
          </small>
        </div>
        <button className="icon" onClick={() => onNavigate(1)} aria-label="Next note" title="Next note (→)">›</button>
        <button className="icon close" onClick={onClose} aria-label="Close editor" title="Close (Esc)">×</button>
      </div>
      <div className="editor-actions">
        <div className="group">
          <button onClick={() => onPitch(1, false)} title="Up a scale step (↑)">↑ Up</button>
          <button onClick={() => onPitch(-1, false)} title="Down a scale step (↓)">↓ Down</button>
          <button onClick={() => onPitch(1, true)} title="Up a semitone (Shift+↑)">♯</button>
          <button onClick={() => onPitch(-1, true)} title="Down a semitone (Shift+↓)">♭</button>
        </div>
        <div className="group">
          <button onClick={() => onDuration(-1)} title="Shorter (-)">Shorter</button>
          <button onClick={() => onDuration(1)} title="Longer (+)">Longer</button>
        </div>
        <div className="group">
          <button onClick={onInsert} title="Insert a note after this one (I)">Insert</button>
          <button onClick={onDelete} title="Delete (Del)">Delete</button>
        </div>
        <div className="group">
          <button aria-pressed={note.ornament === 'cut'} onClick={() => onOrnament('cut')} title="Cut: a quick grace note above">Cut</button>
          <button aria-pressed={note.ornament === 'roll'} onClick={() => onOrnament('roll')} title="Roll: note, cut, note, tap, note">Roll</button>
          <button onClick={onPlayFrom} title="Play the whistle score from this note">▶ Whistle here</button>
          {onPlaySongFrom && (
            <button onClick={onPlaySongFrom} title="Play the original song from this note">
              ▶ Song here
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
