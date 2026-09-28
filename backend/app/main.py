"""HTTP API.

1. POST /api/songs loads a song (upload or link) and finds its beat grid.
2. POST /api/songs/{id}/parts scores the melody between two times.
Both return a job to poll at /api/jobs/{id} (DELETE cancels it).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.audio.profile import Example
from app.audio.separate import separation_available
from app.jobs import Job, JobRunner
from app.songs import SOURCES, SongInput, SongStore, analyze_part, load_song

MAX_UPLOAD_BYTES = 60 * 1024 * 1024
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

app = FastAPI(title="Tin Whistle Scores")
# The client may run from a phone app shell or a dev server on another port.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
runner = JobRunner()
songs = SongStore()


def job_json(job: Job) -> dict:
    return job.to_json(runner.queue_position(job))


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "separation": separation_available()}


@app.post("/api/songs")
async def create_song(
    file: UploadFile | None = File(None),
    url: str = Form(""),
    beats_per_measure: int = Form(4),
) -> dict:
    url = url.strip()
    if not url and file is None:
        raise HTTPException(400, "Upload an audio file or paste a YouTube link.")
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(400, "The link must start with http:// or https://")
    if beats_per_measure not in (2, 3, 4):
        raise HTTPException(400, "Beats per measure must be 2, 3 or 4.")

    song_id, workdir = songs.new_workdir()
    inp = SongInput(url=url or None, beats_per_measure=beats_per_measure)
    if file is not None and not url:
        suffix = Path(file.filename or "upload").suffix[:10]
        dest = workdir / f"upload{suffix}"
        size = 0
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "The file is larger than 60 MB.")
                out.write(chunk)
        inp.upload, inp.upload_name = dest, file.filename or ""

    def work(progress):
        song = load_song(song_id, workdir, inp, progress)
        songs.add(song)
        return {"song": song.to_json()}

    return job_json(runner.submit("song", work))


class ExampleNote(BaseModel):
    """A note the user marked: the sound to catch (wanted) or to ignore."""

    time: float
    end: float
    pitch: int  # MIDI, as heard in the song
    wanted: bool


class PartRequest(BaseModel):
    start: float
    end: float
    # Which instrument carries the melody: voice | whistle | flute | instrument | mix
    source: str = "voice"
    examples: list[ExampleNote] = []


@app.post("/api/songs/{song_id}/parts")
def create_part(song_id: str, req: PartRequest) -> dict:
    song = songs.get(song_id)
    if song is None:
        raise HTTPException(404, "This song is no longer on the server; please load it again.")
    if req.source not in SOURCES:
        raise HTTPException(400, f"Unknown melody source: {req.source}")
    examples = [Example(e.time, e.end, e.pitch, e.wanted) for e in req.examples if e.end > e.time]
    return job_json(
        runner.submit("part", lambda progress: analyze_part(song, req.start, req.end, req.source, progress, examples))
    )


@app.get("/api/songs/{song_id}")
def get_song(song_id: str) -> dict:
    song = songs.get(song_id)
    if song is None:
        raise HTTPException(404, "This song is no longer on the server; please load it again.")
    return song.to_json()


@app.get("/api/songs/{song_id}/audio")
def get_audio(song_id: str) -> FileResponse:
    song = songs.get(song_id)
    if song is None or not song.audio_path.exists():
        raise HTTPException(404, "This song is no longer on the server; please load it again.")
    return FileResponse(song.audio_path, media_type="audio/wav")


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = runner.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job.")
    return job_json(job)


@app.delete("/api/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    job = runner.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job.")
    runner.cancel(job)
    return job_json(job)


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
