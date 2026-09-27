"""One-step launcher: installs what is missing, builds the web app, starts the server.

Run it through start.bat (Windows) or start.command (Mac/Linux), which make
sure it runs inside the project's .venv. Options:
  --port N            use another port (default 8000)
  --with-separation   also install vocal separation (Demucs, large download)
  --no-browser        do not open the browser
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
STAMP = ROOT / ".venv" / ".tinwhistle-installed"


def say(message: str) -> None:
    print(f"\n==> {message}", flush=True)


def fail(message: str) -> None:
    print(f"\nERROR: {message}", flush=True)
    sys.exit(1)


def run(cmd: list[str], cwd: Path = ROOT) -> None:
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        fail(f"This command failed: {' '.join(cmd)}")


def pip(*args: str) -> None:
    run([sys.executable, "-m", "pip", *args])


def requirements_hash(with_separation: bool) -> str:
    h = hashlib.sha256()
    for name in ("requirements.txt", "requirements-dev.txt", "requirements-separation.txt"):
        h.update((BACKEND / name).read_bytes())
    h.update(str(with_separation).encode())
    h.update(sys.version.encode())
    return h.hexdigest()


def install_python_packages(with_separation: bool) -> None:
    """Install backend packages when they are missing or the requirements changed."""
    wanted = requirements_hash(with_separation)
    if STAMP.exists() and STAMP.read_text().strip() == wanted:
        return
    say("Installing Python packages (first run or after an update; this can take a few minutes)")
    pip("install", "--upgrade", "pip")
    pip("install", "-r", str(BACKEND / "requirements-dev.txt"))
    # basic-pitch pins an old TensorFlow; we run its ONNX model instead.
    pip("install", "--no-deps", "basic-pitch==0.4.0")
    if with_separation:
        say("Installing vocal separation (Demucs); this is a large download")
        pip("install", "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cpu")
        pip("install", "-r", str(BACKEND / "requirements-separation.txt"))
    STAMP.write_text(wanted)


def newest_mtime(paths: list[Path]) -> float:
    newest = 0.0
    for p in paths:
        files = [p] if p.is_file() else [f for f in p.rglob("*") if f.is_file()]
        for f in files:
            newest = max(newest, f.stat().st_mtime)
    return newest


def build_frontend() -> None:
    """Build the web app when it has never been built or its source changed."""
    built = FRONTEND / "dist" / "index.html"
    sources = [FRONTEND / "src", FRONTEND / "public", FRONTEND / "index.html", FRONTEND / "package.json"]
    if built.exists() and built.stat().st_mtime >= newest_mtime(sources):
        return
    npm = shutil.which("npm")
    if npm is None:
        fail("Node.js is not installed. Get it from https://nodejs.org and run this again.")
    say("Building the web app")
    if not (FRONTEND / "node_modules").exists() or (
        (FRONTEND / "package.json").stat().st_mtime > (FRONTEND / "node_modules").stat().st_mtime
    ):
        run([npm, "install"], cwd=FRONTEND)
    run([npm, "run", "build"], cwd=FRONTEND)


def already_running(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=1) as res:
            return bool(json.load(res).get("ok"))
    except Exception:  # noqa: BLE001 - anything means "not our server"
        return False


def open_when_ready(url: str) -> None:
    for _ in range(120):
        if already_running(url):
            webbrowser.open(url)
            return
        time.sleep(0.5)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--with-separation", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if sys.version_info < (3, 10):
        fail(f"Python 3.10 or newer is needed (this is {sys.version.split()[0]}).")
    url = f"http://localhost:{args.port}"

    if already_running(url):
        say(f"Tin Whistle Scores is already running at {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return

    # Keep vocal separation if it was installed before.
    with_separation = args.with_separation or importlib.util.find_spec("demucs") is not None
    install_python_packages(with_separation)
    build_frontend()

    say(f"Starting Tin Whistle Scores at {url}")
    print("    Leave this window open while you use the app. Press Ctrl+C to stop it.", flush=True)
    if not with_separation:
        print(
            "    Tip: for better results on songs with a band, run the starter once with\n"
            "    --with-separation to install vocal separation.",
            flush=True,
        )
    if not args.no_browser:
        threading.Thread(target=open_when_ready, args=(url,), daemon=True).start()

    sys.path.insert(0, str(BACKEND))
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, app_dir=str(BACKEND), log_level="warning")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
