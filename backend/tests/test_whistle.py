import numpy as np

from app.audio.whistle import _fill, _supported
from app.music.model import NoteEvent


def test_fill_adds_backup_notes_only_in_gaps():
    primary = [NoteEvent(0.0, 0.5, 74), NoteEvent(1.0, 1.5, 76)]
    backup = [NoteEvent(0.1, 0.4, 73), NoteEvent(0.55, 0.95, 78), NoteEvent(1.6, 2.0, 79)]
    assert [n.pitch for n in _fill(primary, backup)] == [74, 78, 76, 79]


def test_contour_notes_need_basic_pitch_support():
    frame = 256 / 22050
    activation = np.zeros((200, 88))
    activation[10:60, 74 - 21] = 0.6  # Basic Pitch hears D5 here
    output = {"note": activation}
    assert _supported(output, NoteEvent(10 * frame, 60 * frame, 74))
    assert not _supported(output, NoteEvent(10 * frame, 60 * frame, 86))  # an octave slip
