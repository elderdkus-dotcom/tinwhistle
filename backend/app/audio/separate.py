"""Optional source separation with Demucs, to isolate the sung melody."""

from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf

# Below this vocal-to-mix energy ratio the song is treated as instrumental
# (e.g. a trad tune) and the full mix is transcribed instead.
MIN_VOCAL_ENERGY_RATIO = 0.08
# Demucs reports progress with tqdm, e.g. " 45%|████   | 63.2/140.4 [00:51<01:02, ...]",
# counting seconds of audio.
_TQDM = re.compile(r"([\d.]+)/([\d.]+) \[")


def separation_available() -> bool:
    return importlib.util.find_spec("demucs") is not None


def isolate_vocals(
    wav: Path,
    workdir: Path,
    on_progress: Callable[[float], None] | None = None,
    cancelled: threading.Event | None = None,
) -> Path | None:
    """Return a WAV of the vocal stem, or None when the song has no real vocals.

    `on_progress` receives the seconds of audio separated so far. Setting
    `cancelled` stops Demucs.
    """
    outdir = workdir / "separated"
    cmd = [
        sys.executable, "-m", "demucs.separate",
        "--two-stems=vocals", "-n", "htdemucs", "-o", str(outdir), str(wav),
    ]
    proc = subprocess.Popen(
        cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    assert proc.stderr is not None
    tail = ""
    buffer = ""
    finished = False
    try:
        while True:
            chunk = proc.stderr.read1(4096).decode(errors="replace")  # type: ignore[attr-defined]
            if not chunk:
                finished = True
                break
            buffer += chunk
            *lines, buffer = re.split(r"[\r\n]", buffer)
            for line in lines:
                match = _TQDM.search(line)
                if match and on_progress:
                    on_progress(float(match.group(1)))
                elif line.strip():
                    tail = (tail + "\n" + line)[-500:]
            if cancelled is not None and cancelled.is_set():
                break
    finally:
        # Stop Demucs if we leave early (cancelled, or a callback raised).
        if not finished:
            proc.kill()
    proc.wait()
    if cancelled is not None and cancelled.is_set():
        return None
    vocals = outdir / "htdemucs" / wav.stem / "vocals.wav"
    if proc.returncode != 0 or not vocals.exists():
        raise RuntimeError(f"Demucs failed: {tail.strip()}")
    mix, _ = sf.read(wav, always_2d=True)
    voc, _ = sf.read(vocals, always_2d=True)
    mix_energy = float(np.mean(mix**2)) + 1e-12
    voc_energy = float(np.mean(voc**2))
    if voc_energy / mix_energy < MIN_VOCAL_ENERGY_RATIO:
        return None
    return vocals
