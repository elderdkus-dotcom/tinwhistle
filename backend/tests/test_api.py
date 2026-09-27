import threading
import time

from fastapi.testclient import TestClient

from app import main
from app.music.model import BeatNote, Melody


def fake_analyze(inp, workdir, progress):
    progress.plan([("notes", "Listening for notes")])
    progress.start("notes")
    progress.update("notes", 5, 10)
    wav = workdir / "song.wav"
    wav.write_bytes(b"RIFF")
    return Melody(120, 4, "D major", [BeatNote(62, 0, 1)], 1.0, title="t"), wav


def wait(client, job_id):
    for _ in range(100):
        data = client.get(f"/api/jobs/{job_id}").json()
        if data["status"] in ("done", "error", "cancelled"):
            return data
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_upload_job_round_trip(monkeypatch):
    monkeypatch.setattr(main.runner, "analyze", fake_analyze)
    client = TestClient(main.app)
    res = client.post("/api/jobs", files={"file": ("song.mp3", b"123", "audio/mpeg")})
    assert res.status_code == 200
    data = wait(client, res.json()["id"])
    assert data["status"] == "done"
    assert data["result"]["notes"] == [{"pitch": 62, "start": 0, "duration": 1}]
    assert client.get(f"/api/jobs/{data['id']}/audio").status_code == 200


def test_rejects_missing_input_and_bad_links():
    client = TestClient(main.app)
    assert client.post("/api/jobs", data={"url": ""}).status_code == 400
    assert client.post("/api/jobs", data={"url": "file:///etc/passwd"}).status_code == 400


def test_unknown_job():
    assert TestClient(main.app).get("/api/jobs/nope").status_code == 404


def test_progress_steps_and_cancel(monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def slow_analyze(inp, workdir, progress):
        progress.plan([("separate", "Separating"), ("notes", "Listening for notes")])
        progress.set_song_length(140)
        progress.start("separate")
        progress.update("separate", 73, 140)
        started.set()
        while not release.wait(0.01):
            progress.check()
        raise AssertionError("should have been cancelled")

    monkeypatch.setattr(main.runner, "analyze", slow_analyze)
    client = TestClient(main.app)
    job_id = client.post("/api/jobs", data={"url": "https://example.com/song"}).json()["id"]
    queued_id = client.post("/api/jobs", data={"url": "https://example.com/other"}).json()["id"]
    assert started.wait(2)

    data = client.get(f"/api/jobs/{job_id}").json()
    assert data["stage"] == "Separating"
    assert data["steps"][0] == {"key": "separate", "label": "Separating", "state": "active", "done": 73, "total": 140, "unit": "s"}
    assert data["steps"][1]["state"] == "pending"
    assert data["remaining"] is not None and 0 < data["progress"] < 1
    assert client.get(f"/api/jobs/{queued_id}").json()["queuePosition"] == 1

    client.delete(f"/api/jobs/{queued_id}")
    client.delete(f"/api/jobs/{job_id}")
    assert wait(client, job_id)["status"] == "cancelled"
    assert client.get(f"/api/jobs/{queued_id}").json()["status"] == "cancelled"
