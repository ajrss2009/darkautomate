---
name: voiceover
description: "This skill should be used when the narration for a reconstruction documentary needs to be made, imported, cleaned or timestamped — e.g. \"make the voiceover\", \"use VoiceStudio\", \"pick a voice\", \"use my ElevenLabs voice\", \"here is my ElevenLabs API key / voice ID\", \"I recorded the voiceover myself\", \"use this audio file\", \"remove the long pauses\", \"timestamp the narration\", \"run Whisper\", or when the Reconstruction Studio pipeline reaches the voice stage. It supports three engines (VoiceStudio on the user's PC with a voice they choose, ElevenLabs with their key and voice ID, or any file they upload), asks before removing long pauses, then makes word-level timestamps with Whisper aligned to the approved script."
metadata:
  version: "0.1.0"
  author: aiTrends
---

# Voiceover: generate or import → pauses (ask first) → timestamps

Everything downstream is timed to `timeline/words.json`, so this stage must end with a clean master (`audio/voiceover.wav`) whose words match the approved script.

**References:**
- `references/voicestudio.md`: operating the VoiceStudio desktop app by computer use, including letting the user choose the voice;
- `references/elevenlabs.md`: key and voice setup without exposing the key, samples, full narration;
- `references/pauses-and-timing.md`: the pause profiles, what to tell the user, Whisper models, alignment checks and fixes.

Tools run from the studio install (`reconstruction-studio/`; see `../make-reconstruction-video/references/install.md`). Use `python3` where `python` isn't Python 3.

## 0. Gate
- `script/SCRIPT_APPROVAL.md` must exist and its sha256 must match `script/script_final.txt`. If not, go back to the write-script skill.
- Exception: a voice test with neutral text is fine before approval.
- If the user brings their own finished audio and a script that isn't approved yet, approve the script first: the words in the audio are what will be timed.

## 1. Choose the engine
Skip the question if the user already said. Otherwise use AskUserQuestion:
- **VoiceStudio:** the free desktop app on their Windows PC. Claude drives it and they pick the voice. It needs this chat linked to their computer, with computer use available.
- **ElevenLabs:** needs their API key and a voice ID, or a voice name from their library. Uses their character quota (about 2,400 words ≈ 14,000 characters for a 16-minute film).
- **Upload my own file:** any tool or their own recording: wav, mp3, m4a, m4b, flac, ogg, or the audio of an mp4/mov.

Record the choice in `config.json` → `voice.engine`.

## 2. Make or import the raw narration → `audio/voiceover_raw.wav`
**VoiceStudio:** follow `references/voicestudio.md`.
1. Open the app and list the available voices (Gallery and Saved voices).
2. Let the user choose. Offer 2–3 short samples of the cold open when they're unsure.
3. Import `script/synthesis.txt` on the Stories page, generate, and export.
4. Run `python tools/voice_import.py --project projects/<slug> --file "<export>" --engine voicestudio --voice "<voice name>"`.

**ElevenLabs:** follow `references/elevenlabs.md`.
- The key goes in through a key file that the tool reads and deletes (or a hidden prompt, only when Claude's shell is the user's own terminal). Never put it in a command line, a project file or a reply.
- Run `python tools/elevenlabs_tts.py status`.
- Run `sample --project …` (about 400 characters of the cold open). The user listens and confirms the voice and pace.
- Run `speak --project …` → `audio/voiceover_raw.wav` plus `audio/voice_settings.md`.

**Upload:** the user attaches the file or gives a path in a connected folder.
- Run `python tools/voice_import.py --project projects/<slug> --file "<path>" --engine upload --voice "<tool/voice if known>"`.
- If the narration differs from the approved script (ad-libs, cuts), say so after the timestamp step. The match rate shows it.

Write `audio/voice_settings.md`: engine, voice, settings, seed, source file, date, duration and the import report. It never contains a key.

## 3. Long pauses — analyse, then ASK
Run `python tools/pauses.py --project projects/<slug>` (analysis only; nothing changes).

Then use AskUserQuestion with the real numbers from the output (how many pauses, the longest ones, total seconds saved, new length). Options:
- **Shorten long pauses (Recommended):**
  - long-form uses the `documentary` profile: pauses over 1.15 s become 0.85 s;
  - shorts use the `tight` profile: over 0.6 s becomes 0.42 s.
- **Only the very long ones:** the `gentle` profile, over 1.6 s → 1.1 s.
- **Keep it exactly as recorded.**

Then run `pauses.py --apply --profile <p>`, or `--skip`.
- The original stays in `voiceover_raw.wav`.
- The user's wording ("tighter", "0.5 s max") maps to `--max/--to` (see `references/pauses-and-timing.md`).
- **Unattended:** don't cut. Run `--skip`, and say that pauses were kept because nobody was there to confirm.

## 4. Timestamps (always after the pause step)
Run `python tools/transcribe.py --project projects/<slug> --model small`.
- Use `medium` or `large-v3` for accents, noise or names Whisper misses. Use `base` on slow machines.
- Check the output:
  - the **match rate is ≥ 90%** against `script_final.txt`;
  - the last word ends within 1 s of the file's end;
  - the pace is plausible: 135–165 wpm long-form, 160–190 for shorts.
- Read `timeline/alignment_report.txt`: every place where the audio differs from the script. Small items (number formatting like "34 ,000", a spelled name) are fine. Missing or extra phrases are not.
- Under 90%: find out why before going on (`references/pauses-and-timing.md` → troubleshooting). Usually the cause is a wrong file, a skipped paragraph or an ad-libbed take.

## 5. Report and hand over
Tell the user in 3–5 lines:
- engine and voice;
- final length (e.g. "15 min 42 s at 151 wpm");
- the pause step (what was removed);
- the match rate;
- anything to listen for (names Whisper heard differently, from `alignment_report.txt`).

Update `PROJECT_STATE.md`. Next comes the build-video skill (`tools/beats.py` → shot plan).

## Rules
- **The timestamps belong to the master.** Re-run `transcribe.py` whenever `audio/voiceover.wav` changes (new take, new pause setting), then re-run `beats.py --force` or re-time `shots.json`.
- **No secrets anywhere.** Never echo, log, commit or write an API key into the project. Status output shows a masked key only.
- **Consent for voices.** Use only voices the user has rights to (library voices, their own clones, VoiceStudio gallery voices or voices they designed). Don't imitate a real person's voice without their consent.
- **Claude can't listen.** Quality checks are Whisper recognition, loudness, peaks and pacing. Ask the user to listen to the sample and to the final narration before the long render, and say this plainly.
