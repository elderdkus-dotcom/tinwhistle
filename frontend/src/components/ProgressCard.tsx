import { useRef } from 'react'
import type { JobStatus, JobStep } from '../api'

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function amount(step: JobStep): string {
  if (step.done === null || step.total === null) return ''
  if (step.unit === 'MB') return step.total > 0 ? `${step.done.toFixed(1)} / ${step.total.toFixed(1)} MB` : `${step.done.toFixed(1)} MB`
  return `${Math.floor(step.done)} / ${Math.round(step.total)} s`
}

/** What the active step is doing, e.g. "73 / 140 s of the song". */
export function activeDetail(step: JobStep): string {
  if (step.done === null) return step.key === 'separate' ? 'Starting up (loading the separation model)…' : 'Starting…'
  if (step.unit === 's') return `${amount(step)} of the song`
  return amount(step)
}

/** The server's time estimate, rounded so it does not jitter. */
export function remaining(job: JobStatus): string {
  if (job.remaining === null) return 'estimating time left…'
  const left = job.remaining
  if (left < 10) return 'almost done'
  if (left < 60) return `about ${Math.ceil(left / 10) * 10} s left`
  return `about ${clock(Math.ceil(left / 15) * 15)} left`
}

export function ProgressCard({ job, onCancel, title = 'Loading your song…' }: { job: JobStatus; onCancel: () => void; title?: string }) {
  const eta = remaining(job)
  // Never let the bar move backwards when the estimate is revised.
  const shown = useRef(0)
  shown.current = Math.max(shown.current, job.progress)
  const percent = Math.round(shown.current * 100)
  return (
    <div className="card progress-card" aria-live="polite">
      <h2>{title}</h2>
      {job.queuePosition > 0 ? (
        <p>
          Waiting for {job.queuePosition === 1 ? 'another song' : `${job.queuePosition} other songs`} to finish first.
        </p>
      ) : (
        <>
          <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${percent}%` }} />
          </div>
          <p className="progress-meta">
            <span>{percent}%</span>
            <span>
              {clock(job.elapsed)} elapsed · {eta}
            </span>
          </p>
          <ol className="steps">
            {job.steps.map((step) => (
              <li key={step.key} className={`step ${step.state}`}>
                <span className="step-icon" aria-hidden="true">
                  {step.state === 'done' ? '✓' : step.state === 'active' ? '●' : '○'}
                </span>
                <div>
                  <span className="step-label">{step.label}</span>
                  {step.state === 'active' && (
                    <>
                      <span className="step-detail">{activeDetail(step)}</span>
                      {step.done !== null && step.total ? (
                        <div className="progress small">
                          <div style={{ width: `${Math.min(100, (step.done / step.total) * 100)}%` }} />
                        </div>
                      ) : null}
                    </>
                  )}
                  {step.state === 'done' && step.unit === 'MB' && <span className="step-detail">{amount(step)}</span>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <button onClick={onCancel}>Cancel</button>
    </div>
  )
}

/** One-line progress for scoring a part, shown inside the song bar. */
export function PartProgress({ job, onCancel }: { job: JobStatus; onCancel: () => void }) {
  const shown = useRef(0)
  shown.current = Math.max(shown.current, job.progress)
  const active = job.steps.find((s) => s.state === 'active')
  return (
    <div className="part-progress" aria-live="polite">
      <div className="part-progress-text">
        <strong>{job.queuePosition > 0 ? 'Waiting for another job…' : active?.label ?? 'Starting…'}</strong>
        {active && <span className="muted"> · {activeDetail(active)}</span>}
        <span className="muted"> · {remaining(job)}</span>
      </div>
      <div className="progress small">
        <div style={{ width: `${Math.round(shown.current * 100)}%` }} />
      </div>
      <button onClick={onCancel}>Cancel</button>
    </div>
  )
}
