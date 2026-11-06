---
name: setup-studio
description: "This skill should be used when the user wants the Reconstruction Studio installed, checked, repaired or updated — e.g. \"install the studio\", \"set up the video tools\", \"install Whisper and Three.js\", \"install the music tools\", \"check my setup\", \"is everything installed\", \"the renderer doesn't work\", \"update the studio\", or before the first video on a new machine. It copies the bundled kit into the workspace, installs ffmpeg, Node packages (Three.js, renderer, fonts, maps), headless Chromium, Python packages (faster-whisper, numpy, scipy, requests, PyMuPDF), and the film-score tools (FluidSynth or TinySoundFont, the GeneralUser GS SoundFont, mido, pedalboard), runs the doctor and a rendered self-test, and reports render speed (GPU vs software)."
metadata:
  version: "0.1.0"
  author: aiTrends
---

# Set up the studio

Follow `../make-reconstruction-video/references/install.md` exactly. In short:

1. **Choose the machine** (install.md §1). Prefer the user's own computer for rendering, because it has the GPU. Say in one sentence which setup applies and what it means for render time.
2. **Copy the kit.** Copy `../make-reconstruction-video/kit/` to `reconstruction-studio/` in the workspace or connected folder.
   - Skip this if `reconstruction-studio/render.mjs` already exists. Never touch `projects/`.
   - Then run `python tools/verify_kit.py`. It must say 36/36.
3. **Install the dependencies.** List them for the user first (one line each, with why).
   - Run `python tools/doctor.py --install`. It handles npm, Playwright Chromium, pip, and the film-score tools (`tools/music_setup.py`: mido, pedalboard and TinySoundFont, the GeneralUser GS SoundFont, and FluidSynth on Windows). It then test-renders 8 seconds of music.
   - For system packages (ffmpeg, Node.js, Python), ask before installing. Then use the commands in the install table: winget on Windows, brew on macOS, apt on Linux.
   - On Windows, a new terminal is needed after a winget install before the new command is found.
4. **Doctor.** Run `python tools/doctor.py` until everything is OK. PyMuPDF is optional.
5. **Self-test.** Run `node render.mjs --project examples/demo --sheet --scale 0.3`.
   - Open `examples/demo/build/sheets/sheet_01.png` yourself and confirm all 16 frames rendered with no MISSING or ERROR frames.
   - Note the GPU line the renderer printed.
   - Delete `examples/demo/build/`.
6. **Optional voice checks** if the user plans to use them:
   - **ElevenLabs:** `python tools/elevenlabs_tts.py status`. The key is set up via `setup --ask` or a key file, never pasted into a command (see `../voiceover/references/elevenlabs.md`).
   - **Whisper:** to download the model ahead of time, run `python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', device='cpu', compute_type='int8')"`. Otherwise the first real `transcribe.py` run downloads it.
7. **Report** in 3–5 lines:
   - what was installed;
   - the GPU / software rendering status, with a rough speed expectation (install.md and `render-qc.md`);
   - anything still missing and the exact command to fix it.

**Repair:**
- Re-run `verify_kit.py`. Copy the missing files again from the kit.
- `npm install` fixes missing fonts and three.js.
- `npx playwright install chromium` fixes "Executable doesn't exist".
- For other errors, see the troubleshooting table in `../make-reconstruction-video/references/render-qc.md`.

**Update:** copy the new kit over the install. This keeps `projects/`. Then run verify and the doctor.
