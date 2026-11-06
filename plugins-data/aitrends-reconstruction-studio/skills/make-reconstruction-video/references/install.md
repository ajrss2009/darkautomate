# Installing the studio (once per machine or workspace)

The studio is a Node + Python toolkit that ships inside this plugin, in the `kit/` folder of the `make-reconstruction-video` skill. Copy it into a writable workspace folder as `reconstruction-studio/`: the plugin folder may be read-only, and the studio needs `node_modules`, projects and renders next to it.

## 1. Where to install: pick the machine that will render
Rendering is the slow part, and a graphics card makes it 20–100× faster. Decide where the studio lives:

| Situation | Install where | Render speed |
|---|---|---|
| Claude runs directly on the user's computer (its shell is their Windows/macOS/Linux terminal) | a folder on their computer, e.g. `Documents/reconstruction-studio` | GPU (fast) |
| The chat is linked to the user's computer through a VM shell (the shell says Linux, but the files are in their connected folders) | the connected folder | The VM usually has no GPU, so it renders in software (slow). For the final render, give the user the two commands to run in their own terminal (see §5). |
| Cloud workspace only (not linked) | the working directory | software rendering: fine for research, script, voice, timing, sheets and previews; a full 1080p long-form render takes days. Use the user's PC for the final, or 720p draft for shorts. |

Tell the user in one sentence which setup you're using and what that means for render time.

## 2. Locate the kit and copy it
- **Locate:** the kit is `kit/` inside this skill's base directory. The other skills (`write-script`, `voiceover`, `build-video`, `setup-studio`) reach it at `../make-reconstruction-video/kit/` from their own base directory. If the path is unclear, search for it:
  - Linux/macOS: `find / -path "*make-reconstruction-video/kit/render.mjs" 2>/dev/null | head -1`;
  - PowerShell: `Get-ChildItem -Recurse -Filter render.mjs -Path $HOME\.claude | Select-Object -First 1`.
- **Already installed?** If `reconstruction-studio/render.mjs` already exists, skip to step 4. Never overwrite `projects/`.
- **Copy:**
  - bash: `mkdir -p reconstruction-studio && cp -r "<kit>/." reconstruction-studio/`;
  - PowerShell: `Copy-Item -Recurse "<kit>\*" reconstruction-studio\`.
  - Skip any `node_modules` or `examples/demo/build` if they exist in the kit.
- **Verify:** run `python tools/verify_kit.py` inside `reconstruction-studio/`. It must report `36/36` and "kit OK".

## 3. Install dependencies
First tell the user, in one short list, what is being installed and why:
- ffmpeg: video and audio encoding;
- Node.js packages: the renderer, Three.js, maps and fonts;
- headless Chromium: draws the frames;
- Python packages:
  - numpy and scipy: sound;
  - faster-whisper: timestamps;
  - requests: ElevenLabs and downloads;
  - PyMuPDF: optional, for PDF highlights.
- the film-score tools:
  - mido and pedalboard: MIDI, reverb and mastering;
  - FluidSynth (or TinySoundFont as a fallback): plays the instruments;
  - the GeneralUser GS SoundFont: the instrument samples, about 32 MB, free for commercial music.

| Need | Windows | macOS | Linux |
|---|---|---|---|
| ffmpeg + ffprobe | `winget install --id Gyan.FFmpeg -e` (then a NEW terminal) | `brew install ffmpeg` | `sudo apt-get install -y ffmpeg` |
| Node.js ≥ 18 | `winget install OpenJS.NodeJS.LTS` | `brew install node` | distro package / nodesource |
| Python ≥ 3.9 | python.org installer ("Add to PATH") | `brew install python` | distro package |
| JS packages | `npm install` (inside reconstruction-studio) | same | same |
| Chromium | `npx playwright install chromium` | same | same (+ `npx playwright install-deps chromium` if libraries are missing) |
| Python packages | `python -m pip install numpy scipy faster-whisper requests pymupdf` | same | add `--break-system-packages` on managed Pythons |
| Score tools (pip + SoundFont) | `python tools/music_setup.py` (also fetches FluidSynth into `bin/`) | `python tools/music_setup.py` | `python tools/music_setup.py` |
| FluidSynth (the score's renderer) | included by `music_setup.py` | `brew install fluid-synth` | `sudo apt-get install -y --no-install-recommends fluidsynth` |

`python tools/doctor.py --install` runs the npm, Playwright, pip and score-tool steps automatically. The score tools land inside the studio folder: `soundfonts/` and, on Windows, `bin/fluidsynth/`. System installs (ffmpeg, Node, Python, and FluidSynth on macOS or Linux) need the user's OK first: say what you're about to install and why. FluidSynth is the score's renderer. TinySoundFont, a pip fallback, has wheels only for Python ≤ 3.12 and balances some instruments differently, so install FluidSynth on every machine that renders music.

**Whisper** downloads its model on first use from huggingface.co: `small` is about 500 MB, `medium` about 1.5 GB. With an NVIDIA GPU and CUDA 12 libraries, faster-whisper uses the GPU automatically; otherwise int8 on the CPU is fine.

**VoiceStudio** (optional) is the user's own Windows app. Don't install it for them. **ElevenLabs** needs only the `requests` package plus their key (the voiceover skill's `references/elevenlabs.md`).

## 4. Check and self-test
1. **Doctor:** run `python tools/doctor.py` until every line is OK. Use `python3` where `python` isn't Python 3, or `py -3` on some Windows setups. PyMuPDF is optional.
2. **Self-test:** run `node render.mjs --project examples/demo --sheet --scale 0.3`.
   - It prints the GPU string, then writes `examples/demo/build/sheets/sheet_01.png` with 16 frames:
     - the full-colour coaster park (2 shots);
     - a dark US map;
     - an article highlight and a quote card;
     - the white-clay cockpit and cabin, and a clay airliner in the sky;
     - a clay map with a route;
     - an altitude chart, a hero number, a list and a statement;
     - the ratchet mechanism, a photo, and possibility panels.
   - Open the PNG and check that everything rendered, with no `MISSING` or `ERROR` frames. Then delete `examples/demo/build/`.
   - Software rendering takes about 2–5 minutes for this; a GPU takes seconds.
3. **Report** what was installed and the GPU line in 2–4 lines.

## 5. Final render on the user's own PC (when Claude's shell is a VM or the cloud)
The project folder must be on their computer (a connected folder). Then ask the user to open a terminal in `reconstruction-studio/` and run:
```
node render.mjs --project projects/<slug>
python audio/mix.py --project projects/<slug>
```
On Windows, they first need Node, Python and ffmpeg there (the table above) plus `npm install` and `npx playwright install chromium` in that folder. When it finishes, run `qc_video.py` on the result from your side.

## Notes
- **Disk:** about 700 MB for node_modules and Chromium, plus renders. A 15-minute 1080p film is about 1–2 GB of build files and a 300–600 MB MP4.
- **Updating:** when the plugin updates, copy the new `kit/` over the install. It never touches `projects/`. Re-run `verify_kit.py`.
- **Paths:** quote paths with spaces. JS imports always use forward slashes.
