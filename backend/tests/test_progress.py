import pytest

from app.progress import JobCancelled, Progress


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def make(song=270.0):
    clock = Clock()
    p = Progress(clock=clock)
    p.plan([("decode", "Reading"), ("separate", "Separating"), ("beats", "Beats"), ("notes", "Notes"), ("melody", "Melody")])
    p.start("decode")
    p.set_song_length(song)
    return p, clock


def test_no_estimate_until_speed_is_measured():
    p, clock = make()
    p.start("separate")
    for t in (0, 5, 10, 15):  # the separation model is loading
        clock.t = t
        assert p.remaining() is None
    clock.t = 30
    p.update("separate", 1, 270)
    clock.t = 60
    p.update("separate", 40, 270)
    assert p.remaining() is not None


def test_estimate_follows_measured_speed_on_a_slow_computer():
    # This computer separates 4x slower than the reference: 0.45 * 4 s per song second.
    p, clock = make()
    p.start("separate")
    clock.t = 20.0  # model loaded
    p.update("separate", 1.0, 270.0)
    clock.t = 20.0 + 1.8 * 100
    p.update("separate", 100.0, 270.0)
    left = p.remaining()
    separation_left = 1.8 * 170
    later_steps = (0.015 + 0.015 + 0.005) * 270 * 4 + 1.0 * 4
    assert left == pytest.approx(separation_left + later_steps, rel=0.1)

    # The estimate keeps agreeing with reality as time passes.
    clock.t += 1.8 * 70
    p.update("separate", 170.0, 270.0)
    assert p.remaining() == pytest.approx(left - 1.8 * 70, rel=0.1)


def test_progress_bar_tracks_time():
    p, clock = make()
    p.start("separate")
    clock.t = 15.0
    p.update("separate", 1, 270)
    clock.t = 75.0
    p.update("separate", 135, 270)
    data = p.to_json()
    assert 0.4 < data["progress"] < 0.6
    p.finish_all()
    assert p.to_json()["progress"] == 1.0


def test_unknown_until_song_length_known():
    p = Progress()
    p.plan([("download", "Downloading"), ("decode", "Reading")])
    p.start("download")
    assert p.to_json()["remaining"] is None


def test_cancel():
    p, _ = make()
    p.cancelled.set()
    with pytest.raises(JobCancelled):
        p.update("separate", 1, 2)
