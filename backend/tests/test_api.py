import time

from fastapi.testclient import TestClient

from app import main
from app.music.model import BeatNote, Melody


def fake_analyze(inp, workdir, report):
    report("Listening for notes", 0.5)
    wav = workdir / "song.wav"
    wav.write_bytes(b"RIFF")
    return Melody(120, 4, "D major", [BeatNote(62, 0, 1)], 1.0, title="t"), wav


def wait(client, job_id):
    for _ in range(100):
        data = client.get(f"/api/jobs/{job_id}").json()
        if data["status"] in ("done", "error"):
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
