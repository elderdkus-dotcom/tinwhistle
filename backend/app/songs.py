"""Loading a song to write a score against.

Loading downloads (or takes the upload / recording), decodes it and finds
its beat grid and bar lines. The user then writes the score while the song
plays; the beat grid maps between song time and score position, so the
score can follow the music and new notes land on the right beat.
"""

from __future__ import annotations

import shutil
import tempfile
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.audio import fetch
from app.music import rhythm
from app.progress import Progress

MAX_SONG_SECONDS = 20 * 60
MAX_SONGS_KEPT = 5


@dataclass
class SongInput:
    url: str | None = None
    upload: Path | None = None
    upload_name: str = ""
    beats_per_measure: int = 4


@dataclass
class Song:
    id: str
    workdir: Path
    title: str
    y: np.ndarray
    sr: int
    tempo: float
    beats: np.ndarray  # beat times, seconds
    beats_per_measure: int
    origin: float  # beat index of score position 0 (a downbeat)

    @property
    def duration(self) -> float:
        return len(self.y) / self.sr

    @property
    def audio_path(self) -> Path:
        return self.workdir / "song.wav"

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "duration": round(self.duration, 3),
            "tempo": round(self.tempo, 2),
            "beatsPerMeasure": self.beats_per_measure,
            "beats": [round(float(b), 4) for b in self.beats],
            "origin": self.origin,
        }


class SongStore:
    """Keeps the few most recent songs in memory (with their audio on disk)."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(tempfile.mkdtemp(prefix="tinwhistle-"))
        self.songs: OrderedDict[str, Song] = OrderedDict()
        self.lock = threading.Lock()

    def new_workdir(self) -> tuple[str, Path]:
        song_id = uuid.uuid4().hex
        workdir = self.root / song_id
        workdir.mkdir(parents=True)
        return song_id, workdir

    def add(self, song: Song) -> None:
        with self.lock:
            self.songs[song.id] = song
            while len(self.songs) > MAX_SONGS_KEPT:
                _, old = self.songs.popitem(last=False)
                shutil.rmtree(old.workdir, ignore_errors=True)

    def get(self, song_id: str) -> Song | None:
        with self.lock:
            song = self.songs.get(song_id)
            if song is not None:
                self.songs.move_to_end(song_id)
            return song


def load_song(song_id: str, workdir: Path, inp: SongInput, progress: Progress) -> Song:
    """Download/decode the song and find its beats and bar lines."""
    import librosa

    steps = [("decode", "Reading the audio"), ("beats", "Finding the beat and bar lines")]
    if inp.url:
        steps.insert(0, ("download", "Downloading the song"))
    progress.plan(steps)

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
    wav = fetch.to_wav(src, workdir / "song.wav", duration=MAX_SONG_SECONDS)
    y, sr = librosa.load(wav, sr=fetch.SAMPLE_RATE, mono=True)
    length = len(y) / sr
    progress.set_song_length(length)
    progress.update("decode", length, length)
    if src != wav:
        src.unlink(missing_ok=True)  # keep only the decoded copy

    progress.start("beats")
    tempo, beats = rhythm.track_beats(y, sr)
    progress.update("beats", length / 2, length)
    evidence = rhythm.downbeat_evidence(y, sr, beats)
    phase = rhythm.downbeat_phase(evidence, inp.beats_per_measure)
    origin = rhythm.score_origin(beats, inp.beats_per_measure, phase)
    progress.finish_all()
    return Song(
        id=song_id,
        workdir=workdir,
        title=title,
        y=y,
        sr=sr,
        tempo=tempo,
        beats=beats,
        beats_per_measure=inp.beats_per_measure,
        origin=origin,
    )
