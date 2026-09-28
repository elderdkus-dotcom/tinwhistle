# Tin Whistle Scores

Turn a song (a YouTube link or an MP3) into sheet music for the **D tin whistle**, with a
fingering chart (filled and open holes) under every note. It is a web app, built so it can become a phone app later.

**You build the score part by part while listening:**

1. **Load the song.** The app downloads and decodes it, and finds the beat and bar lines.
2. **Play the song and pause** where you want the next part to end, then press **Score**. For an instrumental intro, press **Skip** instead.
   Use **Melody from** to choose what to score:
   - **Singer**
   - **Tin whistle / flute:** a high melody instrument. Guitar and piano are separated out first.
   - **Other instrument**
   - **Whole band**
3. **Review the new part.** It is tinted blue in the score. Play the song and the whistle version to compare, then press **Keep** or **Discard**.
4. **Carry on** from where the score ends.

While the song plays, the note being sung is highlighted in the score. The timeline shows which stretches are already scored.

Other features:
- **Automatic transposition** into a key the whistle can play (usually D or G major).
- **Three levels:**
  - **Beginner:** natural notes only, no sixteenths, slower tempo.
  - **Intermediate:** both octaves, C natural, full rhythm.
  - **Expert:** half-holed notes, cuts and rolls.
- **Whistle playback:** speed control, count-in, and a "whistle along" option that plays the score in time with the song.
- **Editing:** tap a note to change its pitch or length, insert or delete notes, add ornaments, or play the song from that note. Undo and redo work.
- **Output:** print or save as PDF. You can save and reopen projects as `.whistle.json` files.

## How it works

```
load:  song ─► download / decode ─► beat grid + bar lines (librosa)
part:  clip ─► separate stems (Demucs 6-stem) ─┬─ singer:  vocals ─► voice pitch contour (pYIN) ─► notes
                                               ├─ whistle: other+vocals (no guitar/piano) ─► whistle pitch contour (pYIN),
                                               │           checked against Basic Pitch, gaps filled by Basic Pitch
                                               └─ other instrument / whole band ─► Basic Pitch
       ─► pick the melody line (Viterbi) ─► quantize onto the song's grid
browser: parts ─► transpose for the whistle ─► level arrangement ─► VexFlow staff + fingering charts
```

- **Singing:** it tracks the voice's pitch contour with pYIN and cuts it into notes, ignoring vibrato and slides between notes. This avoids the split and mis-pitched notes that general-purpose transcription produces on vocals.
- **Shared beat grid:** every part is placed on the whole song's beat grid, so the parts join into one continuous score. Each note remembers where it was heard, which is what drives the playback highlighting.
- **Server and browser:** the server (`backend/`) does the audio work. Arranging, editing and playback run in the browser (`frontend/`).

## Running it

**The easy way:** install [Python](https://www.python.org/downloads/) (3.10 or newer) and
[Node.js](https://nodejs.org), then double-click:

- **Windows:** `start.bat`
- **Mac:** `start.command` (Linux: run `./start.command`)

On the first run it installs everything and builds the app, which takes a few minutes. After that it starts in
seconds and opens http://localhost:8000 in your browser. It rebuilds automatically after a `git pull`.
Keep its window open while you use the app, and close it (or press Ctrl+C) to stop.
To add vocal separation, run it once with `--with-separation`, e.g. `start.bat --with-separation`.

### By hand

Requirements: Python 3.10 or newer (tested on 3.11 and 3.13) and Node 20+. ffmpeg comes bundled through
`imageio-ffmpeg`. TensorFlow is not needed: the note-detection model runs with onnxruntime.

```bash
# Backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r backend/requirements-dev.txt
# Basic Pitch pins a TensorFlow that no longer installs, so skip its dependencies:
pip install --no-deps basic-pitch==0.4.0
# Optional, but much better for songs with a band (CPU torch keeps it small):
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install -r backend/requirements-separation.txt

# Frontend
cd frontend && npm install && npm run build && cd ..

# Serve the API and the built app on http://localhost:8000
cd backend && uvicorn app.main:app --port 8000
```

For frontend development, run `npm run dev` in `frontend/` alongside uvicorn. Vite forwards `/api` requests to port 8000.
If the app is served from somewhere other than the API (for example, a phone app), set `VITE_API_BASE`.

## Tests

```bash
cd backend && pytest
cd frontend && npm test
```

## Known limits

- Transcribing audio is approximate. Expect to fix some notes, especially without vocal isolation or in busy mixes.
- Only 2/4, 3/4 and 4/4 are supported. The time signature is chosen when loading (default 4/4) and is not detected.
- With vocal isolation on, a part takes roughly its own length to score on a laptop CPU. Parts are capped at 2:30.
- The server keeps the last 5 songs in memory. After a restart, load the song again to keep scoring.
- Only the D whistle is supported so far.
