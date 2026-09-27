"""The full song-to-melody analysis, run as a background job."""

from __future__ import annotations

import shutil
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from app.audio import fetch, separate, transcribe
from app.music import key, melody, rhythm
from app.music.model import Melody
from app.progress import JobCancelled, Progress

MAX_SECONDS = 6 * 60
MAX_KEPT_JOBS = 20


@dataclass
class JobInput:
    url: str | None = None
    upload: Path | None = None
    upload_name: str = ""
    start: float = 0.0
    duration: float | None = None
    separate: bool = True
    beats_per_measure: int = 4


@dataclass
class Job:
    id: str
    workdir: Path
    status: str = "queued"  # queued | running | done | error | cancelled
    error: str = ""
    result: dict | None = None
    audio: Path | None = None
    progress: Progress = field(default_factory=Progress)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def to_json(self, queue_position: int = 0) -> dict:
        with self.lock:
            data = {
                "id": self.id,
                "status": self.status,
                "error": self.error,
                "result": self.result,
                "queuePosition": queue_position,
            }
        data.update(self.progress.to_json())
        data["stage"] = self.progress.label or ("Waiting for another song to finish" if queue_position else "")
        if data["status"] == "done":
            data["progress"] = 1.0
        return data


def plan_steps(inp: JobInput) -> list[tuple[str, str, float]]:
    """The steps this job will go through, weighted by typical running time."""
    steps = []
    if inp.url:
        steps.append(("download", "Downloading the song", 8))
    steps.append(("decode", "Reading the audio", 2))
    if inp.separate and separate.separation_available():
        steps.append(("separate", "Separating the vocals from the band", 45))
    steps += [
        ("beats", "Finding the beat and bar lines", 5),
        ("notes", "Listening for notes", 30),
        ("melody", "Following the melody", 10),
    ]
    return steps


def analyze(inp: JobInput, workdir: Path, progress: Progress) -> tuple[Melody, Path]:
    """Run every step; returns the melody and the decoded WAV of the song."""
    import librosa

    progress.plan(plan_steps(inp))
    title = Path(inp.upload_name).stem if inp.upload_name else ""
    if inp.url:
        progress.start("download")
        src, title = fetch.download_youtube(
            inp.url, workdir, lambda done, total: progress.update("download", done, total, "MB")
        )
    elif inp.upload:
        src = inp.upload
    else:
        raise fetch.AudioError("Please upload a file or paste a link.")

    progress.start("decode")
    duration = min(inp.duration or MAX_SECONDS, MAX_SECONDS)
    wav = fetch.to_wav(src, workdir / "song.wav", start=inp.start, duration=duration)
    y, sr = librosa.load(wav, sr=fetch.SAMPLE_RATE, mono=True)
    length = len(y) / sr
    progress.update("decode", length, length)
    warnings: list[str] = []
    if length >= MAX_SECONDS - 0.5:
        warnings.append(f"Only the first {MAX_SECONDS // 60} minutes were analyzed.")

    melody_src, isolated = wav, False
    if inp.separate and separate.separation_available():
        progress.start("separate")
        vocals = separate.isolate_vocals(
            wav, workdir, lambda done: progress.update("separate", min(done, length), length), progress.cancelled
        )
        progress.check()
        if vocals is not None:
            melody_src, isolated = vocals, True
        else:
            warnings.append("No clear vocals found, so the melody was taken from the full mix.")
    elif inp.separate:
        warnings.append(
            "Vocal separation is not installed on the server; the melody was taken "
            "from the full mix and may be less accurate."
        )

    progress.start("beats")
    tempo, beats = rhythm.track_beats(y, sr)
    progress.update("beats", 1, 2)
    evidence = rhythm.downbeat_evidence(y, sr, beats)

    progress.start("notes")
    events = transcribe.transcribe(
        melody_src, isolated=isolated, on_progress=lambda done: progress.update("notes", min(done, length), length)
    )

    progress.start("melody")
    line = melody.extract_melody(events, on_progress=lambda done: progress.update("melody", min(done, length), length))
    notes = rhythm.quantize(line, beats)
    notes = rhythm.align_to_measures(notes, inp.beats_per_measure, evidence)
    if not notes:
        warnings.append("No melody could be detected in this audio.")
    progress.finish_all()

    result = Melody(
        tempo=tempo,
        beats_per_measure=inp.beats_per_measure,
        key=key.estimate_key(notes),
        notes=notes,
        duration_seconds=length,
        title=title,
        separated=isolated,
        warnings=warnings,
    )
    return result, wav


class JobRunner:
    """Runs analyses one at a time (they are CPU bound) and keeps their state."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(tempfile.mkdtemp(prefix="tinwhistle-"))
        self.jobs: dict[str, Job] = {}
        self.pool = ThreadPoolExecutor(max_workers=1)
        self.analyze = analyze

    def new_workdir(self) -> tuple[str, Path]:
        job_id = uuid.uuid4().hex
        workdir = self.root / job_id
        workdir.mkdir(parents=True)
        return job_id, workdir

    def submit(self, job_id: str, workdir: Path, inp: JobInput) -> Job:
        job = Job(id=job_id, workdir=workdir)
        self.jobs[job_id] = job
        self._evict_old()
        self.pool.submit(self._run, job, inp)
        return job

    def queue_position(self, job: Job) -> int:
        """How many jobs must finish before this one starts (0 when running)."""
        if job.status != "queued":
            return 0
        ahead = [j for j in self.jobs.values() if j.status in ("queued", "running")]
        return ahead.index(job)

    def cancel(self, job: Job) -> None:
        job.progress.cancelled.set()
        with job.lock:
            if job.status == "queued":
                job.status = "cancelled"

    def _evict_old(self) -> None:
        finished = [j for j in self.jobs.values() if j.status in ("done", "error", "cancelled")]
        for old in finished[: max(0, len(self.jobs) - MAX_KEPT_JOBS)]:
            del self.jobs[old.id]
            shutil.rmtree(old.workdir, ignore_errors=True)

    def _run(self, job: Job, inp: JobInput) -> None:
        with job.lock:
            if job.status == "cancelled":
                shutil.rmtree(job.workdir, ignore_errors=True)
                return
            job.status = "running"
        try:
            melody_result, wav = self.analyze(inp, job.workdir, job.progress)
            with job.lock:
                job.result = melody_result.to_json()
                job.audio = wav
                job.status = "done"
        except JobCancelled:
            with job.lock:
                job.status = "cancelled"
            shutil.rmtree(job.workdir, ignore_errors=True)
        except fetch.AudioError as exc:
            self._fail(job, str(exc))
        except Exception as exc:  # noqa: BLE001 - report anything to the client
            self._fail(job, f"Analysis failed: {exc}")

    def _fail(self, job: Job, message: str) -> None:
        with job.lock:
            # A cancel can surface as another error (e.g. inside yt-dlp).
            if job.progress.cancelled.is_set():
                job.status = "cancelled"
            else:
                job.status, job.error = "error", message
        shutil.rmtree(job.workdir, ignore_errors=True)
