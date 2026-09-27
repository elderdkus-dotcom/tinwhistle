/** Plays a score with a simple whistle-like synth (Web Audio). */

import type { ScoreNote } from './types'
import { SOUNDING_OFFSET, stepScale } from './whistle'

const GRACE = 0.035 // seconds for cuts and taps

function frequency(pitch: number): number {
  return 440 * 2 ** ((pitch + SOUNDING_OFFSET - 69) / 12)
}

export interface PlayOptions {
  tempo: number
  fromBeat?: number
  countIn?: boolean
  beatsPerMeasure: number
  onNote?: (id: string | null) => void
  onEnd?: () => void
}

export class Player {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sources: AudioScheduledSourceNode[] = []
  private frame = 0
  private endTimer = 0

  get playing(): boolean {
    return this.sources.length > 0
  }

  private audio(): { ctx: AudioContext; out: GainNode } {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.25
      this.master.connect(this.ctx.destination)
    }
    return { ctx: this.ctx, out: this.master! }
  }

  /** One tone with a soft, breathy attack. */
  private tone(pitch: number, at: number, length: number) {
    const { ctx, out } = this.audio()
    const gain = ctx.createGain()
    const end = at + Math.max(length, 0.03)
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(1, at + 0.015)
    gain.gain.setValueAtTime(1, Math.max(at + 0.015, end - 0.03))
    gain.gain.linearRampToValueAtTime(0, end)
    gain.connect(out)
    const f = frequency(pitch)
    for (const [type, level, mult] of [['sine', 1, 1], ['triangle', 0.12, 2]] as const) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = f * mult
      const g = ctx.createGain()
      g.gain.value = level
      osc.connect(g).connect(gain)
      osc.start(at)
      osc.stop(end + 0.01)
      this.sources.push(osc)
    }
  }

  private click(at: number, accent: boolean) {
    const { ctx, out } = this.audio()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.frequency.value = accent ? 1600 : 1100
    g.gain.setValueAtTime(0.5, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.05)
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + 0.06)
    this.sources.push(osc)
  }

  private playNote(n: ScoreNote, at: number, length: number) {
    const hold = length * 0.94 // a small gap so repeated notes are heard
    if (n.ornament === 'cut') {
      this.tone(stepScale(n.pitch, 2), at, GRACE)
      this.tone(n.pitch, at + GRACE, hold - GRACE)
    } else if (n.ornament === 'roll' && hold > 6 * GRACE) {
      // note, cut, note, tap, note
      const part = (hold - 2 * GRACE) / 3
      this.tone(n.pitch, at, part)
      this.tone(stepScale(n.pitch, 2), at + part, GRACE)
      this.tone(n.pitch, at + part + GRACE, part)
      this.tone(stepScale(n.pitch, -1), at + 2 * part + GRACE, GRACE)
      this.tone(n.pitch, at + 2 * part + 2 * GRACE, part)
    } else {
      this.tone(n.pitch, at, hold)
    }
  }

  play(notes: ScoreNote[], options: PlayOptions): void {
    this.stop()
    const { ctx } = this.audio()
    void ctx.resume()
    const spb = 60 / options.tempo
    const from = options.fromBeat ?? 0
    const lead = options.countIn ? options.beatsPerMeasure * spb : 0
    const t0 = ctx.currentTime + 0.1 + lead
    if (options.countIn) {
      for (let b = 0; b < options.beatsPerMeasure; b++) this.click(t0 - lead + b * spb, b === 0)
    }
    const upcoming = notes.filter((n) => n.start + n.duration > from + 1e-9).sort((a, b) => a.start - b.start)
    for (const n of upcoming) {
      const start = Math.max(n.start, from)
      this.playNote(n, t0 + (start - from) * spb, (n.start + n.duration - start) * spb)
    }
    const endBeat = upcoming.length ? Math.max(...upcoming.map((n) => n.start + n.duration)) : from

    let current: string | null = null
    const tick = () => {
      const beat = from + (ctx.currentTime - t0) / spb
      const n = upcoming.find((x) => beat >= x.start && beat < x.start + x.duration)
      const id = n?.id ?? null
      if (id !== current) {
        current = id
        options.onNote?.(id)
      }
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
    this.endTimer = window.setTimeout(() => {
      this.stop()
      options.onEnd?.()
    }, ((endBeat - from) * spb + lead + 0.3) * 1000)
  }

  stop(): void {
    cancelAnimationFrame(this.frame)
    clearTimeout(this.endTimer)
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    this.sources = []
  }
}
