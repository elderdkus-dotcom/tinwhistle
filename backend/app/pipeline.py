"""The full song-to-melody analysis, run as a background job."""

from __future__ import annotations

import shutil
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from app.audio import fetch, separate, transcribe
from app.music import key, melody, rhythm
from app.music.model import Melody

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
    status: str = "queued"  # queued | running | done | error
    stage: str = "Waiting in line"
    progress: float = 0.0
    error: str = ""
    result: dict | None = None
    audio: Path | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def update(self, stage: str, progress: float) -> None:
        with self.lock:
            self.stage, self.progress = stage, progress

    def to_json(self) -> dict:
        with self.lock:
            return {
                "id": self.id,
                "status": self.status,
                "stage": self.stage,
                "progress": round(self.progress, 3),
                "error": self.error,
                "result": self.result,
            }


def analyze(inp: JobInput, workdir: Path, report: Callable[[str, float], None]) -> tuple[Melody, Path]:
    """Run every step; returns the melody and the decoded WAV of the song."""
    import librosa

    title = Path(inp.upload_name).stem if inp.upload_name else ""
    if inp.url:
        report("Downloading audio", 0.05)
        src, title = fetch.download_youtube(inp.url, workdir)
    elif inp.upload:
        src = inp.upload
    else:
        raise fetch.AudioError("Please upload a file or paste a link.")

    report("Decoding audio", 0.15)
    duration = min(inp.duration or MAX_SECONDS, MAX_SECONDS)
    wav = fetch.to_wav(src, workdir / "song.wav", start=inp.start, duration=duration)
    y, sr = librosa.load(wav, sr=fetch.SAMPLE_RATE, mono=True)
    length = len(y) / sr
    warnings: list[str] = []
    if length >= MAX_SECONDS - 0.5:
        warnings.append(f"Only the first {MAX_SECONDS // 60} minutes were analyzed.")

    melody_src, isolated = wav, False
    if inp.separate and separate.separation_available():
        report("Separating the vocals from the band", 0.25)
        vocals = separate.isolate_vocals(wav, workdir)
        if vocals is not None:
            melody_src, isolated = vocals, True
        else:
            warnings.append("No clear vocals found, so the melody was taken from the full mix.")
    elif inp.separate:
        warnings.append(
            "Vocal separation is not installed on the server; the melody was taken "
            "from the full mix and may be less accurate."
        )

    report("Finding the beat", 0.6)
    tempo, beats = rhythm.track_beats(y, sr)

    report("Listening for notes", 0.7)
    events = transcribe.transcribe(melody_src, isolated=isolated)

    report("Following the melody", 0.9)
    line = melody.extract_melody(events)
    notes = rhythm.quantize(line, beats)
    evidence = rhythm.downbeat_evidence(y, sr, beats)
    notes = rhythm.align_to_measures(notes, inp.beats_per_measure, evidence)
    if not notes:
        warnings.append("No melody could be detected in this audio.")

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

    def _evict_old(self) -> None:
        finished = [j for j in self.jobs.values() if j.status in ("done", "error")]
        for old in finished[: max(0, len(self.jobs) - MAX_KEPT_JOBS)]:
            del self.jobs[old.id]
            shutil.rmtree(old.workdir, ignore_errors=True)

    def _run(self, job: Job, inp: JobInput) -> None:
        with job.lock:
            job.status = "running"
        try:
            melody_result, wav = self.analyze(inp, job.workdir, job.update)
            with job.lock:
                job.result = melody_result.to_json()
                job.audio = wav
                job.status, job.stage, job.progress = "done", "Done", 1.0
        except fetch.AudioError as exc:
            self._fail(job, str(exc))
        except Exception as exc:  # noqa: BLE001 - report anything to the client
            self._fail(job, f"Analysis failed: {exc}")

    def _fail(self, job: Job, message: str) -> None:
        with job.lock:
            job.status, job.error = "error", message
        shutil.rmtree(job.workdir, ignore_errors=True)
