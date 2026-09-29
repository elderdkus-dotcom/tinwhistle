/** Plays the original song and reports where it is, for syncing the score. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface SongPlayer {
  time: number
  playing: boolean
  duration: number
  error: string
  /** Play from `from` (default: where it is), optionally stopping at `stopAt`. */
  play: (from?: number, stopAt?: number) => void
  pause: () => void
  seek: (t: number) => void
  /** The exact playing position right now (for tapping in time). */
  now: () => number
  /** Playback speed, 0.5 to 1 (the pitch stays the same). */
  rate: number
  setRate: (rate: number) => void
}

export function useSongPlayer(src: string | null): SongPlayer {
  const audio = useMemo(() => new Audio(), [])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const stopAt = useRef<number | null>(null)

  useEffect(() => {
    audio.preload = 'auto'
    setError('')
    setTime(0)
    if (src) audio.src = src
    else audio.removeAttribute('src')
    return () => audio.pause()
  }, [audio, src])

  useEffect(() => {
    const onPlay = () => setPlaying(true)
    const onPause = () => {
      setPlaying(false)
      setTime(audio.currentTime)
    }
    const onMeta = () => setDuration(audio.duration || 0)
    const onError = () => {
      setPlaying(false)
      if (audio.getAttribute('src')) setError('The song audio could not be loaded from the server.')
    }
    const onSeeked = () => setTime(audio.currentTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('error', onError)
    audio.addEventListener('seeked', onSeeked)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('seeked', onSeeked)
    }
  }, [audio])

  // Follow the playhead smoothly while playing (timeupdate is too coarse).
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = -1
    const tick = () => {
      const t = audio.currentTime
      if (stopAt.current !== null && t >= stopAt.current) {
        audio.pause()
        audio.currentTime = stopAt.current
        stopAt.current = null
        setTime(audio.currentTime)
        return
      }
      if (Math.abs(t - last) >= 0.03) {
        last = t
        setTime(t)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [audio, playing])

  const play = useCallback(
    (from?: number, until?: number) => {
      if (from !== undefined) audio.currentTime = from
      stopAt.current = until ?? null
      audio.play().catch(() => setError('The song could not be played.'))
    },
    [audio],
  )

  const pause = useCallback(() => {
    stopAt.current = null
    audio.pause()
  }, [audio])

  const seek = useCallback(
    (t: number) => {
      audio.currentTime = Math.max(0, t)
      setTime(audio.currentTime)
    },
    [audio],
  )

  const [rate, setRateState] = useState(1)
  const setRate = useCallback(
    (r: number) => {
      audio.preservesPitch = true
      audio.playbackRate = r
      setRateState(r)
    },
    [audio],
  )
  // A new source resets the element's speed; keep the chosen one.
  useEffect(() => {
    const keep = () => {
      audio.preservesPitch = true
      audio.playbackRate = rate
    }
    keep()
    audio.addEventListener('loadedmetadata', keep)
    return () => audio.removeEventListener('loadedmetadata', keep)
  }, [audio, rate])

  const now = useCallback(() => audio.currentTime, [audio])

  return { time, playing, duration, error, play, pause, seek, now, rate, setRate }
}
