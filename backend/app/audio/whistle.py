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

Before either runs, pitches that sound unchanged for seconds on end are
removed: accordions, banjos and synth pads often hold a chord or drone in the
whistle's range, and a tune moves while a drone does not.

The range starts at A4, so whistles in other keys fit too: a B-flat or C
whistle (common on recordings in those keys) plays down to B-flat 4 / C5.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from app.audio import transcribe, voice
from app.music import melody
from app.music.model import NoteEvent

MIN_FREQ = 430.0  # just below A4: low enough for B-flat and C whistles
MAX_FREQ = 2700.0
LOWEST_KEY = 21  # Basic Pitch's first pitch bin is A0 (MIDI 21)
MIN_SUPPORT = 0.15  # mean Basic Pitch activation a contour note needs
OVERLAP_MARGIN = 0.03  # seconds
DRONE_SECONDS = 3.0  # a pitch held steadily this long counts as accompaniment
DRONE_STRENGTH = 1.2


def remove_drones(y: np.ndarray, sr: int) -> np.ndarray:
    """Suppress pitches that sound steadily for several seconds (drones, held chords).

    The steady level of every frequency is its median over a few seconds;
    only what rises above it (the moving tune) is kept.
    """
    import librosa
    from scipy.ndimage import median_filter, uniform_filter1d

    hop = 256
    spectrum = librosa.stft(y, n_fft=2048, hop_length=hop)
    magnitude = np.abs(spectrum)
    width = max(3, int(DRONE_SECONDS * sr / hop)) | 1
    steady = median_filter(magnitude, size=(1, width), mode="nearest")
    keep = np.clip(magnitude - DRONE_STRENGTH * steady, 0, None) / (magnitude + 1e-9)
    keep = uniform_filter1d(keep, 3, axis=1)  # soften the mask a little
    return librosa.istft(spectrum * keep, hop_length=hop, length=len(y)).astype(np.float32)


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
    y = remove_drones(y, sr)
    output = transcribe._run_model(y, sr, first)
    backup = melody.extract_melody(transcribe.notes_from_output(output, isolated, MIN_FREQ, MAX_FREQ))
    contour = [n for n in voice.transcribe_whistle(y, sr, rest) if _supported(output, n)]
    return _fill(contour, backup)
