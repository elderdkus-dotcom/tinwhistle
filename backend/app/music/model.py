"""Plain data types shared by the analysis pipeline."""

from __future__ import annotations

from dataclasses import dataclass


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
    time: float = 0.0  # where the note was heard in the song, seconds
    time_end: float = 0.0

    def end(self) -> float:
        return self.start + self.duration
