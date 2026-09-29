import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { parseRestId, renderScore, type NoteShapes } from '../render'
import type { Score } from '../types'

interface Props {
  arrangement: Score
  showNames: boolean
  selectedId: string | null
  /** A selected stretch of rest (score positions), highlighted wherever rests fall in it. */
  selectedRange?: { start: number; end: number } | null
  playingId: string | null
  /** Where the song is (score position); rests there are highlighted as it plays. */
  playingPos?: number | null
  onSelect: (id: string | null) => void
}

export function ScoreView({ arrangement, showNames, selectedId, selectedRange, playingId, playingPos, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const shapes = useRef(new Map<string, NoteShapes>())
  const [width, setWidth] = useState(0)
  const followed = useRef<SVGRectElement | undefined>(undefined)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      // Re-layout only on real width changes, in steps, to avoid thrashing.
      const w = Math.floor(entry.contentRect.width / 10) * 10
      setWidth((prev) => (prev === w ? prev : w))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!ref.current || width < 200) return
    shapes.current = renderScore(ref.current, arrangement, { width, showNames })
  }, [arrangement, width, showNames])

  useEffect(() => {
    let follow: SVGRectElement | undefined
    for (const [id, s] of shapes.current) {
      const rest = parseRestId(id)
      const selected =
        id === selectedId ||
        (!!rest && !!selectedRange && rest.start < selectedRange.end - 1e-9 && rest.start + rest.beats > selectedRange.start + 1e-9)
      const playing =
        id === playingId ||
        (!!rest && playingPos != null && playingPos >= rest.start && playingPos < rest.start + rest.beats)
      for (const rect of s.highlights) {
        rect.classList.toggle('selected', selected)
        rect.classList.toggle('playing', playing)
      }
      if (playing && !follow) follow = s.highlights[0]
    }
    if (follow && follow !== followed.current) follow.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    followed.current = follow
  }, [selectedId, selectedRange, playingId, playingPos, arrangement, width, showNames])

  return (
    <div
      className="score"
      ref={ref}
      onClick={(e) => {
        const target = (e.target as Element).closest('[data-note-id]')
        onSelect(target?.getAttribute('data-note-id') ?? null)
      }}
    />
  )
}
