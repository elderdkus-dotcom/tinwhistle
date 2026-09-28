"""Download a song from YouTube as an MP3 into clips/, optionally trimmed, and
optionally commit and push it so it can be used as a test recording.

Run it with the project's Python (it uses yt-dlp and ffmpeg from the app's
packages), from the tinwhistle folder:

    Windows:     .venv\\Scripts\\python tools\\get_clip.py URL [options]
    Mac/Linux:   .venv/bin/python tools/get_clip.py URL [options]

Options:
    --start M:SS     start of the clip (default: the beginning)
    --length M:SS    length of the clip (default: to the end)
    --name NAME      file name without .mp3 (default: the video title)
    --push           also git add, commit and push the clip
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIPS = ROOT / "clips"
MAX_MB = 45  # GitHub rejects files over 100 MB; stay well below


def seconds(text: str) -> float:
    total = 0.0
    for part in text.strip().split(":"):
        total = total * 60 + float(part)
    return total


def ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def download(url: str, workdir: Path) -> tuple[Path, str]:
    import yt_dlp

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "download.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": ffmpeg(),
    }
    if shutil.which("node"):
        opts["js_runtimes"] = {"deno": {}, "node": {}}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    files = sorted(workdir.glob("download.*"))
    if not files:
        sys.exit("The download produced no file.")
    return files[0], (info or {}).get("title") or "clip"


def main() -> None:
    parser = argparse.ArgumentParser(description="Download a YouTube song as an MP3 test clip.")
    parser.add_argument("url")
    parser.add_argument("--start", default="0")
    parser.add_argument("--length", default="")
    parser.add_argument("--name", default="")
    parser.add_argument("--push", action="store_true")
    args = parser.parse_args()

    CLIPS.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        print("Downloading…", flush=True)
        try:
            src, title = download(args.url, Path(tmp))
        except Exception as exc:  # noqa: BLE001 - show the reason plainly
            sys.exit(f"Download failed: {exc}")
        name = re.sub(r"[^A-Za-z0-9._-]+", "-", args.name or title).strip("-")[:60] or "clip"
        out = CLIPS / f"{name}.mp3"
        cmd = [ffmpeg(), "-y", "-loglevel", "error", "-ss", str(seconds(args.start)), "-i", str(src)]
        if args.length:
            cmd += ["-t", str(seconds(args.length))]
        cmd += ["-vn", "-ac", "2", "-b:a", "192k", str(out)]
        print("Converting to MP3…", flush=True)
        if subprocess.run(cmd).returncode != 0:
            sys.exit("Converting to MP3 failed.")

    size_mb = out.stat().st_size / 1e6
    print(f"Saved {out.relative_to(ROOT)} ({size_mb:.1f} MB)")
    if size_mb > MAX_MB:
        sys.exit(f"That is too large to push; use --length to keep it under {MAX_MB} MB.")

    if args.push:
        rel = str(out.relative_to(ROOT))
        for cmd in (["git", "add", rel], ["git", "commit", "-m", f"Add test clip {out.name}"], ["git", "push"]):
            print("$", " ".join(cmd), flush=True)
            if subprocess.run(cmd, cwd=ROOT).returncode != 0:
                sys.exit("That git command failed; the clip is saved in the clips folder.")
        print("Pushed. Tell Claude the clip is up.")
    else:
        print("To share it: run again with --push, or git add / commit / push the file.")


if __name__ == "__main__":
    main()
