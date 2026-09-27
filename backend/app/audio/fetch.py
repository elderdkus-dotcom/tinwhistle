"""Getting audio in: YouTube downloads and decoding any input to a WAV file."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Callable

import imageio_ffmpeg

SAMPLE_RATE = 22050
MAX_DOWNLOAD_SECONDS = 20 * 60


class AudioError(RuntimeError):
    """A user-facing problem with the input audio."""


def ffmpeg_exe() -> str:
    return shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()


def download_youtube(
    url: str, workdir: Path, on_progress: Callable[[float, float], None] | None = None
) -> tuple[Path, str]:
    """Download the audio track of a YouTube (or other yt-dlp supported) URL.

    Returns the downloaded file and the video title. `on_progress` receives
    (megabytes downloaded, total megabytes).
    """
    import yt_dlp

    def hook(d: dict) -> None:
        if on_progress and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            on_progress(d.get("downloaded_bytes", 0) / 1e6, total / 1e6)

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "download.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": ffmpeg_exe(),
        "progress_hooks": [hook],
    }
    if shutil.which("node"):
        # yt-dlp needs a JS runtime for YouTube; it only enables deno by default.
        opts["js_runtimes"] = {"deno": {}, "node": {}}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info is None:
                raise AudioError("Could not find a video at that link.")
            if (info.get("duration") or 0) > MAX_DOWNLOAD_SECONDS:
                raise AudioError("That video is longer than 20 minutes; please pick a single song.")
            ydl.process_ie_result(info, download=True)
    except yt_dlp.utils.DownloadError as exc:
        raise AudioError(f"Could not download that link: {exc}") from exc
    files = sorted(workdir.glob("download.*"))
    if not files:
        raise AudioError("The download finished but produced no audio file.")
    return files[0], info.get("title") or ""


def to_wav(src: Path, dst: Path, start: float = 0.0, duration: float | None = None) -> Path:
    """Decode any audio/video file to mono 22.05 kHz WAV, optionally trimmed."""
    cmd = [ffmpeg_exe(), "-y", "-nostdin", "-loglevel", "error"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src)]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", str(dst)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not dst.exists() or dst.stat().st_size <= 44:
        detail = result.stderr.strip().splitlines()[-1:] or ["no audio stream found"]
        raise AudioError(f"Could not read the audio: {detail[0]}")
    return dst
