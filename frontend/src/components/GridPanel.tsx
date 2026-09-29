import { useRef, useState } from 'react'
import { doubleTempo, halveTempo, shiftBars, steadyGrid } from '../grid'
import type { Song } from '../types'
import { clock } from './ProgressCard'

interface Props {
  song: Song
  /** Where the song is now (seconds). */
  time: number
  onChange: (grid: Pick<Song, 'beats' | 'origin' | 'tempo'>) => void
}

/** Put the bar lines right when the beat the app found is off. */
export function GridPanel({ song, time, onChange }: Props) {
  const [bpm, setBpm] = useState(Math.round(song.tempo))
  const taps = useRef<number[]>([])

  const tap = () => {
    const now = performance.now() / 1000
    const recent = [...taps.current.filter((t) => now - t < 3), now]
    taps.current = recent
    if (recent.length >= 3) {
      const gaps = recent.slice(1).map((t, i) => t - recent[i]).sort((a, b) => a - b)
      setBpm(Math.round(60 / gaps[Math.floor(gaps.length / 2)]))
    }
  }

  return (
    <details className="grid-panel">
      <summary>Bar lines in the wrong place? (beat ♩ = {Math.round(song.tempo)})</summary>
      <p className="muted">
        Turn on <em>Click the beat</em> and play the song: each click should land on a beat, the higher click on the
        first beat of each bar. Notes keep their place in the score when you change this.
      </p>
      <div className="group">
        <button onClick={() => onChange(halveTempo(song))} title="The clicks come twice as fast as the beat">
          Half as fast
        </button>
        <button onClick={() => onChange(doubleTempo(song))} title="The clicks come half as fast as the beat">
          Twice as fast
        </button>
        <button onClick={() => onChange(shiftBars(song, -1))}>Bars a beat earlier</button>
        <button onClick={() => onChange(shiftBars(song, 1))}>Bars a beat later</button>
      </div>
      <div className="group steady">
        <span className="label">Or set a steady beat:</span>
        <label className="field-inline">
          <span>♩ =</span>
          <input
            type="number"
            min={30}
            max={260}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            aria-label="Beats per minute"
          />
        </label>
        <button onClick={tap} title="Tap along with the song a few times to measure its tempo">
          Tap tempo
        </button>
        <button
          disabled={!(bpm >= 30 && bpm <= 260)}
          onClick={() => onChange(steadyGrid(song.duration, time, bpm, song.beatsPerMeasure))}
          title="Pause the song right on the first beat of a bar, then press this"
        >
          A bar starts here ({clock(time)})
        </button>
      </div>
    </details>
  )
}
