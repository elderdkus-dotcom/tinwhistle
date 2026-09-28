"""Note detection for a single melodic line (a voice or a whistle).

Basic Pitch is built for instruments and polyphony; on a voice with vibrato
and slides it splits and mis-pitches notes, and on a whistle it misses
slurred notes (a new pitch without a new attack). Here the pitch contour is
tracked with pYIN and cut into notes where the pitch settles on a new
semitone, where the sound stops, or where a new syllable / tongued note
starts. Settings differ per instrument (VOICE, WHISTLE).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

from app.music.model import NoteEvent


@dataclass(frozen=True)
class ContourSettings:
    rate: int  # analysis sample rate
    hop: int
    frame: int
    fmin: float  # Hz
    fmax: float
    voiced_prob: float
    # A pitch change must exceed this many semitones for this long to start a
    # note; vibrato (about +-0.4 semitones) must not.
    change_semitones: float
    change_seconds: float
    min_note_seconds: float
    glide_seconds: float  # ignored at the start of a note when picking its pitch
    smooth_seconds: float  # median filter on the contour
    max_gap_seconds: float = 0.025  # unvoiced time tolerated inside a note


# The voice is analyzed at 11.025 kHz: plenty for pitch, and twice as fast.
VOICE = ContourSettings(
    rate=11025, hop=128, frame=1024, fmin=65.0, fmax=1050.0, voiced_prob=0.25,
    change_semitones=0.6, change_seconds=0.045, min_note_seconds=0.08,
    glide_seconds=0.05, smooth_seconds=0.058,
)
# A D whistle sounds D5 (587 Hz) up to about E7; its notes change quickly and
# cleanly, so the contour is tracked with finer timing. Cuts and taps (~30 ms
# grace notes) are shorter than min_note_seconds and are left out, as whistle
# sheet music usually does.
WHISTLE = ContourSettings(
    rate=11025, hop=64, frame=512, fmin=520.0, fmax=2700.0, voiced_prob=0.2,
    change_semitones=0.6, change_seconds=0.025, min_note_seconds=0.06,
    glide_seconds=0.02, smooth_seconds=0.03,
)

CHUNK_SECONDS = 12.0
# A syllable onset / tongued note splits a held pitch into repeated notes.
ONSET_DELTA = 0.25
ONSET_MARGIN_SECONDS = 0.1
# A brief drop in loudness inside a held pitch also means a new (repeated) note.
DIP_RATIO = 0.35


def _pitch_track(y: np.ndarray, cfg: ContourSettings, on_progress: Callable[[float], None] | None):
    import librosa

    sr, hop = cfg.rate, cfg.hop
    chunk = int(CHUNK_SECONDS * sr)
    midi_parts, prob_parts = [], []
    for start in range(0, len(y), chunk):
        part = y[start : start + chunk]
        if len(part) < cfg.frame:
            part = np.pad(part, (0, cfg.frame - len(part)))
        f0, _, prob = librosa.pyin(
            part, fmin=cfg.fmin, fmax=cfg.fmax, sr=sr, frame_length=cfg.frame, hop_length=hop, center=True
        )
        n = int(np.ceil(min(chunk, len(y) - start) / hop))
        with np.errstate(divide="ignore", invalid="ignore"):
            midi_parts.append((69 + 12 * np.log2(f0 / 440.0))[:n])
        prob_parts.append(prob[:n])
        if on_progress:
            on_progress(min(len(y), start + chunk) / sr)
    return np.concatenate(midi_parts), np.concatenate(prob_parts)


def _onsets(y: np.ndarray, sr: int, hop: int) -> np.ndarray:
    import librosa

    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    return librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop, delta=ONSET_DELTA, units="frames")


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
    return transcribe_contour(y, sr, VOICE, on_progress)


def transcribe_whistle(
    y: np.ndarray, sr: int, on_progress: Callable[[float], None] | None = None
) -> list[NoteEvent]:
    return transcribe_contour(y, sr, WHISTLE, on_progress)


def transcribe_contour(
    y: np.ndarray, sr: int, cfg: ContourSettings, on_progress: Callable[[float], None] | None = None
) -> list[NoteEvent]:
    import librosa
    from scipy.ndimage import median_filter

    y = librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=cfg.rate)
    sr, hop = cfg.rate, cfg.hop
    frame_s = hop / sr
    midi, prob = _pitch_track(y, cfg, on_progress)
    voiced = np.isfinite(midi) & (prob >= cfg.voiced_prob)
    smooth = midi.copy()
    size = max(3, int(round(cfg.smooth_seconds / frame_s)) | 1)
    smooth[voiced] = median_filter(midi[voiced], size=size, mode="nearest") if voiced.any() else smooth[voiced]
    # A short window, so brief dips between repeated notes stay visible.
    rms = librosa.feature.rms(y=y, frame_length=max(2 * hop, 256), hop_length=hop)[0]
    rms = np.pad(rms, (0, max(0, len(midi) - len(rms))))[: len(midi)]
    onset_frames = set(int(f) for f in _onsets(y, sr, hop))

    min_frames = max(2, int(cfg.min_note_seconds / frame_s))
    glide = int(cfg.glide_seconds / frame_s)
    margin = int(ONSET_MARGIN_SECONDS / frame_s)
    change_frames = max(2, int(round(cfg.change_seconds / frame_s)))
    max_gap = max(1, int(round(cfg.max_gap_seconds / frame_s)))

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
                if gap > max_gap:
                    break
                j += 1
                continue
            gap = 0
            if abs(smooth[j] - center) > cfg.change_semitones:
                pending += 1
                if pending >= change_frames:
                    j -= change_frames - 1  # the new note starts where the change began
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
