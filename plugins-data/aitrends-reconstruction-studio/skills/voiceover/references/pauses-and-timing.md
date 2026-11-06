# Pauses and timestamps

## Why the order matters
`voiceover_raw.wav` → **pauses.py** → `voiceover.wav` (the master) → **transcribe.py** → `timeline/words.json`.

Timestamps are always taken from the master. If pauses were cut after timestamping, every later word would drift.

## What the house style wants
In the measured reference narrations, the gap between sentences has a median of about 0.7 s and a 90th percentile of about 1.1 s. Deliberate beats before a reveal run 1.0–1.3 s. Dead air of 2–4 s (common with TTS paragraph gaps or self-recorded takes) feels like a mistake.

| Profile | Rule | Use |
|---|---|---|
| `documentary` | pauses > 1.15 s → 0.85 s | long-form default; keeps the beats, removes dead air |
| `gentle` | > 1.6 s → 1.1 s | when the user likes a slower, more spacious read |
| `tight` | > 0.6 s → 0.42 s | 9:16 shorts default; near-continuous delivery |
| custom | `--max A --to B` | e.g. "nothing longer than half a second" → `--max 0.5 --to 0.4` |

Leading silence is trimmed to 0.15 s (`--lead`) and trailing silence to 0.8 s (`--tail`). Cuts happen in the quietest middle of each pause, with 15 ms equal-power crossfades, so breaths at the edges survive and there are no clicks.

**Silence detection adapts to the file:** the threshold is about 30 dB under the speech level, never above speech − 18 dB, and it follows the noise floor of noisy home recordings. If a music bed is mixed into an upload, pause detection is unreliable. Say so and suggest `--skip` or a dry file.

## The question to ask (with real numbers)
After `python tools/pauses.py --project …`, quote its numbers. For example:
> The narration is 16 min 48 s. I found 37 pauses longer than 1.15 s (the longest is 3.4 s at 7:12). Shortening them to 0.85 s would save 41 s, making it 16 min 7 s. Shall I shorten them?

Options:
- Shorten long pauses (Recommended);
- Only the very long ones;
- Keep it exactly as recorded.

Their answer runs `--apply --profile documentary|gentle` or `--skip`. Record the choice in `PROJECT_STATE.md`.

## Whisper (faster-whisper)
- **Models:** `small` (default, good for clean TTS), `medium` (accents, names, noisy recordings), `large-v3` (hardest audio; slow on CPU), `base` (quick checks).
  - The first run downloads the model from huggingface.co: `small` is about 500 MB, `medium` about 1.5 GB.
  - With an NVIDIA GPU and CUDA libraries, faster-whisper uses the GPU automatically. Otherwise it uses int8 on the CPU: about 1–3× real time for `small`.
- **Alignment:** with `script/script_final.txt` present, the approved wording is aligned onto Whisper's word timings (difflib). The output keeps the script's spelling and punctuation, so on-screen text, captions and names are correct even when Whisper mishears them.
- **Outputs** (in `timeline/`):
  - `words.json`: `{source, words: [{word, start, end}]}` for every script word;
  - `sentences.json`;
  - `transcript.txt`: the approved wording with sentence times;
  - `whisper_heard.txt`: what Whisper actually heard (for spot checks);
  - `alignment_report.txt`: every place where script and audio differ (missing, extra or changed words, with times);
  - `captions.srt`.
  - It also updates `config.json` → `duration`.

## Checks before moving on
- **Match ≥ 90%.** 95–100% is typical for TTS of the exact script.
- **wpm:** 135–165 long-form, 160–190 shorts.
- **The end:** the last word's end is within about 1 s of the file end (after the 0.8 s tail).
- **Longest gaps** (printed): none over the profile max, unless `--skip` was chosen.

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| Match 60–85% | A paragraph was skipped or duplicated in TTS, or the user ad-libbed | Read `alignment_report.txt`: it lists where they part, with times. Regenerate that part, or (for a user recording) ask whether to adopt their spoken wording. If so, update the script, which needs re-approval, then re-align. |
| Match < 50% | Wrong file, or the wrong script version | Check the file name and duration, and `SCRIPT_APPROVAL.md`. |
| Words bunch up at one time | Whisper lost sync in music or noise | Use a dry file, `--model medium`, or split the long audio. |
| A name always fails | Unusual name | Fine: the script spelling is kept. Mention it so the user can listen to that word. |
| PyAV / av errors | Version mismatch inside faster-whisper | Already avoided: the tool decodes with ffmpeg. Update with `pip install -U faster-whisper` if it persists. |

After any change to the master: re-run `transcribe.py`, then `beats.py --force` (or re-time `shots.json` by phrase), then re-render the affected shots.
