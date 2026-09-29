import numpy as np

from app.music.rhythm import downbeat_phase, normalize_beats, score_origin, seconds_to_beats


def test_downbeat_phase_and_origin():
    evidence = np.array([0.2, 0.1, 2.0, 0.3] * 8)  # strong beat at index 2 of every 4
    assert downbeat_phase(evidence, 4) == 2
    beats = np.arange(0.5, 20, 0.5)  # first beat at 0.5 s: time 0 is beat index -1
    origin = score_origin(beats, 4, 2)
    assert origin == -2.0  # a downbeat, at or before the song start
    assert (2 - origin) % 4 == 0


def test_normalize_folds_tempo():
    beats = np.arange(0, 10, 60 / 200)
    tempo, folded = normalize_beats(200, beats, 10)
    assert tempo == 100 and np.allclose(np.diff(folded), 0.6)


def test_fast_tunes_keep_their_tempo():
    beats = np.arange(0, 10, 60 / 160)
    tempo, kept = normalize_beats(160, beats, 10)
    assert tempo == 160 and len(kept) == len(beats)


def test_seconds_to_beats_follows_the_grid():
    beats = np.array([1.0, 1.5, 2.0, 2.6, 3.2])
    idx = seconds_to_beats(np.array([0.5, 1.75, 2.9, 3.75]), beats)
    # Inside the grid: interpolated; outside: extended by the typical beat (0.55 s).
    assert np.allclose(idx, [-0.5 / 0.55, 1.5, 3.5, 4 + 0.55 / 0.55])
