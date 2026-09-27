"""Step-by-step progress for an analysis job, with cancellation."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


class JobCancelled(Exception):
    """Raised inside the pipeline when the user cancels the job."""


@dataclass
class Step:
    key: str
    label: str
    weight: float
    state: str = "pending"  # pending | active | done
    fraction: float = 0.0
    done: float | None = None
    total: float | None = None
    unit: str = ""

    def to_json(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "state": self.state,
            "done": None if self.done is None else round(self.done, 1),
            "total": None if self.total is None else round(self.total, 1),
            "unit": self.unit,
        }


@dataclass
class Progress:
    """Tracks the job's steps. Updates come from the worker thread; reads from requests."""

    steps: list[Step] = field(default_factory=list)
    started: float | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def plan(self, steps: list[tuple[str, str, float]]) -> None:
        with self.lock:
            self.steps = [Step(key, label, weight) for key, label, weight in steps]
            self.started = time.monotonic()

    def _step(self, key: str) -> Step:
        return next(s for s in self.steps if s.key == key)

    def check(self) -> None:
        if self.cancelled.is_set():
            raise JobCancelled()

    def start(self, key: str) -> None:
        self.check()
        with self.lock:
            for s in self.steps:
                if s.state == "active":
                    s.state, s.fraction = "done", 1.0
            self._step(key).state = "active"

    def update(
        self, key: str, done: float, total: float, unit: str = "s"
    ) -> None:
        """Report `done` out of `total` (e.g. seconds of the song) for a step."""
        self.check()
        with self.lock:
            s = self._step(key)
            s.done, s.total, s.unit = done, total, unit
            s.fraction = min(1.0, done / total) if total > 0 else 0.0

    def finish_all(self) -> None:
        with self.lock:
            for s in self.steps:
                s.state, s.fraction = "done", 1.0

    @property
    def label(self) -> str:
        with self.lock:
            active = [s for s in self.steps if s.state == "active"]
            return active[0].label if active else ""

    def overall(self) -> float:
        with self.lock:
            total = sum(s.weight for s in self.steps) or 1.0
            return sum(s.weight * (1.0 if s.state == "done" else s.fraction) for s in self.steps) / total

    def to_json(self) -> dict:
        with self.lock:
            steps = [s.to_json() for s in self.steps]
            elapsed = time.monotonic() - self.started if self.started else 0.0
        return {"steps": steps, "elapsed": round(elapsed, 1), "progress": round(self.overall(), 3)}
