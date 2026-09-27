import { fingering, register } from '../whistle'

/** A small horizontal fingering chart for the editor toolbar. */
export function FingeringIcon({ pitch }: { pitch: number }) {
  const holes = fingering(pitch)
  return (
    <svg className="fingering-icon" viewBox="0 0 92 16" aria-hidden="true">
      {holes.map((h, i) => {
        const cx = 8 + i * 13 + (i >= 3 ? 6 : 0)
        return (
          <g key={i}>
            <circle cx={cx} cy={8} r={5} className={h === 1 ? 'hole closed' : 'hole open'} />
            {h === 0.5 && <path d={`M ${cx} 3 A 5 5 0 0 0 ${cx} 13 Z`} className="hole-fill" />}
          </g>
        )
      })}
      {register(pitch) === 2 && (
        <text x={88} y={12} className="octave-mark" textAnchor="middle">
          +
        </text>
      )}
    </svg>
  )
}
