import threading
import time

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.songs import Song


def wait(client, job_id):
    for _ in range(500):
        data = client.get(f"/api/jobs/{job_id}").json()
        if data["status"] in ("done", "error", "cancelled"):
            return data
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def fake_song(tmp_path, song_id="s1"):
    sr = 22050
    t = np.arange(sr * 8) / sr
    # An A440 tone repeated on every beat (0.5 s), so notes start inside any part.
    envelope = (t % 0.5) < 0.4
    y = (0.3 * np.sin(2 * np.pi * 440 * t) * envelope).astype(np.float32)
    song = Song(song_id, tmp_path, "t", y, sr, 120.0, np.arange(0, 8, 0.5), 4, 0.0)
    main.songs.add(song)
    return song


def test_load_song_round_trip(monkeypatch, tmp_path):
    def fake_load(song_id, workdir, inp, progress):
        progress.plan([("decode", "Reading the audio")])
        progress.start("decode")
        song = fake_song(tmp_path, song_id)
        (tmp_path / "song.wav").write_bytes(b"RIFF")
        return song

    monkeypatch.setattr(main, "load_song", fake_load)
    client = TestClient(main.app)
    res = client.post("/api/songs", files={"file": ("song.mp3", b"123", "audio/mpeg")})
    assert res.status_code == 200
    data = wait(client, res.json()["id"])
    assert data["status"] == "done"
    song = data["result"]["song"]
    assert song["beatsPerMeasure"] == 4 and song["duration"] == 8.0
    assert client.get(f"/api/songs/{song['id']}/audio").status_code == 200


def test_part_analysis_on_real_audio(tmp_path):
    song = fake_song(tmp_path)
    client = TestClient(main.app)
    job = client.post(f"/api/songs/{song.id}/parts", json={"start": 1.0, "end": 5.0, "isolate": False}).json()
    data = wait(client, job["id"])
    assert data["status"] == "done", data["error"]
    notes = data["result"]["notes"]
    assert notes and all(n["pitch"] == 69 for n in notes)  # the A440 tone, heard as A4
    assert 1.0 <= notes[0]["time"] < 5.0
    assert notes[0]["start"] == round(notes[0]["time"] / 0.5 * 4) / 4  # on the song's beat grid


def test_rejects_bad_requests(tmp_path):
    client = TestClient(main.app)
    assert client.post("/api/songs", data={"url": ""}).status_code == 400
    assert client.post("/api/songs", data={"url": "file:///etc/passwd"}).status_code == 400
    assert client.post("/api/songs/nope/parts", json={"start": 0, "end": 5}).status_code == 404
    song = fake_song(tmp_path, "s2")
    job = client.post(f"/api/songs/{song.id}/parts", json={"start": 2, "end": 2.5, "isolate": False}).json()
    assert "too short" in wait(client, job["id"])["error"]


def test_progress_and_cancel(monkeypatch):
    started = threading.Event()

    def slow(progress):
        progress.plan([("separate", "Separating"), ("notes", "Listening for notes")])
        progress.set_song_length(140)
        progress.start("separate")
        progress.update("separate", 73, 140)
        started.set()
        while True:
            progress.check()
            time.sleep(0.01)

    client = TestClient(main.app)
    first = main.runner.submit("part", slow)
    second = main.runner.submit("part", slow)
    assert started.wait(2)
    data = client.get(f"/api/jobs/{first.id}").json()
    assert data["stage"] == "Separating"
    assert data["steps"][0] == {"key": "separate", "label": "Separating", "state": "active", "done": 73, "total": 140, "unit": "s"}
    assert client.get(f"/api/jobs/{second.id}").json()["queuePosition"] == 1
    client.delete(f"/api/jobs/{second.id}")
    client.delete(f"/api/jobs/{first.id}")
    assert wait(client, first.id)["status"] == "cancelled"
    assert wait(client, second.id)["status"] == "cancelled"
