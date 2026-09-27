import numpy as np

from app.audio.voice import transcribe_voice


def sung(notes, sr=22050):
    """A voice-like line: vibrato, slides between notes, a breath before each."""
    out, prev = [], None
    for pitch, seconds in notes:
        t = np.arange(int(seconds * sr)) / sr
        target = 440 * 2 ** ((pitch - 69) / 12)
        start = 440 * 2 ** ((prev - 69) / 12) if prev else target
        f = start * (target / start) ** np.clip(t / 0.06, 0, 1)
        f *= 1 + 0.02 * np.clip((t - 0.2) / 0.3, 0, 1) * np.sin(2 * np.pi * 5.5 * t)
        phase = 2 * np.pi * np.cumsum(f) / sr
        env = np.minimum(1, t / 0.03) * np.minimum(1, (seconds - t) / 0.05)
        out.append(0.3 * env * sum(np.sin(k * phase) / k for k in range(1, 6)))
        prev = pitch
    return np.concatenate(out).astype(np.float32), sr


def test_voice_notes_survive_vibrato_and_slides():
    line = [(64, 0.5), (67, 1.2), (67, 0.4), (72, 0.8), (69, 0.6)]  # includes a repeated G
    y, sr = sung(line)
    notes = transcribe_voice(y, sr)
    assert [n.pitch for n in notes] == [p for p, _ in line]
    starts = np.cumsum([0] + [s for _, s in line[:-1]])
    assert all(abs(n.start - s) < 0.08 for n, s in zip(notes, starts))
