"""HTTP API: submit a song, poll the analysis, fetch the decoded audio."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.audio.separate import separation_available
from app.pipeline import JobInput, JobRunner

MAX_UPLOAD_BYTES = 60 * 1024 * 1024
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

app = FastAPI(title="Tin Whistle Score Generator")
# The client may run from a phone app shell or a dev server on another port.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
runner = JobRunner()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "separation": separation_available()}


@app.post("/api/jobs")
async def create_job(
    file: UploadFile | None = File(None),
    url: str = Form(""),
    start: float = Form(0.0),
    duration: float = Form(0.0),
    separate: bool = Form(True),
    beats_per_measure: int = Form(4),
) -> dict:
    url = url.strip()
    if not url and file is None:
        raise HTTPException(400, "Upload an audio file or paste a YouTube link.")
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(400, "The link must start with http:// or https://")
    if beats_per_measure not in (2, 3, 4):
        raise HTTPException(400, "Beats per measure must be 2, 3 or 4.")

    job_id, workdir = runner.new_workdir()
    inp = JobInput(
        url=url or None,
        start=max(start, 0.0),
        duration=duration if duration > 0 else None,
        separate=separate,
        beats_per_measure=beats_per_measure,
    )
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
    job = runner.submit(job_id, workdir, inp)
    return job.to_json(runner.queue_position(job))


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = runner.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job.")
    return job.to_json(runner.queue_position(job))


@app.delete("/api/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    job = runner.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job.")
    runner.cancel(job)
    return job.to_json()


@app.get("/api/jobs/{job_id}/audio")
def get_audio(job_id: str) -> FileResponse:
    job = runner.jobs.get(job_id)
    if job is None or job.audio is None or not job.audio.exists():
        raise HTTPException(404, "No audio for this job.")
    return FileResponse(job.audio, media_type="audio/wav")


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
