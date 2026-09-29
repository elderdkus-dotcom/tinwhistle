"""Beat tracking and bar lines, for mapping between song time and score position."""

from __future__ import annotations

import numpy as np

MIN_TEMPO = 60.0
# Fast tunes (reels, marches, rebel songs) often run at 150-180 BPM; they are
# only halved above this, so their quick notes still fit the sixteenth grid.
MAX_TEMPO = 185.0


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


def downbeat_phase(evidence: np.ndarray, beats_per_measure: int) -> int:
    """Which beat index (mod beats_per_measure) most likely starts a measure."""
    if len(evidence) < beats_per_measure * 2:
        return 0
    scores = [float(evidence[p::beats_per_measure].mean()) for p in range(beats_per_measure)]
    return int(np.argmax(scores))


def score_origin(beats: np.ndarray, beats_per_measure: int, phase: int) -> float:
    """The beat index that becomes score position 0.

    It is a downbeat, at or before the start of the song, so every note gets a
    non-negative position and bar lines fall on the detected downbeats.
    """
    first = float(seconds_to_beats(np.array([0.0]), beats)[0])
    measures_back = int(np.ceil((phase - first) / beats_per_measure))
    return float(phase - measures_back * beats_per_measure)
