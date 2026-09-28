"""Step-by-step progress for an analysis job, with time estimates and cancellation.

Time left is estimated per step instead of from the overall percentage:
each step has a typical cost in seconds per second of song, and once a step
has been running for a while its real speed on this computer replaces the
guess (and scales the guesses for the steps still to come).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

# Seconds of work per second of song, measured on a 4-core laptop CPU. Only
# the ratios matter much: the machine's real speed is learned while running.
STEP_COSTS = {
    "decode": 0.003,
    "separate": 0.45,
    "beats": 0.02,
    "notes": 0.015,  # Basic Pitch; the pYIN voice tracker costs about 0.06
    "melody": 0.005,
    "learn": 0.0,
}

# Fixed start-up time (loading models), in seconds at the reference speed.
STEP_STARTUP = {"separate": 15.0, "notes": 1.0, "learn": 3.0}
# A step's own rate is trusted once it has done this much of its work.
MIN_FRACTION_FOR_RATE = 0.03
MIN_SECONDS_FOR_RATE = 3.0
# The machine's speed is only trusted from a step that covered this much work
# (seconds at the reference speed); before that the estimate is "unknown".
MIN_REFERENCE_FOR_SPEED = 5.0


class JobCancelled(Exception):
    """Raised inside the pipeline when the user cancels the job."""


@dataclass
class Step:
    key: str
    label: str
    state: str = "pending"  # pending | active | done
    done: float | None = None
    total: float | None = None
    unit: str = ""
    started: float | None = None
    finished: float | None = None
    # Time from starting the step to its first progress report (model loading).
    first_report: float | None = None
    cost: float | None = None
    startup: float = 0.0

    def expected(self, song_seconds: float, speed: float) -> float:
        """Predicted duration of the whole step, in seconds."""
        return ((self.cost or 0.0) * song_seconds + self.startup) * speed

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
    song_seconds: float | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    clock: object = time.monotonic  # replaceable in tests

    def now(self) -> float:
        return self.clock()  # type: ignore[operator]

    def plan(
        self,
        steps: list[tuple[str, str]],
        costs: dict[str, float] | None = None,
        startup: dict[str, float] | None = None,
    ) -> None:
        """Set the steps; `costs`/`startup` override the defaults for this job."""
        costs = {**STEP_COSTS, **(costs or {})}
        startup = {**STEP_STARTUP, **(startup or {})}
        with self.lock:
            self.steps = [
                Step(key, label, cost=costs.get(key), startup=startup.get(key, 0.0)) for key, label in steps
            ]
            self.started = self.now()

    def _step(self, key: str) -> Step:
        return next(s for s in self.steps if s.key == key)

    def check(self) -> None:
        if self.cancelled.is_set():
            raise JobCancelled()

    def set_song_length(self, seconds: float) -> None:
        with self.lock:
            self.song_seconds = seconds

    def start(self, key: str) -> None:
        self.check()
        now = self.now()
        with self.lock:
            for s in self.steps:
                if s.state == "active":
                    s.state, s.finished = "done", now
            step = self._step(key)
            step.state, step.started = "active", now

    def update(self, key: str, done: float, total: float, unit: str = "s") -> None:
        """Report `done` out of `total` (e.g. seconds of the song) for a step."""
        self.check()
        now = self.now()
        with self.lock:
            s = self._step(key)
            if s.first_report is None and s.started is not None:
                s.first_report = now - s.started
            s.done, s.total, s.unit = done, total, unit

    def finish_all(self) -> None:
        now = self.now()
        with self.lock:
            for s in self.steps:
                if s.state != "done":
                    s.state, s.finished = "done", now

    @property
    def label(self) -> str:
        with self.lock:
            active = [s for s in self.steps if s.state == "active"]
            return active[0].label if active else ""

    # --- estimates (call with the lock held) ---------------------------------

    def _own_rate_remaining(self, s: Step, now: float) -> float | None:
        """Time left for an active step from its own progress so far."""
        if s.done is None or not s.total or s.started is None or s.done <= 0:
            return None
        # Measure from the first report so model loading does not skew the rate.
        base = s.started + (s.first_report or 0.0)
        working = now - base
        fraction = s.done / s.total
        if fraction < MIN_FRACTION_FOR_RATE or working < MIN_SECONDS_FOR_RATE:
            return None
        return working * (s.total - s.done) / s.done

    def _speed(self, now: float) -> float | None:
        """How slow this computer is compared to the reference (1.0 = same).

        None until a step has done enough work to measure it.
        """
        song = self.song_seconds
        if not song:
            return None
        best: tuple[float, float] | None = None  # (reference seconds measured, speed)
        for s in self.steps:
            if s.cost is None or s.started is None:
                continue
            if s.state == "done" and s.finished is not None:
                ref = s.expected(song, 1.0)
                took = s.finished - s.started
            elif s.state == "active" and s.done and s.total and s.done / s.total >= MIN_FRACTION_FOR_RATE:
                ref = (s.cost * s.done)
                took = now - s.started - (s.first_report or 0.0)
            else:
                continue
            # Trust the step that covered the most work.
            if ref >= MIN_REFERENCE_FOR_SPEED and (best is None or ref > best[0]):
                best = (ref, took / ref)
        return max(best[1], 0.05) if best else None

    def remaining(self) -> float | None:
        """Estimated seconds until the job is done, or None while unknown."""
        now = self.now()
        with self.lock:
            song = self.song_seconds
            if song is None:
                return None  # still downloading/reading: length unknown
            measured = self._speed(now)
            speed = measured or 1.0
            left = 0.0
            for s in self.steps:
                if s.state == "done" or s.cost is None:
                    continue
                if s.state == "active":
                    own = self._own_rate_remaining(s, now)
                    if own is None and measured is None and s.expected(song, 1.0) >= MIN_REFERENCE_FOR_SPEED:
                        return None  # a long step has just started; no basis for a guess yet
                    if own is None:
                        spent = now - (s.started or now)
                        own = max(s.expected(song, speed) - spent, 0.0)
                    left += own
                else:
                    left += s.expected(song, speed)
            return left

    def to_json(self) -> dict:
        remaining = self.remaining()
        with self.lock:
            steps = [s.to_json() for s in self.steps]
            elapsed = self.now() - self.started if self.started is not None else 0.0
            all_done = bool(self.steps) and all(s.state == "done" for s in self.steps)
        if all_done:
            progress = 1.0
        elif remaining is None or elapsed + remaining <= 0:
            progress = 0.0
        else:
            # The bar shows time, so it moves steadily and agrees with "time left".
            progress = elapsed / (elapsed + remaining)
        return {
            "steps": steps,
            "elapsed": round(elapsed, 1),
            "remaining": None if remaining is None else round(remaining, 1),
            "progress": round(min(progress, 0.99 if not all_done else 1.0), 3),
        }
