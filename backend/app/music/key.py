"""Key estimation with the Krumhansl-Schmuckler profiles."""

from __future__ import annotations

import numpy as np

from app.music.model import BeatNote

NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
FINAL_NOTE_BONUS = 0.15


def estimate_key(notes: list[BeatNote]) -> str:
    if not notes:
        return ""
    hist = np.zeros(12)
    for n in notes:
        hist[n.pitch % 12] += n.duration
    # Tunes usually end on their home note; this separates a key from its
    # relative minor/major, which the profiles alone often confuse.
    final = notes[-1].pitch % 12
    best, name = -np.inf, ""
    for tonic in range(12):
        for profile, mode in ((MAJOR, "major"), (MINOR, "minor")):
            r = np.corrcoef(hist, np.roll(profile, tonic))[0, 1]
            if tonic == final:
                r += FINAL_NOTE_BONUS
            if r > best:
                best, name = r, f"{NAMES[tonic]} {mode}"
    return name
