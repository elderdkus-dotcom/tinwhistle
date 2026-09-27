"""Songs are loaded once, then scored one part at a time.

Loading downloads and decodes the song and finds its beat grid and bar
lines. Every part is then quantized onto that same grid, so parts line up
into one continuous score, and each note remembers where it was heard in
the song so the app can highlight it during playback.
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

from app.audio import fetch, separate, transcribe, voice
from app.music import melody, rhythm
from app.progress import Progress

MAX_SONG_SECONDS = 20 * 60
MAX_PART_SECONDS = 150
MIN_PART_SECONDS = 1.0
MAX_SONGS_KEPT = 5
# Audio analyzed around a part so notes at its edges are heard whole.
CONTEXT_BEFORE = 1.0
CONTEXT_AFTER = 1.5
VOICE_COST = 0.06  # pYIN, seconds of work per second of audio (reference speed)


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


def analyze_part(song: Song, start: float, end: float, isolate: bool, progress: Progress) -> dict:
    """Transcribe the melody between `start` and `end` seconds of the song."""
    start = max(0.0, start)
    end = min(song.duration, end)
    if end - start < MIN_PART_SECONDS:
        raise fetch.AudioError("That part is too short; let the song play a little further.")
    if end - start > MAX_PART_SECONDS:
        raise fetch.AudioError(
            f"Parts can be at most {MAX_PART_SECONDS // 60} minutes and {MAX_PART_SECONDS % 60} seconds; "
            "stop the song a bit earlier."
        )

    use_separation = isolate and separate.separation_available()
    steps = [("notes", "Listening for notes"), ("melody", "Following the melody")]
    if use_separation:
        steps.insert(0, ("separate", "Separating the vocals from the band"))
    progress.plan(
        steps,
        costs={"notes": VOICE_COST} if use_separation else None,
        startup={"separate": 0.0 if separate.model_loaded() else 15.0},
    )

    clip_start = max(0.0, start - CONTEXT_BEFORE)
    clip_end = min(song.duration, end + CONTEXT_AFTER)
    clip = song.y[int(clip_start * song.sr) : int(clip_end * song.sr)]
    clip_len = len(clip) / song.sr
    progress.set_song_length(clip_len)
    warnings: list[str] = []

    vocals = None
    if use_separation:
        progress.start("separate")
        try:
            vocals = separate.isolate_vocals(
                clip, song.sr, lambda done: progress.update("separate", done, clip_len), progress.cancelled
            )
        except separate.SeparationCancelled:
            progress.check()
            raise
        if vocals is None:
            warnings.append("No singing found in this part, so the melody was taken from the whole band.")
    elif isolate:
        warnings.append("Vocal separation is not installed, so the melody was taken from the whole band.")

    progress.start("notes")
    report = lambda done: progress.update("notes", min(done, clip_len), clip_len)  # noqa: E731
    if vocals is not None:
        events = voice.transcribe_voice(vocals, song.sr, report)
    else:
        events = transcribe.transcribe(clip, song.sr, isolated=False, on_progress=report)

    progress.start("melody")
    line = melody.extract_melody(events, lambda done: progress.update("melody", min(done, clip_len), clip_len))
    for n in line:
        n.start += clip_start
        n.end += clip_start
    # Only notes that begin inside the part; the context is just for hearing them whole.
    line = [n for n in line if start <= n.start < end]
    notes = rhythm.quantize(line, song.beats)
    if not notes:
        warnings.append("No melody was found in this part.")
    progress.finish_all()
    return {
        "start": start,
        "end": end,
        "separated": vocals is not None,
        "warnings": warnings,
        "notes": [
            {
                "pitch": n.pitch,
                "start": round(n.start - song.origin, 4),
                "duration": n.duration,
                "time": round(n.time, 3),
                "timeEnd": round(n.time_end, 3),
            }
            for n in notes
        ],
    }
