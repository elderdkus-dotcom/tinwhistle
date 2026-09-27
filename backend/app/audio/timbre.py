"""Telling instruments apart by how their notes behave over time.

A whistle, flute or voice holds a note at a steady level for as long as it
is blown; a plucked or struck string (guitar, piano, harp) starts loud and
fades at once. Measuring how fast each detected note fades separates a
whistle melody from a guitar playing in the same range, even when source
separation puts both in the same stem.
"""

from __future__ import annotations

import numpy as np

from app.music.model import NoteEvent

N_FFT = 2048
HOP = 256
# Notes fading faster than this (dB per second) are treated as plucked/struck.
# Measured on test mixes: whistle notes fade by at most ~12 dB/s, guitar
# notes and their overtones typically by 30 dB/s.
MAX_SUSTAINED_FADE = -15.0


def fade_rates(y: np.ndarray, sr: int, events: list[NoteEvent]) -> list[float]:
    """How fast each note's fundamental fades, in dB per second (0 = steady)."""
    import librosa

    spectrum = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    rates = []
    for e in events:
        f0 = 440.0 * 2 ** ((e.pitch - 69) / 12)
        band = (freqs > f0 * 2 ** (-0.5 / 12)) & (freqs < f0 * 2 ** (0.5 / 12))
        a, b = int(e.start * sr / HOP), min(int(e.end * sr / HOP), spectrum.shape[1])
        # Ignore the attack and release; measure the body of the note.
        lo, hi = a + max(1, (b - a) // 6), b - max(1, (b - a) // 6)
        if hi - lo < 3 or not band.any():
            rates.append(0.0)
            continue
        level = 20 * np.log10(spectrum[band, lo:hi].sum(axis=0) + 1e-6)
        t = np.arange(hi - lo) * HOP / sr
        rates.append(float(np.polyfit(t, level, 1)[0]))
    return rates


def keep_sustained(y: np.ndarray, sr: int, events: list[NoteEvent]) -> list[NoteEvent]:
    """Drop notes that fade like plucked or struck strings."""
    return [e for e, rate in zip(events, fade_rates(y, sr, events)) if rate >= MAX_SUSTAINED_FADE]
