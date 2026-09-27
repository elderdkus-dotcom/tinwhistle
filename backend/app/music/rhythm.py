"""Beat tracking and quantizing real-time notes onto a beat grid."""

from __future__ import annotations

import numpy as np

from app.music.model import BeatNote, NoteEvent

GRID = 0.25  # beats: sixteenth notes in 4/4
MIN_TEMPO = 60.0
MAX_TEMPO = 150.0
# Gaps shorter than this (in beats) are closed by extending the previous note;
# singers breathe and consonants cut notes short, but the score should not
# be full of sixteenth rests.
MAX_FILLED_GAP = 0.5


def track_beats(y: np.ndarray, sr: int) -> tuple[float, np.ndarray]:
    """Return (tempo in BPM, beat times in seconds), tempo folded into a readable range."""
    import librosa

    tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    beats = librosa.frames_to_time(frames, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])
    return normalize_beats(tempo, beats, len(y) / sr)


def downbeat_evidence(y: np.ndarray, sr: int, beats: np.ndarray) -> np.ndarray:
    """Score each beat for how likely it is to start a measure.

    Chords tend to change and the bass drum tends to hit on downbeats, so this
    combines harmonic change with low-frequency onset strength.
    """
    import librosa

    hop = 512
    frames = librosa.time_to_frames(beats, sr=sr, hop_length=hop)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop)
    # Column i summarizes the span from beat i-1 to beat i (column 0: before beat 0).
    synced = librosa.util.sync(chroma, frames, aggregate=np.median)
    synced = synced / (np.linalg.norm(synced, axis=0, keepdims=True) + 1e-9)
    change = np.zeros(len(beats))
    for i in range(len(beats)):
        before, after = synced[:, i], synced[:, min(i + 1, synced.shape[1] - 1)]
        change[i] = 1.0 - float(before @ after)
    mel = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=hop, n_mels=64, fmax=8000)
    low = librosa.onset.onset_strength(S=librosa.power_to_db(mel[:8]), sr=sr, hop_length=hop)
    kick = low[np.clip(frames, 0, len(low) - 1)]
    return change / (change.mean() + 1e-9) + 0.5 * kick / (kick.mean() + 1e-9)


def normalize_beats(tempo: float, beats: np.ndarray, length: float) -> tuple[float, np.ndarray]:
    if len(beats) < 2 or tempo <= 0:
        tempo = 100.0
        beats = np.arange(0.0, max(length, 1.0), 60.0 / tempo)
    while tempo > MAX_TEMPO and len(beats) >= 4:
        beats = beats[::2]
        tempo /= 2
    while tempo < MIN_TEMPO:
        mids = (beats[:-1] + beats[1:]) / 2
        beats = np.sort(np.concatenate([beats, mids]))
        tempo *= 2
    return tempo, beats


def seconds_to_beats(times: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Map times to fractional beat indices, following tempo drift.

    Outside the tracked beats the average beat length is extrapolated.
    """
    period = float(np.median(np.diff(beats)))
    idx = np.interp(times, beats, np.arange(len(beats), dtype=float))
    before = times < beats[0]
    after = times > beats[-1]
    idx[before] = (times[before] - beats[0]) / period
    idx[after] = len(beats) - 1 + (times[after] - beats[-1]) / period
    return idx


def grid_offset(positions: np.ndarray) -> float:
    """How far (in beats) note onsets sit, on average, from the eighth-note grid.

    Beat trackers often place beats a few tens of milliseconds late, which is
    enough to push notes into the wrong sixteenth when rounding.
    """
    if len(positions) < 4:
        return 0.0
    angles = 2 * np.pi * positions / 0.5
    mean = np.mean(np.exp(1j * angles))
    if abs(mean) < 0.3:  # no clear grid; leave the beats alone
        return 0.0
    return float(np.angle(mean) / (2 * np.pi) * 0.5)


def quantize(notes: list[NoteEvent], beats: np.ndarray) -> list[BeatNote]:
    """Snap notes to the sixteenth grid and make the line strictly monophonic.

    Positions are in beat indices: position i is the time of beats[i].
    """
    if not notes:
        return []
    starts = seconds_to_beats(np.array([n.start for n in notes]), beats)
    ends = seconds_to_beats(np.array([n.end for n in notes]), beats)
    offset = grid_offset(starts)
    starts, ends = starts - offset, ends - offset
    out: list[BeatNote] = []
    for n, s, e in zip(notes, starts, ends):
        qs = round(s / GRID) * GRID
        qe = max(round(e / GRID) * GRID, qs + GRID)
        if out and qs < out[-1].end():
            if qs <= out[-1].start:
                # Two notes snapped to the same slot: keep the longer one.
                if qe - qs > out[-1].duration:
                    out[-1] = BeatNote(n.pitch, out[-1].start, qe - out[-1].start)
                continue
            out[-1].duration = qs - out[-1].start
        out.append(BeatNote(n.pitch, qs, qe - qs))

    merged: list[BeatNote] = []
    for n in out:
        if merged:
            prev = merged[-1]
            gap = n.start - prev.end()
            if 0 < gap <= MAX_FILLED_GAP + 1e-9:
                prev.duration += gap
        merged.append(n)
    return merged


def align_to_measures(
    notes: list[BeatNote], beats_per_measure: int, evidence: np.ndarray | None = None
) -> list[BeatNote]:
    """Shift the notes so that bar lines fall on the most likely downbeats.

    Uses where long notes start and, when given, per-beat downbeat evidence
    from the audio (see downbeat_evidence). Also drops leading silence so the
    score starts at the first measure that contains music.
    """
    if not notes:
        return []
    first = float(np.floor(notes[0].start))

    def note_weight(offset: int) -> float:
        # Notes that start on a downbeat for this offset, weighted by length.
        return sum(
            n.duration
            for n in notes
            if abs((n.start - first - offset) % beats_per_measure) < 1e-9
        )

    def audio_weight(offset: int) -> float:
        if evidence is None or len(evidence) < beats_per_measure * 2:
            return 0.0
        phase = int(first + offset) % beats_per_measure
        return float(evidence[phase::beats_per_measure].mean())

    offsets = range(beats_per_measure)
    notes_total = sum(note_weight(o) for o in offsets) or 1.0
    audio_total = sum(audio_weight(o) for o in offsets) or 1.0

    def score(offset: int) -> tuple[float, int]:
        return (note_weight(offset) / notes_total + audio_weight(offset) / audio_total, -offset)

    best = max(offsets, key=score)
    # Measure boundaries sit at first + best + k * beats_per_measure; move the
    # one at or before the first note to zero.
    origin = first + best - beats_per_measure * (1 if best > 0 else 0)
    return [BeatNote(n.pitch, n.start - origin, n.duration) for n in notes]
