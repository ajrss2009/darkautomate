---
name: compose-music
description: "This skill should be used when a reconstruction documentary needs its music — e.g. \"make the music\", \"compose the score\", \"write music for the video\", \"the music should build here\", \"add a hit when …\", \"make the music darker / quieter / less busy\", \"change the music in chapter 3\", \"silence under that line\", \"install the music tools\", or when the Reconstruction Studio pipeline reaches the sound stage. Claude composes an original score for each film as code (audio/score.py: keys, chord progressions, a motif, instrument parts, risers, hits and drops synced to the narration's words), which is rendered with sampled instruments (FluidSynth or TinySoundFont + the GeneralUser GS SoundFont) and mixed under the voice."
metadata:
  version: "0.2.0"
  author: aiTrends
---

# Compose the film's score

Every film gets its own original music, composed by Claude. It is written as `projects/<slug>/audio/score.py` and rendered by `audio/compose.py`. Nothing is downloaded or licensed, and nothing comes from a music-generation service. The output:
- `build/music.wav`, the score;
- `build/score.mid`, a MIDI file the user can open in any DAW;
- `build/music_report.txt` and `build/music.json`: the checks Claude reads instead of listening;
- per-instrument stems in `build/music_stems/` (only with `--stems`; about 23 MB per part per minute).

`audio/mix.py` picks the score up automatically, ducks it under the voice and masters it.

**Read** `references/composing-guide.md`: the API, the house sound, voicing under narration, and sync technique. Tools run from the studio install (`reconstruction-studio/`; see `../make-reconstruction-video/references/install.md`).

## 0. Tools (once per machine)
Run `python tools/music_setup.py`. It installs:
- pip packages `mido`, `pedalboard` and `tinysoundfont`;
- the GeneralUser GS SoundFont (free for commercial music);
- FluidSynth: on Windows it downloads the official build into the studio folder.

It then test-renders 8 seconds.
- **FluidSynth is the renderer to have.** On macOS or Linux, `music_setup.py` prints the one system command (`brew install fluid-synth` / `sudo apt-get install -y --no-install-recommends fluidsynth`). Ask the user before running it with `--system`.
- **TinySoundFont is a fallback** (pip). It has wheels only for Python ≤ 3.12, and it balances some instruments differently.

## 1. Preconditions
- `timeline/words.json` and a near-final `story/shots.json`. Sync points are tied to words and shots, so compose after the shot plan is settled.
- If timing changes later, the score re-renders automatically (mix.py checks the file dates). Re-check the sync points, though.

## 2. Compose
1. **Start from the story.**
   - Read `story/bible.md` (chapters, tone), the script's turning points, and the music plan in `shots.json` if one exists.
   - List the 4–8 musical sections: usually one per chapter, plus a different colour for the event itself and for the aftermath.
2. **Starter file (optional).** Run `python audio/compose.py --project projects/<slug> --init` to get a starter `score.py` from the chapters. Then rewrite it for this film. Don't ship the starter unchanged.
3. **Write the score:**
   - **A home key** and a progression per section. The film's tonal centre stays the same; sections may move to the relative major or a related key.
   - **A motif that belongs to this film** (3–7 notes), stated sparsely and transformed: lower and slower for grief, fragmented for unknowns, complete at the end.
   - **The instrumentation per section** from the guide's palette.
   - **Layers that enter and leave with `bars=(a, b)`**, so the music develops instead of looping.
   - **Sync points on the exact words**, using `S.word("phrase")`, `S.wend("phrase", after=t)` and `S.shot("s042").start`:
     - a riser into the reveal;
     - a hit on it;
     - a drop to silence under the heaviest line (a hit placed at the drop's start rings out into it);
     - the music returning after it.
     - Use 3–8 sync points in a long film and 1–3 in a short.
   - **Level automation** (`S.level`) for the overall arc.
4. **Render:** `python audio/compose.py --project projects/<slug> --report [--from A --to B]`. It prints each section's key, tempo, bars and chords, plus the checks.
5. **Check, using the report** (`build/music_report.txt`; see the guide):
   - **Clashes:** fix them all.
   - **Cut notes:** move or shorten motifs.
   - **Busy-under-voice windows:** thin them out.
   - **The sync table:**
     - every hit at least +6 dB over the bed;
     - riser peaks at their time;
     - drops silent.
   - **Levels:** loudness about −20 LUFS, peak ≤ −1.5 dBFS.
   - **Deeper look:** add `--stems` to keep per-part audio.
   - **In context:** mix a preview (`python audio/mix.py --project … --video build/preview.mp4 --start A --out build/preview_mix.mp4`).
   - **Claude can't hear the result.** Tell the user what to listen for: the tempo and mood of each section, and where the hits and drops are. Send them a preview mix, plus the MIDI file if they want to tweak it in a DAW.
6. **Revise** from the user's notes: "darker" means lower register, a minor or modal colour, fewer high parts. "Less busy" means remove arps and ticks, longer notes. "Builds too early" means move the layer `bars`.

## 3. Use it in the mix
- `config.json` → `music.source` is `"score"` (the default in new projects). `"file"` uses the user's own track (`music.file`); `"procedural"` uses the old synth bed.
- Set the level with `music.gainDb`: start at −19 dB relative to the voice, and use −16 to −22 to taste.
- `python audio/mix.py --project projects/<slug>` re-renders the score if it's out of date, then mixes.

## Rules
- **Original only.** Never imitate a recognisable copyrighted theme or melody, or "the theme from …". Compose fresh motifs.
- **Under the voice.** Busy melody belongs in gaps and in sections without narration. While the narrator speaks, keep parts sustained or low, and keep high sparkle quiet (see the guide).
- **Respect.** No triumphant or "action" scoring over victims or injuries. Use silence or a sustained pad instead.
- **Deterministic.** The same `score.py` gives the same music (seeded humanisation; `config.music.seed`), so a re-render after a timing change only moves what changed.
- **No unedited starters.** The `--init` file is marked `# STARTER SCORE`, and compose and mix warn while that line is there. Compose the film's own score, then delete the line.
