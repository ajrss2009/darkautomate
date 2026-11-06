# VoiceStudio (desktop app, operated by computer use)

VoiceStudio is a Windows desktop text-to-speech app that runs locally (it uses the GPU with CUDA when available). Its default engine is "VoiceStudio TTS" (OmniVoice, zero-shot, many languages).

Claude operates it through computer use on the user's PC.
- **Requirements:** the chat must be linked to the user's computer and the `mcp__remote-devices__computer_*` tools must be present.
- **Read the computer-use skill first.** If a `computer-use` skill is listed, read its SKILL.md before the first action. It covers access requests, screenshots, zoom and batching.

The layout can change between app versions, so find every control by screenshot and zoom rather than fixed coordinates. Names used below were observed in a working session: **Design** page, **Gallery**, **Saved voices**, **Stories** page, **Settings › Models › TTS**, **Export**.

## 0. Preparation
- **Project folder:** the project must be on the user's computer (a connected folder), so the app can import the script and export to `audio/`.
  - If the studio runs in the cloud workspace, copy `script/synthesis.txt` to a connected folder first, and later stage the export back.
- **Speakable text:** `script/synthesis.txt` must exist (from `script_export.py`), with pronunciation respellings done and plain paragraphs. Visual notes are already stripped.
- **Request access:** call `computer_request_access` for VoiceStudio. The executable is usually `%LOCALAPPDATA%\Programs\VoiceStudio\VoiceStudio.exe`. Give the reason: "Generate the narration with the voice you choose."
- **Open the app:** `computer_open_application` "VoiceStudio", then take a screenshot.
  - If it isn't installed, say so and offer ElevenLabs or upload. Don't install apps on the user's PC without asking.

## 1. Let the user choose the voice (required)
1. **Check the engine.** Open **Settings › Models › TTS** and note which engine is selected (e.g. "VoiceStudio TTS"). Don't change it unless the user asks.
2. **Gather the voices.**
   - Open the **Design** page: the **Gallery** lists ready-made voices ("archetypes") with descriptions such as "male, middle-aged, low pitch, American accent".
   - **Saved voices** lists voices the user designed or saved before.
   - Scroll through both lists and zoom in to read every name and description. Write the list down: name, description, and where it lives (Gallery or Saved).
3. **Shortlist** 3–4 voices that suit the house style, if the user hasn't named one:
   - a calm, low-to-mid pitch, documentary or narrator voice;
   - neutral accent unless the user wants otherwise;
   - not theatrical, not "trailer".
   - Put the user's saved voices first: they're probably there for a reason.
4. **Ask.** Use AskUserQuestion: "Which VoiceStudio voice should narrate?"
   - Options are the 3–4 shortlisted names, each with its description. "Other" lets them type any voice from the list.
   - Before the question, send the full list of names in one message, so they can pick something outside the shortlist.
5. **Offer samples** if they're unsure. On the Design page, generate the same 15–25-second passage (the cold open from `synthesis.txt`) with each candidate.
   - Export or save each one as `audio/sample_<voice>.wav`.
   - Tell the user where the files are and ask them to listen. Claude cannot hear them.
   - Check each sample with Whisper to confirm every word is recognised: `python tools/transcribe.py --project projects/<slug> --audio projects/<slug>/audio/sample_<voice>.wav --check`. It prints what was heard and writes nothing. Names count most.
6. **Save the choice.** If the chosen voice came from the Gallery, save it to **Saved voices** so later takes use exactly the same voice. Record its name in `config.json` → `voice.voice`.

**Designing a new voice from a description or reference audio:** if the user wants a custom voice and the app offers it, do it on the Design page, and only with a voice the user has the rights to (their own voice, or one they're licensed to use). Never imitate a real person without their consent.

## 2. Generate the full narration (Stories page)
1. **New story.** Open the **Stories** page, create a new story and name it after the project slug.
2. **Import.** Import `script/synthesis.txt`.
   - Choose **split by paragraphs**: each paragraph becomes a line. This keeps the chapter rhythm.
   - Set the language (English unless the script is in another language).
3. **Assign the chosen voice** to all lines.
4. **Settings.**
   - **Speed 1.00×.** The house style is about 150 wpm. If the sample sounded slow or fast, use 0.95–1.08×. Shorts can go to 1.05–1.10× when a hard length limit applies.
   - **Seed:** a fixed seed (e.g. 42), so a re-take is reproducible. Record it.
   - **Trim engine silence: ON.**
   - **Gaps:**
     - long-form: 400–500 ms between lines and 600–800 ms between paragraphs or chapters;
     - shorts: 250–350 ms everywhere.
     - The pause step can tighten these later, so it's fine to err long.
   - **Loudness normalisation: OFF** (dry). The mix stage normalises to −14 LUFS.
   - **Quality overrides:** leave them at the default or production preset, unless the user has their own settings.
5. **Generate.**
   - Watch progress with screenshots spaced out by waits (it can take minutes for 15 minutes of audio).
   - Afterwards, scroll through the lines and check none are marked failed or empty. Regenerate any that are.
6. **Export.** Use the story's **Export**.
   - The native format observed was **.m4b** (AAC, 24 kHz mono). That's fine: `voice_import.py` converts it.
   - Save to `<project>/audio/` with a descriptive name: `vo_take<A>_<voice>_<speed>x_seed<seed>.m4b`.
   - If a save dialog opens, select the file-name field, press ctrl+a, type the full path, then Enter.

## 3. Import and check
```bash
python tools/voice_import.py --project projects/<slug> --file "projects/<slug>/audio/vo_takeA_<voice>_1.00x_seed42.m4b" --engine voicestudio --voice "<voice>"
```
The import report gives the duration, loudness, peak and wpm against the script.
- **Too fast or too slow** (outside 135–165 wpm long-form or 160–190 for shorts, or the short misses its length target): re-generate with an adjusted speed as take B. Never time-stretch the audio.
- **Write `audio/voice_settings.md`:** app and engine, voice (Gallery/Saved), the import settings, speed, seed, gaps, trim, normalisation, file names, durations and anything rejected.

Then continue with the pause question in the voiceover SKILL (step 3).

## Troubleshooting
- **App is slow or out of GPU memory:** close other GPU apps, or generate in two halves (two stories) and join them with a 0.6 s gap: `ffmpeg -i a.m4b -i b.m4b -filter_complex "[0:a]apad=pad_dur=0.6[a0];[a0][1:a]concat=n=2:v=0:a=1" out.wav`.
- **A name is mispronounced:** change only `synthesis.txt` (the respelling) and regenerate that line. The captions use `script_final.txt`, so they keep the right spelling.
- **Line order is wrong after import:** re-import with paragraph split. Don't hand-reorder long scripts.
- **No computer use, or the chat isn't linked:** ask the user to generate in VoiceStudio themselves, using the settings above (voice, speed 1.00×, seed, gaps, normalisation off), and to upload the export. Then run `voice_import.py`.
