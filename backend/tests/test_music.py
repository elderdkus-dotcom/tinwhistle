import numpy as np

from app.music.key import estimate_key
from app.music.melody import extract_melody
from app.music.model import BeatNote, NoteEvent
from app.music.rhythm import align_to_measures, normalize_beats, quantize


def test_melody_prefers_loud_top_line_over_accompaniment():
    tune = [NoteEvent(i * 0.5, i * 0.5 + 0.45, p, 0.8) for i, p in enumerate([74, 76, 78, 79])]
    chord = [NoteEvent(0.0, 2.0, 50, 0.5), NoteEvent(0.0, 2.0, 57, 0.5)]
    line = extract_melody(tune + chord)
    assert [n.pitch for n in line] == [74, 76, 78, 79]


def test_melody_ignores_brief_octave_glitch():
    events = [NoteEvent(0.0, 1.0, 67, 0.8), NoteEvent(0.4, 0.44, 79, 0.4)]
    assert [n.pitch for n in extract_melody(events)] == [67]


def test_quantize_snaps_to_sixteenths_and_fills_small_gaps():
    beats = np.arange(0, 10, 0.5)  # 120 BPM
    notes = [NoteEvent(0.02, 0.43, 62, 1), NoteEvent(0.51, 0.74, 64, 1), NoteEvent(2.0, 2.5, 66, 1)]
    q = quantize(notes, beats)
    assert [(n.pitch, n.start, n.duration) for n in q] == [
        (62, 0.0, 1.0),  # 0.86 beats, extended over the short gap
        (64, 1.0, 0.5),
        (66, 4.0, 1.0),
    ]


def test_quantize_removes_overlap():
    beats = np.arange(0, 10, 0.5)
    q = quantize([NoteEvent(0.0, 1.0, 62, 1), NoteEvent(0.5, 1.0, 64, 1)], beats)
    assert [(n.start, n.duration) for n in q] == [(0.0, 1.0), (1.0, 1.0)]


def test_align_puts_long_notes_on_downbeats():
    # One-beat pickup, then half notes starting on beats 1, 5, 9...
    notes = [BeatNote(62, 3.0, 1.0)] + [BeatNote(64, 4.0 + 2 * i, 2.0) for i in range(6)]
    aligned = align_to_measures(notes, 4)
    assert aligned[0].start == 3.0
    assert aligned[1].start == 4.0


def test_align_drops_leading_silence():
    notes = [BeatNote(62, 16.0, 2.0), BeatNote(64, 18.0, 2.0)]
    assert align_to_measures(notes, 4)[0].start == 0.0


def test_normalize_folds_tempo():
    beats = np.arange(0, 10, 60 / 200)
    tempo, folded = normalize_beats(200, beats, 10)
    assert tempo == 100 and np.allclose(np.diff(folded), 0.6)


def test_key_estimation():
    g_major = [67, 69, 71, 72, 74, 76, 78, 79, 74, 71, 67]
    assert estimate_key([BeatNote(p, i, 1.0) for i, p in enumerate(g_major)]) == "G major"


def test_quantize_corrects_late_beat_grid():
    # Beats tracked 60 ms late at 100 BPM: onsets land ~0.1 beat early.
    beats = np.arange(0, 20, 0.6) + 0.06
    notes = [NoteEvent(i * 0.6 + 0.03 * (i % 2), i * 0.6 + 0.55, 62 + i % 3, 1) for i in range(12)]
    assert [n.start for n in quantize(notes, beats)] == [float(i) for i in range(12)]


def test_key_uses_final_note_to_pick_major_over_relative_minor():
    ode = [71, 71, 72, 74, 74, 72, 71, 69, 67, 67, 69, 71, 71, 69, 69, 67]
    assert estimate_key([BeatNote(p, i, 1.0) for i, p in enumerate(ode)]) == "G major"
