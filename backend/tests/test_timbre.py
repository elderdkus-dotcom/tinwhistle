import numpy as np

from app.audio.timbre import fade_rates, keep_sustained
from app.music.model import NoteEvent


def test_held_notes_kept_and_plucked_notes_dropped():
    sr = 22050
    t = np.arange(int(sr * 0.6)) / sr
    held = 0.3 * np.sin(2 * np.pi * 587.3 * t)  # a whistle D5, steady
    plucked = 0.6 * np.sin(2 * np.pi * 659.3 * t) * np.exp(-t * 4)  # a guitar E5, fading
    y = np.concatenate([held, plucked]).astype(np.float32)
    events = [NoteEvent(0.0, 0.6, 74, 0.5), NoteEvent(0.6, 1.2, 76, 0.8)]
    rates = fade_rates(y, sr, events)
    assert rates[0] > -3 and rates[1] < -25
    assert [e.pitch for e in keep_sustained(y, sr, events)] == [74]
