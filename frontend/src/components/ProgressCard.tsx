import type { JobStatus, JobStep } from '../api'

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function amount(step: JobStep): string {
  if (step.done === null || step.total === null) return ''
  if (step.unit === 'MB') return step.total > 0 ? `${step.done.toFixed(1)} / ${step.total.toFixed(1)} MB` : `${step.done.toFixed(1)} MB`
  return `${Math.floor(step.done)} / ${Math.round(step.total)} s`
}

/** What the active step is doing, e.g. "73 / 140 s of the song". */
function activeDetail(step: JobStep): string {
  if (step.done === null) return step.key === 'separate' ? 'Starting up (loading the separation model)…' : 'Starting…'
  if (step.unit === 's') return `${amount(step)} of the song`
  return amount(step)
}

/** Remaining time from the overall rate so far; only once it is meaningful. */
function remaining(job: JobStatus): string {
  if (job.progress < 0.08 || job.elapsed < 8) return ''
  const left = (job.elapsed * (1 - job.progress)) / job.progress
  return left < 10 ? 'almost done' : `about ${clock(left)} left`
}

export function ProgressCard({ job, onCancel }: { job: JobStatus; onCancel: () => void }) {
  const eta = remaining(job)
  return (
    <div className="card progress-card" aria-live="polite">
      <h2>Listening to your song…</h2>
      {job.queuePosition > 0 ? (
        <p>
          Waiting for {job.queuePosition === 1 ? 'another song' : `${job.queuePosition} other songs`} to finish first.
        </p>
      ) : (
        <>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <p className="progress-meta">
            <span>{Math.round(job.progress * 100)}%</span>
            <span>
              {clock(job.elapsed)} elapsed{eta && ` · ${eta}`}
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
