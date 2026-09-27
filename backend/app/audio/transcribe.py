"""Audio to note events with Spotify's Basic Pitch."""

from __future__ import annotations

import threading
from pathlib import Path
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


def _run_model(wav: Path, on_progress: Callable[[float], None] | None) -> dict:
    """Basic Pitch's run_inference, window by window so progress can be reported."""
    from basic_pitch.constants import AUDIO_N_SAMPLES, AUDIO_SAMPLE_RATE, FFT_HOP
    from basic_pitch.inference import get_audio_input, unwrap_output

    model = _get_model()
    n_overlapping_frames = 30
    overlap_len = n_overlapping_frames * FFT_HOP
    hop_size = AUDIO_N_SAMPLES - overlap_len
    output: dict[str, list] = {"note": [], "onset": [], "contour": []}
    original_length = 0
    for window, window_time, original_length in get_audio_input(str(wav), overlap_len, hop_size):
        for k, v in model.predict(window).items():
            output[k].append(v)
        if on_progress:
            done = window_time["start"] + hop_size / AUDIO_SAMPLE_RATE
            on_progress(min(done, original_length / AUDIO_SAMPLE_RATE))
    return {
        k: unwrap_output(np.concatenate(v), original_length, n_overlapping_frames) for k, v in output.items()
    }


def transcribe(
    wav: Path, isolated: bool, on_progress: Callable[[float], None] | None = None
) -> list[NoteEvent]:
    """Transcribe a WAV into (possibly overlapping) note events.

    With an isolated vocal stem the thresholds can be lower, because nearly
    everything left in the signal is the melody. `on_progress` receives the
    seconds of audio processed so far.
    """
    import basic_pitch.note_creation as infer
    from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP

    model_output = _run_model(wav, on_progress)
    minimum_note_length = 80  # ms
    _, events = infer.model_output_to_notes(
        model_output,
        onset_thresh=0.5 if isolated else 0.6,
        frame_thresh=0.3 if isolated else 0.4,
        min_note_len=int(np.round(minimum_note_length / 1000 * (AUDIO_SAMPLE_RATE / FFT_HOP))),
        # Roughly the range of a singing voice or lead instrument.
        min_freq=80.0,
        max_freq=2100.0,
        multiple_pitch_bends=False,
        melodia_trick=True,
    )
    return [
        NoteEvent(start=float(s), end=float(e), pitch=int(p), amplitude=float(a))
        for s, e, p, a, *_ in events
    ]
