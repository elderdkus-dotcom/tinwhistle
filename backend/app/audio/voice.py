"""Note detection for a single singing voice (an isolated vocal stem).

Basic Pitch is built for instruments and polyphony; on a voice with vibrato
and slides it tends to split and mis-pitch notes. Here the pitch contour is
tracked with pYIN and cut into notes where the pitch settles on a new
semitone, where the voice stops, or where a new syllable starts.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from app.music.model import NoteEvent

# The voice is analyzed at 11.025 kHz: plenty for pitch, and twice as fast.
RATE = 11025
HOP = 128
FRAME = 1024
FMIN = 65.0  # C2
FMAX = 1050.0  # C6
CHUNK_SECONDS = 12.0
VOICED_PROB = 0.25
# A pitch change must exceed this many semitones for this long to start a note;
# vibrato (about +-0.4 semitones) must not.
CHANGE_SEMITONES = 0.6
CHANGE_FRAMES = 4
MAX_GAP_FRAMES = 2  # unvoiced frames tolerated inside a note
MIN_NOTE_SECONDS = 0.08
GLIDE_SECONDS = 0.05  # ignored at the start of a note when picking its pitch
# A syllable onset splits a held pitch into repeated notes.
ONSET_DELTA = 0.25
ONSET_MARGIN_SECONDS = 0.1
# A brief drop in loudness inside a held pitch also means a new (repeated) note.
DIP_RATIO = 0.35


def _pitch_track(y: np.ndarray, sr: int, on_progress: Callable[[float], None] | None):
    import librosa

    chunk = int(CHUNK_SECONDS * sr)
    midi_parts, prob_parts = [], []
    for start in range(0, len(y), chunk):
        part = y[start : start + chunk]
        if len(part) < FRAME:
            part = np.pad(part, (0, FRAME - len(part)))
        f0, _, prob = librosa.pyin(
            part, fmin=FMIN, fmax=FMAX, sr=sr, frame_length=FRAME, hop_length=HOP, center=True
        )
        n = int(np.ceil(min(chunk, len(y) - start) / HOP))
        with np.errstate(divide="ignore", invalid="ignore"):
            midi_parts.append((69 + 12 * np.log2(f0 / 440.0))[:n])
        prob_parts.append(prob[:n])
        if on_progress:
            on_progress(min(len(y), start + chunk) / sr)
    return np.concatenate(midi_parts), np.concatenate(prob_parts)


def _onsets(y: np.ndarray, sr: int) -> np.ndarray:
    import librosa

    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    frames = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=HOP, delta=ONSET_DELTA, units="frames")
    return frames


def _split_at_dips(bound: tuple[int, int], rms: np.ndarray, min_frames: int) -> list[tuple[int, int]]:
    """Split a note where its loudness briefly drops, e.g. two sung syllables on one pitch."""
    start, end = bound
    level = rms[start:end]
    if len(level) < 2 * min_frames:
        return [bound]
    threshold = DIP_RATIO * float(np.median(level))
    low = level < threshold
    for i in range(min_frames, len(level) - min_frames):
        if low[i] and not low[i - 1]:
            j = i
            while j < len(level) and low[j]:
                j += 1
            # Loud again afterwards, for long enough to be a note: split at the dip's quietest point.
            if j < len(level) - min_frames and not low[j : j + min_frames].any():
                cut = start + i + int(np.argmin(level[i:j]))
                return [(start, cut)] + _split_at_dips((cut + 1, end), rms, min_frames)
    return [bound]


def transcribe_voice(
    y: np.ndarray, sr: int, on_progress: Callable[[float], None] | None = None
) -> list[NoteEvent]:
    import librosa
    from scipy.ndimage import median_filter

    y = librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=RATE)
    sr = RATE
    midi, prob = _pitch_track(y, sr, on_progress)
    voiced = np.isfinite(midi) & (prob >= VOICED_PROB)
    smooth = midi.copy()
    smooth[voiced] = median_filter(midi[voiced], size=5, mode="nearest") if voiced.any() else smooth[voiced]
    # A short window, so brief dips between repeated syllables stay visible.
    rms = librosa.feature.rms(y=y, frame_length=2 * HOP, hop_length=HOP)[0]
    rms = np.pad(rms, (0, max(0, len(midi) - len(rms))))[: len(midi)]
    onset_frames = set(int(f) for f in _onsets(y, sr))

    frame_s = HOP / sr
    min_frames = int(MIN_NOTE_SECONDS / frame_s)
    glide = int(GLIDE_SECONDS / frame_s)
    margin = int(ONSET_MARGIN_SECONDS / frame_s)

    # 1. Split voiced regions into notes at pitch changes and syllable onsets.
    bounds: list[tuple[int, int]] = []
    i, n = 0, len(midi)
    while i < n:
        if not voiced[i]:
            i += 1
            continue
        start = i
        center = smooth[i]
        stable: list[float] = [smooth[i]]
        j, gap, pending = i + 1, 0, 0
        while j < n:
            if not voiced[j]:
                gap += 1
                if gap > MAX_GAP_FRAMES:
                    break
                j += 1
                continue
            gap = 0
            if abs(smooth[j] - center) > CHANGE_SEMITONES:
                pending += 1
                if pending >= CHANGE_FRAMES:
                    j -= CHANGE_FRAMES - 1  # the new note starts where the change began
                    break
            else:
                pending = 0
                stable.append(smooth[j])
                # Follow slow drift of the held pitch.
                center = float(np.median(stable[-25:]))
            if j - start > margin and j in onset_frames and j + margin < n and voiced[min(j + margin, n - 1)]:
                break  # new syllable on the same pitch
            j += 1
        end = min(j, n)
        if end - start >= min_frames:
            bounds.append((start, end))
        i = max(end, start + 1)

    bounds = [piece for b in bounds for piece in _split_at_dips(b, rms, min_frames)]

    # 2. One pitch per note: the median after the initial glide.
    notes: list[NoteEvent] = []
    for start, end in bounds:
        body = smooth[start + min(glide, (end - start) // 3) : end]
        body = body[np.isfinite(body)]
        if len(body) == 0:
            continue
        notes.append(
            NoteEvent(
                start=start * frame_s,
                end=end * frame_s,
                pitch=int(np.round(np.median(body))),
                amplitude=float(np.mean(rms[start:end]) / (rms.max() + 1e-9)),
            )
        )
    return notes
