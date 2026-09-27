"""Reduce polyphonic note events to a single melodic line."""

from __future__ import annotations

from typing import Callable

import numpy as np

from app.music.model import NoteEvent

FRAME = 0.02  # seconds
# Costs of the Viterbi path; emissions are note amplitudes (~0.3-1.0).
SWITCH_COST = 0.6  # leaving a note for another
JUMP_COST_PER_OCTAVE = 1.2  # extra cost for large leaps
SILENCE_EMISSION = 0.15  # score of choosing "no note" in a frame
HEIGHT_BONUS_PER_OCTAVE = 0.1  # melodies tend to sit on top of the texture
MIN_SEGMENT = 0.1  # seconds; shorter fragments are dropped
PROGRESS_EVERY = 250  # frames (5 s of audio)


def extract_melody(
    events: list[NoteEvent], on_progress: Callable[[float], None] | None = None
) -> list[NoteEvent]:
    """Pick at most one note at every moment, favouring loud, continuous lines.

    Runs a Viterbi search over frames where the states are "silence" or one of
    the notes sounding in that frame. `on_progress` receives the seconds of
    audio processed so far.
    """
    if not events:
        return []
    events = sorted(events, key=lambda e: (e.start, e.pitch))
    n_frames = int(np.ceil(max(e.end for e in events) / FRAME)) + 1
    active: list[list[int]] = [[] for _ in range(n_frames)]
    for i, e in enumerate(events):
        for f in range(int(e.start / FRAME), max(int(e.start / FRAME) + 1, int(e.end / FRAME))):
            active[f].append(i)

    def emission(i: int) -> float:
        e = events[i]
        return e.amplitude + HEIGHT_BONUS_PER_OCTAVE * (e.pitch - 60) / 12

    def transition(a: int, b: int) -> float:
        if a == b:
            return 0.0
        if a < 0 or b < 0:
            return SWITCH_COST / 2
        jump = abs(events[a].pitch - events[b].pitch) / 12
        return SWITCH_COST + JUMP_COST_PER_OCTAVE * jump

    # score[state] and back-pointers per frame; state -1 is silence.
    prev_states = [-1]
    prev_scores = np.array([0.0])
    backptr: list[dict[int, int]] = []
    for f in range(n_frames):
        if on_progress and f % PROGRESS_EVERY == 0:
            on_progress(f * FRAME)
        states = [-1] + active[f]
        scores = np.empty(len(states))
        ptrs: dict[int, int] = {}
        for k, s in enumerate(states):
            best, arg = -np.inf, -1
            for pk, ps in enumerate(prev_states):
                v = prev_scores[pk] - transition(ps, s)
                if v > best:
                    best, arg = v, ps
            scores[k] = best + (SILENCE_EMISSION if s < 0 else emission(s))
            ptrs[s] = arg
        backptr.append(ptrs)
        prev_states, prev_scores = states, scores

    state = prev_states[int(np.argmax(prev_scores))]
    path = [0] * n_frames
    for f in range(n_frames - 1, -1, -1):
        path[f] = state
        state = backptr[f][state]

    melody: list[NoteEvent] = []
    f = 0
    while f < n_frames:
        s = path[f]
        g = f
        while g + 1 < n_frames and path[g + 1] == s:
            g += 1
        if s >= 0 and (g + 1 - f) * FRAME >= MIN_SEGMENT:
            src = events[s]
            melody.append(
                NoteEvent(
                    start=max(src.start, f * FRAME),
                    end=min(src.end, (g + 1) * FRAME),
                    pitch=src.pitch,
                    amplitude=src.amplitude,
                )
            )
        f = g + 1
    return melody
