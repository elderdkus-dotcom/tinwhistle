# Tin Whistle Scores

Turn a song (a YouTube link or an MP3) into sheet music for the **D tin whistle**, with a
fingering chart (filled and open holes) under every note. The app is a web app built to become a phone app later.

- **Automatic transposition** into a key the whistle can play (usually D or G major).
- **Three levels:**
  - **Beginner:** natural notes only, no sixteenths, slower tempo.
  - **Intermediate:** both octaves, C natural, full rhythm.
  - **Expert:** half-holed notes, cuts and rolls.
- **Playback** with a whistle-like synth, speed control, count-in, and the current note highlighted. You can also play the original song for comparison.
- **Editing:** tap a note to change its pitch or length, insert or delete notes, or add ornaments. Undo and redo work, and there are keyboard shortcuts on desktop.
- **Output:** print or save as PDF. You can save and reopen projects as `.whistle.json` files.

## How it works

```
song ──► download / decode ──► (optional) isolate vocals ──► transcribe notes
     (yt-dlp, ffmpeg)          (Demucs)                      (Spotify Basic Pitch)
                                                                    │
browser ◄── melody JSON ◄── bar lines ◄── quantize to beats ◄── pick the melody line
   │                         (chords, bass)   (librosa beat tracking)   (Viterbi over notes)
   └─► transpose for the whistle ─► level arrangement ─► VexFlow staff + fingering charts
```

The server (`backend/`) does the heavy audio work and returns the melody as notes in beats.
Everything after that happens in the browser (`frontend/`), so switching levels, editing and playback are instant. The same client can later run inside a phone app shell such as Capacitor.

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

- Transcribing audio is approximate. Expect to fix some notes, especially in busy mixes; vocal isolation helps a lot.
- Only 2/4, 3/4 and 4/4 are supported. The time signature is chosen by the user (default 4/4) and is not detected.
- Analysis takes roughly as long as the song on a CPU when vocal isolation is on. Songs are capped at 6 minutes.
- Only the D whistle is supported so far.
