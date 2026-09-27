import type { JobStatus } from '../api'
import type { Part, Song } from '../types'
import type { SongPlayer } from '../useSongPlayer'
import { PartProgress, clock } from './ProgressCard'

/** Longest part the server scores at once (backend/app/songs.py). */
export const MAX_PART_SECONDS = 150
const MIN_PART_SECONDS = 1

interface Props {
  song: Song
  player: SongPlayer
  parts: Part[]
  scoredUntil: number
  draft: Part | undefined
  partJob: JobStatus | null
  isolate: boolean
  separationAvailable: boolean | null
  whistleAlong: boolean
  onIsolate: (on: boolean) => void
  onWhistleAlong: (on: boolean) => void
  onScore: (start: number, end: number) => void
  onSkip: (start: number, end: number) => void
  onCancelJob: () => void
  onKeep: () => void
  onDiscard: () => void
  onUndoLast: () => void
  onPlayDraftWhistle: () => void
  onPlaySong: (from?: number, until?: number) => void
}

function partClass(p: Part): string {
  if (p.kind === 'skipped') return 'seg skipped'
  return p.status === 'draft' ? 'seg draft' : 'seg kept'
}

export function SongBar(props: Props) {
  const { song, player, parts, scoredUntil, draft, partJob } = props
  const duration = player.duration || song.duration
  const busy = partJob !== null && (partJob.status === 'queued' || partJob.status === 'running')
  const t = player.time
  const newLength = t - scoredUntil
  const canScore = !busy && !draft && newLength >= MIN_PART_SECONDS && newLength <= MAX_PART_SECONDS
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / duration) * 100))}%`
  const inScored = parts.some((p) => p.kind === 'scored' && t >= p.start && t < p.end)
  const lastPart = parts[parts.length - 1]
  const finished = scoredUntil >= duration - 0.5

  return (
    <section className="song-bar" aria-label="Song">
      <div className="transport">
        {player.playing ? (
          <button className="primary round" onClick={player.pause} aria-label="Pause">
            ❚❚
          </button>
        ) : (
          <button className="primary round" onClick={() => props.onPlaySong()} aria-label="Play the song">
            ▶
          </button>
        )}
        <button onClick={() => player.seek(t - 5)} title="Back 5 seconds" aria-label="Back 5 seconds">
          −5s
        </button>
        <span className="time">
          {clock(t)} / {clock(duration)}
        </span>
        <div className="timeline">
          <div className="track" aria-hidden="true">
            {parts.map((p) => (
              <div key={p.id} className={partClass(p)} style={{ left: pct(p.start), width: pct(p.end - p.start) }} />
            ))}
            {!draft && t > scoredUntil && <div className="seg pending" style={{ left: pct(scoredUntil), width: pct(t - scoredUntil) }} />}
            <div className="marker" style={{ left: pct(scoredUntil) }} title="Scored up to here" />
            <div className="playhead" style={{ left: pct(t) }} />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(t, duration || 1)}
            aria-label="Position in the song"
            onChange={(e) => player.seek(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="song-status">
        {busy && partJob ? (
          <PartProgress job={partJob} onCancel={props.onCancelJob} />
        ) : draft ? (
          <div className="review">
            <p>
              <strong>
                New part {clock(draft.start)}–{clock(draft.end)}
              </strong>{' '}
              is tinted blue in the score. Listen and compare, then keep it or discard it.
            </p>
            {draft.warnings.map((w) => (
              <p key={w} className="warning">
                {w}
              </p>
            ))}
            <div className="group">
              <button onClick={() => props.onPlaySong(draft.start, draft.end)}>▶ Song</button>
              <button onClick={props.onPlayDraftWhistle}>▶ Whistle</button>
              <button className="primary" onClick={props.onKeep}>
                ✓ Keep it
              </button>
              <button onClick={props.onDiscard}>✗ Discard</button>
            </div>
          </div>
        ) : (
          <div className="next">
            {finished ? (
              <p>
                <strong>The whole song is scored.</strong>
              </p>
            ) : canScore ? (
              <div className="group">
                <button className="primary" onClick={() => props.onScore(scoredUntil, t)}>
                  Score {clock(scoredUntil)} → {clock(t)}
                </button>
                <button onClick={() => props.onSkip(scoredUntil, t)} title="Mark this stretch as having no melody to score (e.g. an intro)">
                  Skip {clock(scoredUntil)} → {clock(t)}
                </button>
              </div>
            ) : newLength > MAX_PART_SECONDS ? (
              <p className="warning">
                That is more than {clock(MAX_PART_SECONDS)} past the scored part. Go back a little, or score it in smaller parts.
                <button className="link" onClick={() => player.seek(scoredUntil)}>
                  Go to {clock(scoredUntil)}
                </button>
              </p>
            ) : (
              <p className="muted">
                {parts.length === 0 ? 'Play the song and pause where the first part should end.' : `Play on from ${clock(scoredUntil)} and pause where the next part should end.`}
                {player.playing && t >= scoredUntil && !inScored && ' (Not scored yet.)'}
              </p>
            )}
            <div className="group options-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={props.isolate && props.separationAvailable !== false}
                  disabled={props.separationAvailable === false}
                  onChange={(e) => props.onIsolate(e.target.checked)}
                />
                <span>Isolate the singer{props.separationAvailable === false ? ' (not installed)' : ''}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={props.whistleAlong} onChange={(e) => props.onWhistleAlong(e.target.checked)} />
                <span>Whistle along with the song</span>
              </label>
              {lastPart && (
                <button className="link" onClick={props.onUndoLast}>
                  Undo last part
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
