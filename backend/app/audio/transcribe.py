"""Audio to note events with Spotify's Basic Pitch."""

from __future__ import annotations

import threading
from pathlib import Path

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


def transcribe(wav: Path, isolated: bool) -> list[NoteEvent]:
    """Transcribe a WAV into (possibly overlapping) note events.

    With an isolated vocal stem the thresholds can be lower, because nearly
    everything left in the signal is the melody.
    """
    from basic_pitch.inference import predict

    _, _, events = predict(
        str(wav),
        _get_model(),
        onset_threshold=0.5 if isolated else 0.6,
        frame_threshold=0.3 if isolated else 0.4,
        minimum_note_length=80,  # ms
        # Roughly the range of a singing voice or lead instrument.
        minimum_frequency=80.0,
        maximum_frequency=2100.0,
        multiple_pitch_bends=False,
        melodia_trick=True,
    )
    return [
        NoteEvent(start=float(s), end=float(e), pitch=int(p), amplitude=float(a))
        for s, e, p, a, *_ in events
    ]
