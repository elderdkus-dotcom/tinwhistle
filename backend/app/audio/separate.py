"""Optional source separation with Demucs, to isolate the sung melody."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

# Below this vocal-to-mix energy ratio the song is treated as instrumental
# (e.g. a trad tune) and the full mix is transcribed instead.
MIN_VOCAL_ENERGY_RATIO = 0.08


def separation_available() -> bool:
    return importlib.util.find_spec("demucs") is not None


def isolate_vocals(wav: Path, workdir: Path) -> Path | None:
    """Return a WAV of the vocal stem, or None when the song has no real vocals."""
    outdir = workdir / "separated"
    cmd = [
        sys.executable, "-m", "demucs.separate",
        "--two-stems=vocals", "-n", "htdemucs", "-o", str(outdir), str(wav),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    vocals = outdir / "htdemucs" / wav.stem / "vocals.wav"
    if result.returncode != 0 or not vocals.exists():
        raise RuntimeError(f"Demucs failed: {result.stderr.strip()[-500:]}")
    mix, _ = sf.read(wav, always_2d=True)
    voc, _ = sf.read(vocals, always_2d=True)
    mix_energy = float(np.mean(mix**2)) + 1e-12
    voc_energy = float(np.mean(voc**2))
    if voc_energy / mix_energy < MIN_VOCAL_ENERGY_RATIO:
        return None
    return vocals
