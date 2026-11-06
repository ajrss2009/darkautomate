# ElevenLabs narration

`tools/elevenlabs_tts.py` calls the ElevenLabs text-to-speech API.
- It uses the with-timestamps endpoint, splits at paragraph and sentence boundaries (about 2,400 characters per request), and passes previous and next text so the delivery stays continuous.
- It stitches the parts into `audio/voiceover_raw.wav` at 48 kHz.
- It doesn't touch pauses: `pauses.py` handles them after asking the user.

## 1. The key and the voice (once per machine that runs the tools)
The config lives outside every project, at `~/.reconstruction_studio/elevenlabs.json` (file mode 600), in the home folder of **the machine where Claude's shell runs the studio tools**. The environment variables `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` override it.

**Never let the key reach a command line, a project file, a log, a script or a chat reply.** The tool has no `--key` option on purpose. Offer the user the method that fits where the tools run:
1. **Key file** (works everywhere; the default when Claude's shell is a VM or the cloud workspace):
   - The user saves the key as the only line of a text file, e.g. `el_key.txt`, in a connected folder (or attaches it).
   - Claude runs `python tools/elevenlabs_tts.py setup --key-file "<path>/el_key.txt" --remove-file`. The tool reads the key, stores it in the config and deletes the file. Claude never opens, prints or copies the file.
   - In a connected folder where deleting needs permission, `--remove-file` reports that it could not delete. Ask for delete permission for that folder first (the device's delete-permission request), or tell the user to delete `el_key.txt` themselves straight away.
2. **Hidden prompt** (only when Claude's shell is the user's own terminal on the same machine): the user runs `python tools/elevenlabs_tts.py setup --ask` there, which asks for the key with hidden input. If the user runs it in their own terminal while Claude's tools run in a VM or the cloud, the key lands on the wrong machine and `speak` finds none.
3. **Environment variable:** `ELEVENLABS_API_KEY`, set where the tools run.

If the user pastes the key into the chat anyway:
- Don't repeat it.
- Don't put it in a command line, because the command is displayed. Instead, write it to a temporary file outside the project (in the scratch folder), then run `setup --key-file <tmp> --remove-file`.
- Suggest they rotate the key in ElevenLabs (Developers › API Keys) once the video is done, since it's now in the chat history.

Secret keys start with `sk_`. The tool rejects key IDs.

**The voice:** `python tools/elevenlabs_tts.py setup --voice "<voice ID or exact name>"`.
- The user can copy the voice ID from ElevenLabs › Voices › the voice › "Copy voice ID".
- `voices` lists the voices in their account (name, ID, category). Use it to confirm a name, or to let them choose with AskUserQuestion (3–4 options plus Other).
- Voice IDs aren't secret, but keep them in the user config, not the project. `voice_settings.md` records the voice name and ID.

**Model:** the default is `eleven_multilingual_v2` (stable, good for long narration). `models` lists what their plan allows. Use `--model` on setup to change it.

Check everything with `python tools/elevenlabs_tts.py status`. It shows the masked key, the voice, the model and the subscription's character usage. Compare the usage with the script: characters ≈ script length (`wc -m script/synthesis.txt`). If the quota is too small, say so before speaking.

## 2. Sample, then the full narration
```bash
python tools/elevenlabs_tts.py sample --project projects/<slug> --text "A calm test sentence about a train on a hill."   # voice test, allowed before approval
python tools/elevenlabs_tts.py sample --project projects/<slug>            # ~400 chars of the approved cold open -> audio/sample.wav
python tools/elevenlabs_tts.py speak  --project projects/<slug>            # whole synthesis.txt -> audio/voiceover_raw.wav
```
`speak`, and `sample` without `--text`, refuse to run unless `SCRIPT_APPROVAL.md` matches `script_final.txt` and `synthesis.txt` was made from that version. The output is already `audio/voiceover_raw.wav`: don't run `voice_import.py` on it.

**Settings.** The defaults suit the house style: calm, even, not theatrical.
- `--stability 0.45`, `--similarity 0.8`, `--style 0.2`, `--speed 1.0`.
- **Flat or robotic:** stability 0.35–0.4, style 0.25–0.35.
- **Over-acted or unstable:** stability 0.55–0.65, style 0–0.1.
- **Pace:** `--speed` 0.95–1.08. The house style is about 150 wpm long-form (acceptable 135–165) and about 175 for shorts (160–190).
- `--seed N` makes a take reproducible.
- **Format:** the default `mp3_44100_128` works on every plan. `mp3_44100_192` needs Creator or above, `pcm_44100` Pro or above.

**After the sample:** check the words with `python tools/transcribe.py --project projects/<slug> --audio projects/<slug>/audio/sample.wav --check`, then ask the user to listen and confirm (Claude cannot hear it). Only then run `speak`.

**After `speak`:**
- the tool prints the duration and writes `audio/voice_settings.md`;
- the pace (wpm) is printed by `transcribe.py` after the pause step;
- continue with the pause question (voiceover SKILL, step 3).

## Errors
| Message | Meaning / fix |
|---|---|
| 401 rejected key | Key wrong or revoked. Re-enter with a key file (or `setup --ask` where that applies). |
| 402 / quota_exceeded | Not enough characters left. Upgrade, wait for the reset, or use VoiceStudio or upload instead. |
| voice not found | The name doesn't match exactly. Run `voices` and use the ID. |
| 429 | Rate-limited. The tool retries with back-off. If it keeps happening, run with fewer parallel jobs (one at a time). |
| A chunk sounds different | Re-run `speak` with the same `--seed`, or regenerate just that paragraph. Stitching uses previous/next text to keep the tone. |
