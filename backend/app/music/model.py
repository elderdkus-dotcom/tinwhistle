"""Plain data types shared by the analysis pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class NoteEvent:
    """A note in real time, as produced by transcription."""

    start: float  # seconds
    end: float  # seconds
    pitch: int  # MIDI note number
    amplitude: float = 1.0


@dataclass
class BeatNote:
    """A note in musical time, quantized to the beat grid."""

    pitch: int  # MIDI note number, as sung/played in the original
    start: float  # beats from the start of the first measure
    duration: float  # beats

    def end(self) -> float:
        return self.start + self.duration


@dataclass
class Melody:
    """The analysis result sent to the client.

    The client arranges this for the whistle (transposition, difficulty
    levels), so it can switch levels and edit without another round trip.
    """

    tempo: float
    beats_per_measure: int
    key: str  # e.g. "G major", informational only
    notes: list[BeatNote]
    duration_seconds: float
    title: str = ""
    separated: bool = False
    warnings: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "tempo": round(self.tempo, 2),
            "beatsPerMeasure": self.beats_per_measure,
            "key": self.key,
            "notes": [asdict(n) for n in self.notes],
            "durationSeconds": round(self.duration_seconds, 2),
            "title": self.title,
            "separated": self.separated,
            "warnings": self.warnings,
        }
