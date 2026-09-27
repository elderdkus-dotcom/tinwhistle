"""Background jobs with progress, run one at a time (they are CPU bound)."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable

from app.audio.fetch import AudioError
from app.progress import JobCancelled, Progress

MAX_KEPT_JOBS = 50

Work = Callable[[Progress], dict]


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | done | error | cancelled
    error: str = ""
    result: dict | None = None
    progress: Progress = field(default_factory=Progress)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def to_json(self, queue_position: int = 0) -> dict:
        with self.lock:
            data = {
                "id": self.id,
                "kind": self.kind,
                "status": self.status,
                "error": self.error,
                "result": self.result,
                "queuePosition": queue_position,
            }
        data.update(self.progress.to_json())
        data["stage"] = self.progress.label or ("Waiting for another job to finish" if queue_position else "")
        if data["status"] == "done":
            data["progress"] = 1.0
        return data


class JobRunner:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.pool = ThreadPoolExecutor(max_workers=1)

    def submit(self, kind: str, work: Work, on_finish: Callable[[Job], None] | None = None) -> Job:
        job = Job(id=uuid.uuid4().hex, kind=kind)
        self.jobs[job.id] = job
        self._evict_old()
        self.pool.submit(self._run, job, work, on_finish)
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

    def _run(self, job: Job, work: Work, on_finish: Callable[[Job], None] | None) -> None:
        with job.lock:
            if job.status == "cancelled":
                return
            job.status = "running"
        try:
            result = work(job.progress)
            with job.lock:
                job.result, job.status = result, "done"
        except JobCancelled:
            with job.lock:
                job.status = "cancelled"
        except AudioError as exc:
            self._fail(job, str(exc))
        except Exception as exc:  # noqa: BLE001 - report anything to the client
            self._fail(job, f"Analysis failed: {exc}")
        if on_finish:
            on_finish(job)

    def _fail(self, job: Job, message: str) -> None:
        with job.lock:
            # A cancel can surface as another error (e.g. inside yt-dlp).
            if job.progress.cancelled.is_set():
                job.status = "cancelled"
            else:
                job.status, job.error = "error", message
