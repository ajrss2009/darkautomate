---
name: make-reconstruction-video
description: "This skill should be used when the user wants a complete 'what really happened' 3D reconstruction documentary made, end to end — e.g. \"make a reconstruction video\", \"make a video about this incident\", \"do the whole video\", \"make a video like the coaster/flight ones\", \"find a trending story and make the video\", \"turn this story into a 3D documentary\", \"make a 60-second short about …\", or \"/make-reconstruction-video\". It runs the full pipeline with user checkpoints: find and pick a story (or use the user's), install the studio, deep research with sources, script in the house style (or the user's script) with approval, voiceover (VoiceStudio, ElevenLabs or an upload) with optional pause removal and Whisper timestamps, shot plan, Three.js reconstruction (white clay or full colour), an original score composed by Claude for the film, preview, final render, SFX mix and delivery, in 16:9 long-form or 9:16 shorts."
metadata:
  version: "0.1.0"
  author: aiTrends
---

# Reconstruction Studio: the full pipeline

Make calm, forensic, sourced 3D reconstruction documentaries about real, recent incidents.
- **Length:** 12–18-minute 16:9 films or 60–90-second 9:16 shorts.
- **How every frame is made:** code. Three.js sets and mannequins, HTML evidence cards, maps and charts, rendered frame by frame in headless Chromium, then encoded with ffmpeg.
- **What is never used:** image or video generation models. That keeps it consistent, precise and honest.

**This skill's bundled resources:**
- `kit/`: the tested studio. It contains:
  - the engine: `engine/*.js`;
  - the renderer: `render.mjs`;
  - tools: `tools/*.py`, `tools/*.mjs`;
  - audio: `audio/*.py`;
  - `examples/demo`: 7 sets and 16 shots covering every device.

  Install it as `reconstruction-studio/` (`references/install.md`).
- `references/install.md`: where to install, dependencies, doctor, self-test, rendering on the user's PC.
- `references/visual-style.md`: **the look.** Read it fully before planning any shot.
- `references/shot-planning.md`, `references/engine-api.md`, `references/render-qc.md`, `references/sound-design.md`, `references/media-sourcing.md`.

**Stage skills in this plugin** (run them for their stage; each has its own references):
- `find-stories`: trending story search, ranking and the user's pick;
- `research-story`: dossier, ledger, quotes, reconstruction brief, media;
- `write-script`: house-style script, lint, approval;
- `voiceover`: VoiceStudio / ElevenLabs / upload, the pause question, Whisper;
- `build-video`: shot plan, sets and shots, sheets, preview, final, mix;
- `compose-music`: the film's original score as code (keys, motif, parts, risers, hits and silences on the words), rendered with sampled instruments;
- `setup-studio`: install, doctor, self-test.

## Golden rules
1. **Real, sourced, honest.**
   - Every fact on screen and in the narration traces to `research/ledger.md`.
   - Quotes are verbatim.
   - Unknowns are said and shown as unknown.
   - Reconstructions are labelled.
2. **User checkpoints.**
   1. Story pick.
   2. Format.
   3. Script approval: required, never self-approved.
   4. Voice engine and voice.
   5. Pause removal: always ask.
   6. Look test.
   7. Preview before the final render.

   If the user is away, take the safe default, say so at the top of the work, and stop at the script-approval gate and the final-render gate.
3. **The narration is the clock.** Once the voiceover is timestamped, every shot is timed to its words, and the words never change without re-approval and new timestamps.
4. **Draft, look, fix, then render.** Open contact sheets yourself before any long render.
5. **Files are the truth.**
   - Each film lives in `reconstruction-studio/projects/<slug>/`.
   - `PROJECT_STATE.md` says where things stand. Update it at every stage, so a later session can resume.
6. **Respect.**
   - No graphic depictions; no identifying minors.
   - Accused people get their exact legal status.
   - Family wishes are honoured.
   - Never put a secret (ElevenLabs key) in any file, log, command line or reply.

## Stage 0: Intake (one AskUserQuestion, skip what's already known)
- **Story:** "find trending stories for me", or their own topic, links or headline. If they already gave one, don't ask.
- **Format:** this plugin asks every time.
  - **Long-form 16:9:** 12–18 min, 1080p.
  - **Short 9:16:** 60–90 s, 1080×1920, captions on.
  - **Both:** a long film plus a short cut from it. Each gets its own script approval and voiceover.
- **Script:** "write it for me" or "I have my own script" (they paste or attach it).
- **Voice:** asked later, at Stage 5, unless they volunteer it now.

Defaults if they don't say:
- long-form 16:9 1080p 30 fps;
- look decided after research (clay for interiors and sensitive events, colour for outdoor places; both can mix);
- an original score composed for the film (compose-music), plus SFX;
- captions off for long-form, on for shorts.

## Stage 1: Story
- **No topic yet:** run the `find-stories` skill (rubric scoring, shortlist, AskUserQuestion pick).
- **The user gave a topic:** do its viability check (step 4 of that skill).

Output: `research/brief.md`.

## Stage 2: Install or check the studio (in parallel with research where possible)
Run the `setup-studio` skill (= `references/install.md`). Then create the project inside `reconstruction-studio/`:
```bash
python tools/new_project.py --name <slug> --title "<Title>" --format long|short [--look clay|day] [--resolution 1080p] [--captions]
```
- `--look` is the default for any 3D shot that doesn't name its own look, and the theme of 2D cards. Choose `clay` or `day` from the story; shots and sets can still pick any look.
- For **Both**, create two projects: `<slug>` (`--format long`) and `<slug>-short` (`--format short`). The short reuses the long film's research (copy `research/`) and sets, but gets its own script, approval and voiceover.

Then move `research/brief.md` (and `candidates.md`) into `projects/<slug>/research/`.

## Stage 3: Research
Run the `research-story` skill. It produces the ledger, timeline, quotes, people, unknowns, precedents, reconstruction brief, media list, sources, and the evidence captures. Send the user its 8–12 line summary.

## Stage 4: Script, with the approval gate
Run the `write-script` skill:
- Path A: write it;
- Path B: adopt the user's script.

It ends only when `script/SCRIPT_APPROVAL.md` matches `script_final.txt`, and `synthesis.txt` is ready.

## Stage 5: Voiceover → pauses → timestamps
Run the `voiceover` skill:
1. The engine question: VoiceStudio / ElevenLabs / upload.
2. **The voice:**
   - **VoiceStudio:** list its voices and let the user pick (the voiceover skill's `references/voicestudio.md`), with samples if they're unsure.
   - **ElevenLabs:** use their voice ID or a pick from their library.
3. The sample, then the full narration. VoiceStudio exports and uploads go through `voice_import.py`; ElevenLabs writes `audio/voiceover_raw.wav` directly.
4. **Pause analysis, then ask the user** (shorten / only very long / keep), then apply.
5. Run `transcribe.py`: match ≥ 90%.

## Stage 6: Build, preview, final
Run the `build-video` skill:
1. Beats, the bible and `shots.json`, the plan summary.
2. Look test → user.
3. Batches of 10–15 shots with sheet QC.
4. The score: run the `compose-music` skill. It writes `audio/score.py` for this film (sections on the chapters, the motif, sync points on the key words) and renders it.
5. Preview, with the music mixed in → user approval.
6. Final render on the fastest machine available (the user's GPU if possible).
7. Mix, QC, deliverables.

## Stage 7: Deliver
1. Send `out/<title>.mp4` (SendUserFile, or say where it is on their computer) and `out/description.txt` (sources, credits, chapters).
2. Add `out/<title>.srt` if captions were requested.
3. In 3–5 lines give:
   - the length, look and voice;
   - anything approximated or withheld;
   - any `needs user decision` media.
4. Offer one natural next step: a 9:16 short from the same research and sets, or a thumbnail frame (`--stills` at the strongest moment with `--noui`).

## Resuming
Read `projects/<slug>/PROJECT_STATE.md` and the newest files in each folder, then continue from the first incomplete stage.
- Never redo an approved stage silently.
- If the story has developed since (a newer official statement), tell the user before changing an approved script.

## Typical time
- research: 20–40 min;
- script: 15–30 min plus the user's review;
- voice: 10–30 min;
- build: 2–6 hours of agent work for a long film (around 250 shots);
- score: 20–40 min to compose; rendering takes about a minute;
- render: 0.5–2 h on a GPU (much longer in software).

Shorts take about a fifth of that.
