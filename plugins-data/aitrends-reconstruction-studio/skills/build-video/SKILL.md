---
name: build-video
description: "This skill should be used when the timed narration of a reconstruction documentary is ready and the video itself must be planned, built, rendered or fixed — e.g. \"build the video\", \"make the shots\", \"plan the shots\", \"build the 3D sets\", \"render a preview\", \"render the final video\", \"fix shot 42\", \"the label is in the wrong place\", \"change the look to dusk\", \"add sound effects\", \"mix the audio\", or when the Reconstruction Studio pipeline reaches the build stage. It turns words.json + the research into a shot plan, Three.js sets and shots (white clay or full-colour 3D, maps, charts, evidence cards), checks contact sheets, renders a preview for approval, then the final MP4 with the film's composed score, SFX and loudness mastering."
metadata:
  version: "0.1.0"
  author: aiTrends
---

# Build the video

Everything here happens in the studio install (`reconstruction-studio/`; see `../make-reconstruction-video/references/install.md`).

**References** (in `../make-reconstruction-video/references/`):
- `visual-style.md`: the look. Read it fully before designing any shot.
- `shot-planning.md`: from timed words to `shots.json`.
- `engine-api.md`: the sets, shots, overlay and kit API.
- `render-qc.md`: commands, speed, the QC checklist, troubleshooting.
- `sound-design.md`: music, SFX, ambience. The score itself is composed with the compose-music skill (`../compose-music/SKILL.md`).
- `media-sourcing.md`: real media rules and the source log.

## Preconditions
- `timeline/words.json` exists for the current `audio/voiceover.wav`, with a match of at least 90% (voiceover skill).
- The research files exist (`research/reconstruction_brief.md`, `ledger.md`, `quotes.md`, `media.md`).

## 1. Plan
1. Run `python tools/beats.py --project projects/<slug>` to get the draft shots.
2. Write `story/bible.md`: looks per chapter, sets, cast colour rules, motifs, evidence list, music plan.
3. Rewrite `story/shots.json` following `shot-planning.md`:
   - concrete `scene` descriptions;
   - footnotes;
   - transitions;
   - sfx/amb cues;
   - the music plan.
4. Write `story/shot_plan.md`, then send the user a 6–10 line summary. Continue unless they object.

## 2. Look test (the first checkpoint the user sees)
Build the 1–2 most important sets and 3 representative shots:
- a wide shot of the main place;
- a close detail (mechanism or interior);
- an evidence card or map.

Render a sheet with `--shots a,b,c --scale 0.5`. If the user hasn't fixed the look per chapter, show white clay vs full colour for the same moment (render the same shot with `look: 'clay'` and `look: 'day'`) and let them choose. Record the choice in `bible.md`.

## 3. Build in batches of 10–15 shots
For each batch:
1. **Write the code.**
   - Write or extend `scenes/sets/<set>.js`. Use real dimensions from the reconstruction brief. Put helpers for new objects in `scenes/lib/`.
   - Write `scenes/shots/<NNN>_<name>.js`, with one `registerShot` per id in shots.json.
   - Sync everything to the words with `info.w('phrase')`.
2. **Sheet** the batch: `node render.mjs --project projects/<slug> --sheet --shots <ids> --scale 0.4`.
3. **Look.** Open every sheet PNG yourself. Go through the checklist in `render-qc.md`.
4. **Fix and re-sheet** until the batch is clean.
5. **Motion-check** shots with complex moves using a short `--shots` preview, or `--stills` at the start, middle and end.

**Non-negotiables** (from the style guide):
- every 3D shot moves;
- every claim has its source on screen within about 10 s;
- footnotes on reconstructions and evidence;
- unknowns shown as unknowns;
- violence abstracted;
- overlay text verbatim from the research;
- no more than 3 similar shots in a row.

Keep `PROJECT_STATE.md` updated after each batch: shots done/total and any open issues.

## 4. Compose the score (the compose-music skill)
Once the shot timing is settled, compose the film's original music in `audio/score.py`:
- sections on the chapters;
- the film's motif;
- risers, hits and drops on the key words.

Render it with `python audio/compose.py --project projects/<slug>`. Run `python tools/music_setup.py` first on a new machine. Note the sync points in `PROJECT_STATE.md`. Mixing re-renders the score automatically whenever `score.py`, `shots.json` or `words.json` changes.

## 5. Preview (second user checkpoint)
1. When every shot exists, render a full sheet: `--sheet --scale 0.3`.
2. Render a preview at `--scale 0.5 --quality draft`. Use the whole film (`--from 0 --to <duration>`) if the machine has a GPU; otherwise render 2–3 representative minutes (the cold open, one mechanism sequence, one evidence-heavy part) with `--from A --to B --out build/preview_A.mp4`.
3. Mix a quick soundtrack onto it: `python audio/mix.py --project projects/<slug> --video build/preview_A.mp4 --start A --out build/preview_A_mix.mp4`. `--start` must equal the render's `--from`, so music and SFX line up.
4. Send the user the preview, or sheets plus a short clip, and ask: **approve for the final render, or what to change?** Include a line on the music: the sections, and where the hits and silences are. Claude can't hear it, so the user's ears decide.
5. If they're away, stop here with a summary. The final render is long, and a mistake there is expensive.

## 6. Final render and mix
1. **Render:** `node render.mjs --project projects/<slug> [--quality high] [--workers N]`.
   - Run it in the background and poll the log.
   - If the shell is a VM or the cloud, hand the user the commands for their own PC (install.md §5).
2. **Mix:** `python audio/mix.py --project projects/<slug>` → `out/<title>.mp4`.
3. **QC:** `python tools/qc_video.py --project projects/<slug>`. Open `build/qc_sheet.jpg` and spot-check full-size frames.
4. **Deliverables:**
   - `out/<title>.srt` (copy of `timeline/captions.srt`);
   - `out/description.txt`: summary, chapters with timestamps, then sources and credits from `research/sources.md` plus `python tools/media_log.py list`;
   - the `needs user decision` media items, if any.

## Fixes after review
- **A wrong shot:** edit its file and re-sheet that shot. Then run `node render.mjs --project projects/<slug> --shots s042,s043 --patch`: it re-renders just those shots at full size and splices them into `build/video_silent.mp4` frame-accurately. Re-run `audio/mix.py` after any change.
- **Timing feels off:** adjust `start`/`end` in shots.json (keep them contiguous), or the `info.w` phrases.
- **A new voiceover take:** re-run `transcribe.py`, then `beats.py --force` as a reference only. Re-time `shots.json` by phrase, so the scene work isn't lost.
