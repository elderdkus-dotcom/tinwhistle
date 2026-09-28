import numpy as np

from app.audio.profile import Example, SoundProfile, Spectrum, choose_tracks


def test_tracks_follow_the_marked_notes():
    right = Example(0, 1, 70, True)
    wrong = Example(2, 3, 72, False)
    shares = [
        (right, {"other": 0.1, "guitar": 0.2, "piano": 0.7, "vocals": 0.0}),  # the flute sits in "piano"
        (wrong, {"other": 0.9, "guitar": 0.05, "piano": 0.05, "vocals": 0.0}),  # the banjo in "other"
    ]
    assert choose_tracks(shares) == ["guitar", "piano"]
    assert choose_tracks([(wrong, shares[1][1])]) is None  # nothing marked right: keep the default


def test_profile_keeps_notes_like_the_right_sound():
    blown = np.array([-20.0] * 7 + [0.05, 0.0])  # nearly pure, smooth, steady
    picked = np.array([-3.0] * 7 + [0.5, -40.0])  # rich, flickering, fading
    profile = SoundProfile(wanted=blown[None], unwanted=picked[None])
    assert profile.keep(blown + 1.0, 70)
    assert not profile.keep(picked + 1.0, 70)
    assert profile.keep(None, 70)


def test_measuring_a_steady_tone():
    sr = 22050
    t = np.arange(sr) / sr
    y = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    feats = Spectrum(y, sr).features(0.1, 0.9, 69)
    assert feats[0] < -20  # hardly any second harmonic
    assert feats[-2] < 0.1  # no flicker
    assert abs(feats[-1]) < 5  # not fading
