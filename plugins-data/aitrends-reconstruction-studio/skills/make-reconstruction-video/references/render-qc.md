# Rendering, QC and troubleshooting

## Commands (inside `reconstruction-studio/`)
```bash
node render.mjs --project projects/<slug> --sheet --scale 0.4              # one still per shot -> build/sheets/sheet_XX.png (20 per sheet)
node render.mjs --project projects/<slug> --sheet --shots s010,s011 --at 0.7  # sheet of chosen shots at 70% of each shot
node render.mjs --project projects/<slug> --stills 12.5,40,61.2 --scale 0.5   # stills at global times -> build/stills/
node render.mjs --project projects/<slug> --shots s010,s011 --scale 0.5       # motion preview of shots -> build/preview.mp4 (with voice)
node render.mjs --project projects/<slug> --from 60 --to 120 --scale 0.5      # range preview
node render.mjs --project projects/<slug>                                     # full render -> build/video_silent.mp4
python audio/mix.py --project projects/<slug>                                  # music + SFX + voice -> out/<title>.mp4
python tools/qc_video.py --project projects/<slug>                             # checks + build/qc_sheet.jpg
```
**Options:**
- `--quality draft | standard | high`: draft has no AO or MSAA (fast previews); high has 4× MSAA, full-res AO and 4K shadows.
- `--workers N`;
- `--gl auto | gpu | swiftshader`;
- `--crf 18`, `--preset medium`;
- `--format jpeg` (faster capture);
- `--noui`: hides the 2D layer, for clean stills for possibility panels or photo cards;
- `--debug`: overlays the shot id, time and line on every frame;
- `--out FILE`: relative paths are inside the project (`build/fix.mp4` means `projects/<slug>/build/fix.mp4`). With `--stills`, `--out DIR` writes the stills there and keeps them (e.g. `--out assets/stills` for possibility panels); otherwise `build/stills` and `build/sheets` are wiped on every run.
- `--patch` (with `--shots` or `--from/--to`, full size): re-renders that range and splices it frame-accurately into `build/video_silent.mp4` (the previous file is kept as `video_silent_prev.mp4`). Then re-run `audio/mix.py`.

## GPU and speed
- `render.mjs` prints the GPU it got.
- **Desktops:** on Windows and macOS, `--gl auto` uses the real graphics card. On a Linux desktop with an NVIDIA or AMD GPU, pass `--gl gpu`.
- **Cloud/VM:** servers and VMs without a GPU use SwiftShader (software). That's correct but slow: about 3–10 s per 1080p frame for heavy sets, so one worker only.
- **Rough budget at 1080p, standard quality:**

  | Setup | Speed | 15-min film (27,000 frames) |
  |---|---|---|
  | GPU desktop (RTX-class) | 6–20 frames/s across 3–4 workers | about 25–75 min |
  | Software rendering | about 0.1–0.3 frames/s | 1–3 days, not practical |

  **For a full film on software rendering:** render the previews in the cloud and the final on the user's PC, or render at 720p and `--quality draft`.
- **Workers:** each is a Chromium instance with its own GPU context, using about 1–2 GB RAM at 1080p. Start with 3 on a GPU, and raise it if the GPU isn't saturated.
- **Long renders:** run them in the background (a separate terminal, or the shell tool's background mode) and poll the log.
  - The renderer prints progress and ETA.
  - On a crash it can be re-run with `--from/--to` for the missing part. Join the parts with `ffmpeg -f concat`.

## The QC loop (do it every batch, before any long render)
1. **Sheet** the new shots. Open every `build/sheets/sheet_XX.png` yourself, using the Read tool on the PNG.
2. **Check each frame against the checklist below.** Fix and re-sheet.
3. **Motion-check** tricky shots with a short `--shots` preview. Sample 3–4 frames from it with ffmpeg (`-vf select`), or watch `--stills` at the start, middle and end of the shot.
4. **Every 3–4 batches,** render a range preview of a whole chapter at `--scale 0.5 --quality draft`. Check sync by sampling stills at key words: `wordTime` in words.json → `--stills`.

## Checklist
- [ ] **No errors:** no `MISSING SHOT` or red `ERROR` frames, and no shot errors printed by the renderer (it lists them at the end).
- [ ] **The picture matches its line,** and the key action or overlay lands on the key word (not before it).
- [ ] **Look:** clay shots read as soft and white with visible AO contact shading. Colour shots have depth (fog or haze), a real sky, and nothing pure black or blown out.
- [ ] **Composition:**
  - the subject is clear;
  - no camera inside geometry (walls, seats, trees);
  - no clipping through mannequins;
  - people are grounded (feet on the floor, seated in seats).
- [ ] **Overlays:**
  - inside the safe margins (72 px for 16:9; for 9:16, the middle area clear of the caption band);
  - no overlap with other overlays or with the subject;
  - readable at phone size;
  - text exactly matches the research (names, numbers, dates, quotes verbatim).
- [ ] **Sourcing:** footnotes on every reconstruction and evidence shot; credits on every real photo or screenshot; every asset in `media_log.csv`.
- [ ] **Continuity:** the same set details shot to shot (door state, seat occupancy, lighting time of day), and consistent screen direction.
- [ ] **Pacing:** median shot about 3–4 s (long) or about 2 s (short), no static holds, at most 3 similar shots in a row.
- [ ] **Ethics:** violence abstracted, no identifiable minors, accused status exact, "not a finding" on possibilities.
- [ ] **Music:** the score's sections change at the chapter turns, hits land on their words, silences sit under the right lines (`build/music.json` lists the sections), and nothing busy plays over dense narration.
- [ ] **Audio, after the mix:**
  - narration clear and music ducked under the voice;
  - SFX not stacked;
  - loudness about −14 LUFS integrated and true peak ≤ −1 dBTP (the mix targets −1.5) (`qc_video.py` reports it).

## Final QC (before delivering)
1. Run `python tools/qc_video.py --project projects/<slug>`. It checks duration against the narration, audio presence and loudness, black or frozen stretches, cut rate, shots without a `registerShot()`, and footnote coverage on 3D and evidence shots, and writes `build/qc_sheet.jpg`.
2. Open the QC sheet. Spot-check 5–8 full-resolution frames at important moments: open, chapter starts, evidence shots, the ending.
3. **Deliver:**
   - `out/<title>.mp4`;
   - `out/<title>.srt` (copy of `timeline/captions.srt`);
   - `out/description.txt`: title, a 2–3 line summary, chapters with timestamps, and **Sources + credits** from `sources.md` and `media_log.py list`.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `BOOT ERROR` / player failed | Usually a JSON syntax error in config or shots.json, or a scene import error. The renderer prints the file and message. |
| One shot shows a red ERROR | The exception is printed as `s012@1.20: …`. Fix that shot's code (often an undefined field in the set's returned object). |
| Black or very dark 3D | The look's `sun.dir` points below the horizon, or the camera is inside geometry. Check with `--debug` and a still. On SwiftShader, very heavy scenes can hit the timeout; reduce `farCount` and the triangle count. |
| Black blotches or halos in AO | AO radius too big for an interior; set a look override `ao: {radius: 0.5}`. Make sure the shot uses a set (not a flat bg) for 3D. |
| Blurry or missing shadows | `W.shadowArea(center, radius)` is too big or in the wrong place. Keep the radius about the visible area. |
| Fonts look wrong | `npm install` in the studio (`@fontsource/*`). |
| Labels pinned in the wrong place | Use a world point at the object's top, plus a small offset. The pin hides when `visible` is false (behind the camera). |
| Highlight timing off | Check `info.w('phrase')` uses words exactly as in `words.json`. Prefixes work: 'loose' matches 'loosened'. |
| Video and audio lengths differ | `shots.json` duration must equal the last `end`, which must be about the voiceover length. Re-run beats or fix the last shot. |
| Out of memory | Use fewer workers, `setCache: 2`, smaller canvases and textures. |
| Windows paths | Quote paths with spaces. Use `python` or `py -3`. Use forward slashes in JS imports. |
