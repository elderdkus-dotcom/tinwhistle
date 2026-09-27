"""Optional source separation with Demucs, to isolate the sung melody.

The model is loaded once and kept in memory, so separating a short part of a
song only costs the separation itself.
"""

from __future__ import annotations

import importlib.util
import threading
from typing import Callable

import numpy as np

# Below this vocal-to-mix energy ratio the part is treated as instrumental
# (e.g. an intro or a trad tune) and the full mix is transcribed instead.
MIN_VOCAL_ENERGY_RATIO = 0.08
MODEL_NAME = "htdemucs"

_model = None
_model_lock = threading.Lock()


class SeparationCancelled(Exception):
    pass


def separation_available() -> bool:
    return importlib.util.find_spec("demucs") is not None


def model_loaded() -> bool:
    return _model is not None


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            from demucs.pretrained import get_model

            _model = get_model(MODEL_NAME)
            _model.eval()
        return _model


def isolate_vocals(
    y: np.ndarray,
    sr: int,
    on_progress: Callable[[float], None] | None = None,
    cancelled: threading.Event | None = None,
) -> np.ndarray | None:
    """Return the vocal stem of mono audio `y` (same rate), or None if there are no real vocals.

    `on_progress` receives the seconds of audio separated so far. Setting
    `cancelled` stops the separation (raises SeparationCancelled).
    """
    import librosa
    import torch
    from demucs.apply import apply_model

    model = _get_model()
    length = len(y) / sr
    audio = librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=model.samplerate)
    mix = torch.from_numpy(np.stack([audio] * model.audio_channels))
    # Demucs expects normalized input (as in demucs.separate).
    mean, std = mix.mean(), mix.std() + 1e-8
    mix = (mix - mean) / std
    segment = float(getattr(model, "segment", 7.8))

    def callback(info: dict) -> None:
        if cancelled is not None and cancelled.is_set():
            raise SeparationCancelled()
        if on_progress and info.get("state") == "end":
            on_progress(min(length, info["segment_offset"] / model.samplerate + segment))

    with torch.no_grad():
        sources = apply_model(model, mix[None], shifts=1, split=True, overlap=0.25, callback=callback)[0]
    vocals = sources[model.sources.index("vocals")] * std + mean
    vocals = vocals.mean(dim=0).numpy()
    vocals = librosa.resample(vocals, orig_sr=model.samplerate, target_sr=sr)[: len(y)]
    if float(np.mean(vocals**2)) / (float(np.mean(y**2)) + 1e-12) < MIN_VOCAL_ENERGY_RATIO:
        return None
    return vocals.astype(np.float32)
