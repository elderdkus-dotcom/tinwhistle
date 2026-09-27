/** Client for the analysis backend. */

import type { MelodySource, Song, SourceNote } from './types'

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

/** Result of scoring one part of a song (backend/app/songs.py: analyze_part). */
export interface PartResult {
  start: number
  end: number
  source: MelodySource
  separated: boolean
  warnings: string[]
  notes: SourceNote[]
}

export interface JobStatus<R = unknown> {
  id: string
  kind: 'song' | 'part'
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  stage: string
  progress: number
  error: string
  result: R | null
  steps: JobStep[]
  /** Seconds since the analysis started. */
  elapsed: number
  /** Estimated seconds left, or null while it cannot be estimated yet. */
  remaining: number | null
  /** Jobs ahead of this one; 0 once it is running. */
  queuePosition: number
}

export interface SongRequest {
  file?: File
  url?: string
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

export async function loadSong(req: SongRequest): Promise<JobStatus<{ song: Song }>> {
  const form = new FormData()
  if (req.file) form.append('file', req.file)
  if (req.url) form.append('url', req.url)
  form.append('beats_per_measure', String(req.beatsPerMeasure))
  return json(await fetch(`${API_BASE}/api/songs`, { method: 'POST', body: form }))
}

export async function scorePart(
  songId: string,
  start: number,
  end: number,
  source: MelodySource,
): Promise<JobStatus<PartResult>> {
  return json(
    await fetch(`${API_BASE}/api/songs/${songId}/parts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end, source }),
    }),
  )
}

/** Whether the server still has this song (it keeps only the most recent few). */
export async function songAvailable(songId: string): Promise<boolean> {
  try {
    return (await fetch(`${API_BASE}/api/songs/${songId}`)).ok
  } catch {
    return false
  }
}

export async function getJob<R>(id: string): Promise<JobStatus<R>> {
  return json(await fetch(`${API_BASE}/api/jobs/${id}`))
}

export async function cancelJob(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/jobs/${id}`, { method: 'DELETE' })
}

export function songAudioUrl(songId: string): string {
  return `${API_BASE}/api/songs/${songId}/audio`
}

/** Poll a job until it finishes, reporting progress along the way. */
export async function waitForJob<R>(
  id: string,
  onProgress: (s: JobStatus<R>) => void,
  signal?: AbortSignal,
): Promise<JobStatus<R>> {
  for (;;) {
    if (signal?.aborted) throw new Error('Cancelled')
    const status = await getJob<R>(id)
    onProgress(status)
    if (status.status === 'done' || status.status === 'error' || status.status === 'cancelled') return status
    await new Promise((r) => setTimeout(r, 1000))
  }
}
