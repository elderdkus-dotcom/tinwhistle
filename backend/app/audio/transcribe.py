"""Audio to note events with Spotify's Basic Pitch."""

from __future__ import annotations

import threading
from typing import Callable

import numpy as np

from app.music.model import NoteEvent

_model = None
_model_lock = threading.Lock()


def _get_model():
    """Load Basic Pitch once, preferring the ONNX model (no TensorFlow needed)."""
    global _model
    with _model_lock:
        if _model is None:
            from basic_pitch import ICASSP_2022_MODEL_PATH, ONNX_PRESENT, FilenameSuffix, build_icassp_2022_model_path
            from basic_pitch.inference import Model

            path = build_icassp_2022_model_path(FilenameSuffix.onnx) if ONNX_PRESENT else ICASSP_2022_MODEL_PATH
            _model = Model(path)
        return _model


def _run_model(y: np.ndarray, sr: int, on_progress: Callable[[float], None] | None) -> dict:
    """Basic Pitch's run_inference on an array, window by window so progress can be reported."""
    import librosa
    from basic_pitch.constants import AUDIO_N_SAMPLES, AUDIO_SAMPLE_RATE, FFT_HOP
    from basic_pitch.inference import unwrap_output, window_audio_file

    if sr != AUDIO_SAMPLE_RATE:
        y = librosa.resample(y, orig_sr=sr, target_sr=AUDIO_SAMPLE_RATE)
    y = y.astype(np.float32)
    model = _get_model()
    n_overlapping_frames = 30
    overlap_len = n_overlapping_frames * FFT_HOP
    hop_size = AUDIO_N_SAMPLES - overlap_len
    padded = np.concatenate([np.zeros(overlap_len // 2, dtype=np.float32), y])
    output: dict[str, list] = {"note": [], "onset": [], "contour": []}
    for window, window_time in window_audio_file(padded, hop_size):
        for k, v in model.predict(np.expand_dims(window, axis=0)).items():
            output[k].append(v)
        if on_progress:
            done = window_time["start"] + hop_size / AUDIO_SAMPLE_RATE
            on_progress(min(done, len(y) / AUDIO_SAMPLE_RATE))
    return {k: unwrap_output(np.concatenate(v), len(y), n_overlapping_frames) for k, v in output.items()}


def transcribe(
    y: np.ndarray,
    sr: int,
    isolated: bool,
    on_progress: Callable[[float], None] | None = None,
    min_freq: float = 80.0,
    max_freq: float = 2100.0,
) -> list[NoteEvent]:
    """Transcribe mono audio into (possibly overlapping) note events.

    With an isolated stem the thresholds can be lower, because most of what
    is left is the melody. Only notes between `min_freq` and `max_freq` (Hz)
    are kept, which is how one instrument is picked out by its range.
    `on_progress` receives the seconds of audio processed so far.
    """
    import basic_pitch.note_creation as infer
    from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP

    model_output = _run_model(y, sr, on_progress)
    minimum_note_length = 80  # ms
    _, events = infer.model_output_to_notes(
        model_output,
        onset_thresh=0.5 if isolated else 0.6,
        frame_thresh=0.3 if isolated else 0.4,
        min_note_len=int(np.round(minimum_note_length / 1000 * (AUDIO_SAMPLE_RATE / FFT_HOP))),
        min_freq=min_freq,
        max_freq=max_freq,
        multiple_pitch_bends=False,
        melodia_trick=True,
    )
    return [
        NoteEvent(start=float(s), end=float(e), pitch=int(p), amplitude=float(a))
        for s, e, p, a, *_ in events
    ]
