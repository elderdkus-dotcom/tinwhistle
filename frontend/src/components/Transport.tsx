import type { SongPlayer } from '../useSongPlayer'
import { clock } from './ProgressCard'

interface Props {
  player: SongPlayer
  /** Bar number the song is in (1 = the first bar of the score). */
  bar: number
  onPlayPause: () => void
  onSeek: (t: number) => void
  whistleAlong: boolean
  onWhistleAlong: (on: boolean) => void
  clicks: boolean
  onClicks: (on: boolean) => void
  tapGrid: number
  onTapGrid: (beats: number) => void
  tapping: boolean
  onTapDown: () => void
  onTapUp: () => void
}

const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1]

export function Transport(props: Props) {
  const { player, bar } = props
  const duration = player.duration || 0
  return (
    <section className="song-bar" aria-label="Song">
      <div className="transport">
        <button className="round" onClick={() => props.onSeek(player.time - 5)} aria-label="Back 5 seconds" title="Back 5 s">
          ↺5
        </button>
        <button
          className="round primary"
          onClick={props.onPlayPause}
          aria-label={player.playing ? 'Pause' : 'Play'}
          title="Play / pause (Space)"
        >
          {player.playing ? '❚❚' : '▶'}
        </button>
        <button className="round" onClick={() => props.onSeek(player.time + 5)} aria-label="Forward 5 seconds" title="Forward 5 s">
          5↻
        </button>
        <div className="timeline">
          <div className="track" />
          <div className="playhead" style={{ left: `${duration ? (100 * player.time) / duration : 0}%` }} />
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={player.time}
            onChange={(e) => props.onSeek(Number(e.target.value))}
            aria-label="Position in the song"
          />
        </div>
        <span className="time">
          {clock(player.time)} / {clock(duration)}
          <br />
          bar {Math.max(1, bar)}
        </span>
      </div>

      <div className="transport-options">
        <label className="field-inline">
          <span>Speed</span>
          <select value={player.rate} onChange={(e) => player.setRate(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={props.whistleAlong} onChange={(e) => props.onWhistleAlong(e.target.checked)} />
          <span>Play my notes along</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={props.clicks} onChange={(e) => props.onClicks(e.target.checked)} />
          <span>Click the beat</span>
        </label>
        <div className="tap">
          <button
            className={`tap-button${props.tapping ? ' down' : ''}`}
            disabled={!player.playing}
            onPointerDown={(e) => {
              e.preventDefault()
              props.onTapDown()
            }}
            onPointerUp={props.onTapUp}
            onPointerLeave={() => props.tapping && props.onTapUp()}
            title="While the song plays, hold this (or the N key) for as long as each note lasts"
          >
            {props.tapping ? 'Holding…' : 'Hold for a note (N)'}
          </button>
          <select value={props.tapGrid} onChange={(e) => props.onTapGrid(Number(e.target.value))} aria-label="Snap tapped notes to">
            <option value={0.25}>snap to 1/16</option>
            <option value={0.5}>snap to 1/8</option>
            <option value={1}>snap to beats</option>
          </select>
        </div>
      </div>
      {player.error && <p className="warning">{player.error}</p>}
    </section>
  )
}
