# Tin Whistle Scores

Write sheet music for the **D tin whistle** by ear, with a fingering chart (filled and open holes) under every
note. It is a web app, built so it can become a phone app later.

There are three ways to start:

1. **A song:** paste a YouTube link or pick an MP3 (or other audio file).
2. **Hum a tune:** record the tune in your head into the microphone, singing, humming or whistling, optionally
   to a metronome.
3. **An empty score** with no song.

You then get an empty score sheet. The song or recording plays in the background while you write the notes.

## Writing a score

- Press **Space** to play or pause the song. Pause where the tune starts.
- Press **→** to add a note there, then **↑ / ↓** to move it through the whistle's notes until it sounds right.
  - **Shift+↑/↓** moves by a semitone.
  - You can also tap a **fingering** on the note pad, or type the letters **D E F G A B C**. F and C give F♯ and
    C♯, in the octave nearest the last note.
- **→** moves on. After the last note it adds a new one, a copy of the one before, ready to change.
- **1–5** set the length (sixteenth, eighth, quarter, half, whole) and **.** makes it dotted.
- **Delete** turns a note into a rest.
- **Enter** plays just the selected note's stretch of the song, so you can compare.
- Selecting a note moves the song there, so **Space** plays from that note.
- **Tap in the rhythm:** while the song plays, hold **N**, or the *Hold for a note* button, for as long as each
  note lasts. The notes snap to the beat grid (1/8 by default). Then go back and set their pitches.
- **Other tools:**
  - **Speed:** slow the song down to 50% without changing its pitch.
  - **Play my notes along:** the whistle plays your score in time with the song.
  - **Click the beat:** a metronome on the song's beats, to check the bar lines.
  - **Undo / redo** (Ctrl+Z / Ctrl+Y).
  - **Key −/+:** moves every note by a semitone.
  - **Cuts and rolls.**
  - **Print / PDF.**
- **Saving:**
  - **Save** writes a `.whistle.json` file, which **Open saved** reads back.
  - The score is also kept in the browser, and the start page offers to continue where you left off.

### Bar lines

When a song opens, the app finds its beat and bar lines (librosa beat tracking). Notes sit on that grid, so the
score follows the song even when its tempo drifts. If the bar lines are off, turn on *Click the beat* and open
**Bar lines in the wrong place?**. You can:

- halve or double the tempo;
- move the bar lines by a beat;
- set a steady beat: type or tap the tempo, pause on the first beat of a bar, and press **A bar starts here**.

When you record a tune to the metronome, that beat is used as it is.

Recording needs microphone access. The browser only allows it on `http://localhost` or over https, which is how
the start scripts open the app. Headphones keep the metronome out of the recording.

## How it works

```
song / recording ─► download (yt-dlp) / decode (ffmpeg) ─► beat grid + bar lines (librosa)   [backend]
score position (beats) ◄─► song time via the beat grid ─► VexFlow staff + fingering charts    [browser]
```

- **Server** (`backend/`): downloads and decodes songs, finds the beat, and serves the audio back.
- **Browser** (`frontend/`): everything else, including note entry, playback, the whistle synth and the metronome.

## Running it

**The easy way:** install [Python](https://www.python.org/downloads/) (3.10 or newer) and
[Node.js](https://nodejs.org), then double-click:

- **Windows:** `start.bat`
- **Mac:** `start.command` (Linux: run `./start.command`)

On the first run it installs everything and builds the app, which takes a few minutes. After that it starts in
seconds and opens http://localhost:8000 in your browser. It rebuilds automatically after a `git pull`.
Keep its window open while you use the app, and close it (or press Ctrl+C) to stop.

### By hand

Requirements: Python 3.10 or newer and Node 20+. ffmpeg comes bundled through `imageio-ffmpeg`.

```bash
# Backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r backend/requirements-dev.txt

# Frontend
cd frontend && npm install && npm run build && cd ..

# Serve the API and the built app on http://localhost:8000
cd backend && uvicorn app.main:app --port 8000
```

For frontend development, run `npm run dev` in `frontend/` alongside uvicorn. Vite forwards `/api` requests to
port 8000. If the app is served from somewhere other than the API (for example, a phone app), set `VITE_API_BASE`.

`tools/get_clip.py` downloads a YouTube song as an MP3 into `clips/`, if you would rather open a file.

## Tests

```bash
cd backend && pytest
cd frontend && npm test
```

## Known limits

- Only 2/4, 3/4 and 4/4 are supported. You choose the time signature when opening a song (default 4/4).
- The server keeps the last 5 songs in memory. After a restart, a saved score still opens, but without its song.
- Only the D whistle is supported so far.
