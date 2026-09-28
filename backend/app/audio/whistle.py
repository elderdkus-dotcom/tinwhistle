"""Note detection for a tin whistle, flute or similar lead instrument.

Two detectors are combined, because each fails differently:

- The pitch-contour tracker (pYIN, see voice.WHISTLE) follows slurred notes
  and is very accurate while the whistle is the clearest sound, but it goes
  quiet or slips onto other instruments when the whistle is buried.
- Basic Pitch hears the whistle through other instruments, but misses notes
  that change without a new attack.

Contour notes are kept only where Basic Pitch also hears that pitch (this
rejects slips onto a guitar's overtones), and Basic Pitch's notes fill the
stretches where the contour found nothing. On rendered test songs (whistle,
recorder, flute and piccolo over guitar, bass and drums) this scored better
than either detector alone.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from app.audio import transcribe, voice
from app.music import melody
from app.music.model import NoteEvent

MIN_FREQ = 540.0  # just below D5, the whistle's lowest note
MAX_FREQ = 2700.0
LOWEST_KEY = 21  # Basic Pitch's first pitch bin is A0 (MIDI 21)
MIN_SUPPORT = 0.15  # mean Basic Pitch activation a contour note needs
OVERLAP_MARGIN = 0.03  # seconds


def _supported(output: dict, note: NoteEvent) -> bool:
    from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP

    frame = FFT_HOP / AUDIO_SAMPLE_RATE
    activation = output["note"]
    a = int(note.start / frame)
    b = max(a + 1, int(note.end / frame))
    col = note.pitch - LOWEST_KEY
    return 0 <= col < activation.shape[1] and float(activation[a:b, col].mean()) >= MIN_SUPPORT


def _fill(primary: list[NoteEvent], backup: list[NoteEvent]) -> list[NoteEvent]:
    """`primary`, plus `backup` notes wherever the primary line is silent."""
    out = list(primary)
    for n in backup:
        if all(n.end <= p.start + OVERLAP_MARGIN or n.start >= p.end - OVERLAP_MARGIN for p in primary):
            out.append(n)
    return sorted(out, key=lambda n: n.start)


def whistle_notes(
    y: np.ndarray, sr: int, isolated: bool, on_progress: Callable[[float], None] | None = None
) -> list[NoteEvent]:
    """The whistle's notes in `y` (ideally a stem with drums, bass and guitar removed)."""
    length = len(y) / sr
    # Progress: Basic Pitch is the first third of the work, pYIN the rest.
    first = (lambda done: on_progress(done / 3)) if on_progress else None
    rest = (lambda done: on_progress(length / 3 + 2 * done / 3)) if on_progress else None
    output = transcribe._run_model(y, sr, first)
    backup = melody.extract_melody(transcribe.notes_from_output(output, isolated, MIN_FREQ, MAX_FREQ))
    contour = [n for n in voice.transcribe_whistle(y, sr, rest) if _supported(output, n)]
    return _fill(contour, backup)
