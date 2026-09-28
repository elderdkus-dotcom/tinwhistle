"""Learning which sound the user wants from notes they marked.

The user marks a few notes in the score as "right sound" (e.g. the flute) or
"wrong sound" (e.g. a banjo). Each note is described by what it sounds like:

- its overtone pattern: how loud the 2nd to 8th harmonics are compared to the
  fundamental (a flute is nearly pure; a banjo or guitar is rich);
- how much its loudness flickers (tremolo picking flickers, a blown note is
  smooth);
- how fast it fades (plucked strings fade at once, blown notes hold);

and, for the wanted notes, where it sits in pitch. New candidate notes are
then kept or dropped by which marked group they sound closer to.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.music.model import NoteEvent

N_FFT = 4096
HOP = 256
HARMONICS = 8
# Feature scale floors, so one feature with tiny spread among the examples
# cannot dominate: 7 overtone levels (dB), flicker (ratio), fade (dB/s).
FLOORS = np.array([4.0] * (HARMONICS - 1) + [0.08, 8.0])
PITCH_MARGIN = 5  # semitones beyond the marked notes' range still accepted
MIN_WANTED_FOR_RANGE = 3
# A note is dropped only when it is clearly closer to a "wrong sound" example
# than to any "right sound" one; on a close call it is kept.
UNWANTED_MARGIN = 0.75
FAR_FROM_WANTED = 3.0  # with only "right sound" examples: drop only very different notes
NEAR_UNWANTED = 0.8  # with only "wrong sound" examples: drop notes this close to one


@dataclass
class Example:
    time: float  # seconds in the song
    end: float
    pitch: int  # MIDI, as heard (octave may be off; see best_octave)
    wanted: bool


class Spectrum:
    """Magnitude spectrogram of a stretch of audio, for measuring notes in it."""

    def __init__(self, y: np.ndarray, sr: int, offset: float = 0.0, n_fft: int = N_FFT):
        import librosa

        self.sr = sr
        self.offset = offset  # song time of y[0]
        self.mag = np.abs(librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=HOP))
        self.freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    def frames(self, t0: float, t1: float) -> slice:
        a = int(max(0.0, t0 - self.offset) * self.sr / HOP)
        b = int(max(0.0, t1 - self.offset) * self.sr / HOP)
        a = min(a, self.mag.shape[1] - 1)
        return slice(a, max(a + 1, min(b, self.mag.shape[1])))

    def band(self, f: float, span: slice) -> np.ndarray:
        """Level over time of the band around frequency f (+-35 cents)."""
        sel = (self.freqs >= f * 2 ** (-0.35 / 12)) & (self.freqs <= f * 2 ** (0.35 / 12))
        if not sel.any():
            sel = np.abs(self.freqs - f) == np.abs(self.freqs - f).min()
        return self.mag[sel, span].max(axis=0)

    def best_octave(self, t0: float, t1: float, pitch: int, lo: int = 45, hi: int = 100) -> int:
        """The octave of `pitch` whose fundamental is loudest there (user-added notes can be an octave off)."""
        span = self.frames(t0, t1)
        options = [p for p in (pitch - 12, pitch, pitch + 12) if lo <= p <= hi] or [pitch]
        return max(options, key=lambda p: float(np.median(self.band(_hz(p), span))))

    def features(self, t0: float, t1: float, pitch: int) -> np.ndarray | None:
        span = self.frames(t0, t1)
        n = span.stop - span.start
        if n < 3:
            return None
        # The body of the note, without attack and release.
        body = slice(span.start + n // 6, span.stop - n // 6) if n >= 6 else span
        f0 = _hz(pitch)
        levels = []
        for k in range(1, HARMONICS + 1):
            if k * f0 >= self.sr / 2:
                levels.append(-60.0)
                continue
            levels.append(float(np.median(20 * np.log10(self.band(k * f0, body) + 1e-9))))
        base = levels[0]
        overtones = [float(np.clip(level - base, -40.0, 20.0)) for level in levels[1:]]

        fundamental = self.band(f0, span)
        window = max(3, int(self.sr / HOP / 6))
        if len(fundamental) >= window:
            kernel = np.ones(window) / window
            smooth = np.convolve(fundamental, kernel, mode="same")
            flicker = float(np.mean(np.abs(fundamental - smooth)) / (np.mean(smooth) + 1e-9))
        else:
            flicker = 0.0
        body_level = 20 * np.log10(self.band(f0, body) + 1e-9)
        if len(body_level) >= 3:
            t = np.arange(len(body_level)) * HOP / self.sr
            fade = float(np.clip(np.polyfit(t, body_level, 1)[0], -80.0, 40.0))
        else:
            fade = 0.0
        return np.array(overtones + [flicker, fade])


def _hz(pitch: int) -> float:
    return 440.0 * 2 ** ((pitch - 69) / 12)


@dataclass
class SoundProfile:
    """Which sound the user wants, learned from marked notes."""

    wanted: np.ndarray = field(default_factory=lambda: np.zeros((0, HARMONICS + 1)))
    unwanted: np.ndarray = field(default_factory=lambda: np.zeros((0, HARMONICS + 1)))
    pitch_range: tuple[int, int] | None = None

    @property
    def empty(self) -> bool:
        return len(self.wanted) == 0 and len(self.unwanted) == 0

    def _scale(self) -> np.ndarray:
        both = np.vstack([self.wanted, self.unwanted])
        spread = both.std(axis=0) if len(both) >= 2 else np.zeros(both.shape[1])
        return np.maximum(spread, FLOORS)

    def keep(self, features: np.ndarray | None, pitch: int) -> bool:
        if self.pitch_range and not (self.pitch_range[0] <= pitch <= self.pitch_range[1]):
            return False
        if features is None or self.empty:
            return True
        scale = self._scale()

        def distances(group: np.ndarray) -> np.ndarray:
            return np.sqrt((((group - features) / scale) ** 2).mean(axis=1))

        if len(self.wanted) and len(self.unwanted):
            to_wanted = float(distances(self.wanted).min())
            to_unwanted = float(distances(self.unwanted).min())
            return not to_unwanted < UNWANTED_MARGIN * to_wanted
        if len(self.unwanted):
            return float(distances(self.unwanted).min()) > NEAR_UNWANTED
        return float(distances(self.wanted).min()) <= FAR_FROM_WANTED


def build_profile(examples: list[Example], spectrum_for) -> SoundProfile:
    """Measure the marked notes. `spectrum_for(t0, t1)` gives a Spectrum covering that time."""
    wanted, unwanted, pitches = [], [], []
    for ex in examples:
        spec = spectrum_for(ex.time, ex.end)
        if spec is None:
            continue
        pitch = spec.best_octave(ex.time, ex.end, ex.pitch)
        feats = spec.features(ex.time, ex.end, pitch)
        if feats is None:
            continue
        (wanted if ex.wanted else unwanted).append(feats)
        if ex.wanted:
            pitches.append(pitch)
    profile = SoundProfile(
        wanted=np.array(wanted).reshape(-1, HARMONICS + 1),
        unwanted=np.array(unwanted).reshape(-1, HARMONICS + 1),
    )
    if len(pitches) >= MIN_WANTED_FOR_RANGE:
        profile.pitch_range = (min(pitches) - PITCH_MARGIN, max(pitches) + PITCH_MARGIN)
    return profile


def filter_notes(notes: list[NoteEvent], spectrum: Spectrum, profile: SoundProfile) -> list[NoteEvent]:
    """Keep the notes that sound like the wanted examples. Note times are relative to the spectrum's audio."""
    if profile.empty:
        return notes
    kept = []
    for n in notes:
        t0, t1 = n.start + spectrum.offset, n.end + spectrum.offset
        if profile.keep(spectrum.features(t0, t1, n.pitch), n.pitch):
            kept.append(n)
    return kept


# A separated track is used when it holds at least this share of the marked
# "right sound" notes and more of them than of the "wrong sound" notes.
MIN_TRACK_SHARE = 0.2
IGNORED_TRACKS = ("drums", "bass")


def track_shares(stems: dict[str, np.ndarray], sr: int, offset: float, ex: Example) -> dict[str, float]:
    """How much of a marked note's fundamental each separated track holds."""
    names = [n for n in stems if n not in IGNORED_TRACKS]
    full = Spectrum(sum(stems[n] for n in names), sr, offset)
    pitch = full.best_octave(ex.time, ex.end, ex.pitch)
    levels = {}
    for name in names:
        spec = Spectrum(stems[name], sr, offset)
        levels[name] = float(np.median(spec.band(_hz(pitch), spec.frames(ex.time, ex.end))) ** 2)
    total = sum(levels.values()) + 1e-12
    return {name: level / total for name, level in levels.items()}


def choose_tracks(shares: list[tuple[Example, dict[str, float]]]) -> list[str] | None:
    """The separated tracks that hold the user's instrument, judged from the marked notes."""
    wanted = [s for ex, s in shares if ex.wanted]
    if not wanted:
        return None
    unwanted = [s for ex, s in shares if not ex.wanted]
    names = list(wanted[0])
    w = {n: float(np.mean([s[n] for s in wanted])) for n in names}
    u = {n: float(np.mean([s[n] for s in unwanted])) if unwanted else 0.0 for n in names}
    chosen = [n for n in names if w[n] >= MIN_TRACK_SHARE and w[n] > u[n]]
    return chosen or None
