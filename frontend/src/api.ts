/** Client for the analysis backend. */

import type { Melody } from './types'

/** Empty means same origin; set VITE_API_BASE when the app is served elsewhere (e.g. a phone app). */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

export interface JobStep {
  key: string
  label: string
  state: 'pending' | 'active' | 'done'
  /** Amount processed so far, e.g. seconds of the song (null until known). */
  done: number | null
  total: number | null
  unit: 's' | 'MB' | ''
}

export interface JobStatus {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  stage: string
  progress: number
  error: string
  result: Melody | null
  steps: JobStep[]
  /** Seconds since the analysis started. */
  elapsed: number
  /** Estimated seconds left, or null while it cannot be estimated yet. */
  remaining: number | null
  /** Jobs ahead of this one; 0 once it is running. */
  queuePosition: number
}

export interface JobRequest {
  file?: File
  url?: string
  start?: number
  duration?: number
  separate: boolean
  beatsPerMeasure: number
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Server error (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      // not JSON
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export async function health(): Promise<{ ok: boolean; separation: boolean }> {
  return json(await fetch(`${API_BASE}/api/health`))
}

export async function submitJob(req: JobRequest): Promise<JobStatus> {
  const form = new FormData()
  if (req.file) form.append('file', req.file)
  if (req.url) form.append('url', req.url)
  form.append('start', String(req.start ?? 0))
  form.append('duration', String(req.duration ?? 0))
  form.append('separate', String(req.separate))
  form.append('beats_per_measure', String(req.beatsPerMeasure))
  return json(await fetch(`${API_BASE}/api/jobs`, { method: 'POST', body: form }))
}

export async function getJob(id: string): Promise<JobStatus> {
  return json(await fetch(`${API_BASE}/api/jobs/${id}`))
}

export async function cancelJob(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/jobs/${id}`, { method: 'DELETE' })
}

export function audioUrl(id: string): string {
  return `${API_BASE}/api/jobs/${id}/audio`
}

/** Poll a job until it finishes, reporting progress along the way. */
export async function waitForJob(
  id: string,
  onProgress: (s: JobStatus) => void,
  signal?: AbortSignal,
): Promise<JobStatus> {
  for (;;) {
    if (signal?.aborted) throw new Error('Cancelled')
    const status = await getJob(id)
    onProgress(status)
    if (status.status === 'done' || status.status === 'error' || status.status === 'cancelled') return status
    await new Promise((r) => setTimeout(r, 1000))
  }
}
