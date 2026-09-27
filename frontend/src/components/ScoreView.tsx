import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderScore, type NoteShapes } from '../render'
import type { Arrangement } from '../types'

interface Props {
  arrangement: Arrangement
  showNames: boolean
  selectedId: string | null
  playingId: string | null
  onSelect: (id: string | null) => void
}

export function ScoreView({ arrangement, showNames, selectedId, playingId, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const shapes = useRef(new Map<string, NoteShapes>())
  const [width, setWidth] = useState(0)

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
    for (const [id, s] of shapes.current) {
      for (const rect of s.highlights) {
        rect.classList.toggle('selected', id === selectedId)
        rect.classList.toggle('playing', id === playingId)
      }
    }
    if (playingId) {
      const rect = shapes.current.get(playingId)?.highlights[0]
      rect?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedId, playingId, arrangement, width, showNames])

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
