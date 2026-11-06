# aiTrends Reconstruction Studio

This plugin makes "what really happened" 3D reconstruction documentaries about real, trending incidents:
- **Long-form:** 12–18-minute 16:9 films.
- **Shorts:** 60–90-second 9:16 videos.

Every frame is drawn in code (Three.js sets and mannequins, HTML evidence cards, maps and charts), so the visuals are consistent, precise and honest. No image or video generation models are used.

## What it does
1. **Finds stories.** It searches recent news, scores candidates on how well they suit a reconstruction, and shows a ranked shortlist. You pick one, or paste your own topic.
2. **Researches them in depth.** It builds a numbered fact ledger with sources, a clock-time timeline, verbatim quotes, the people involved (with naming rules), the unknowns and precedents. It also writes a reconstruction brief (real dimensions and layouts for the 3D) and a media list with the licence basis of each item. It captures article screenshots with the quoted phrases located for highlighting.
3. **Writes the script.** It writes in a calm, forensic house style (described in detail inside the plugin), with a cold open, a "This is the story of…" litany, clock-time chronology, sourced quotes, stated unknowns, a dated status wrap and a quiet ending. The script is linted, and **you approve it before any voice is made**. You can also paste your own script.
4. **Records the voiceover.** Three options:
   - **VoiceStudio** on your PC. Claude opens the app, lists its voices and lets you choose, with samples if you like.
   - **ElevenLabs** with your API key and voice ID. The key is entered privately and stored outside every project.
   - **Upload** any audio file you made elsewhere.
5. **Removes long pauses, after asking.** It measures the pauses and tells you what it would shorten and how much time that saves. Then you choose: shorten, only the very long ones, or keep as recorded.
6. **Timestamps the narration.** Whisper (faster-whisper) produces word-level timings aligned to the approved script.
7. **Builds the video.** In order:
   - a shot plan timed to the words;
   - 3D sets in white clay or full colour (aircraft, cabins, cockpits, coasters and trains, parks and forests, buildings, rooms, maps with routes);
   - evidence cards: article and document highlights, quote cards, stats, charts, lists, possibility panels;
   - contact-sheet checks, a preview for your approval, the final render, SFX, and loudness mastering to −14 LUFS.
8. **Composes the music.** Claude writes an original score for each film as code: a home key and chord progressions per chapter, a motif for the story, instrument parts (piano, strings, pads, bass, percussion), and risers, hits and silences placed on the exact words. It's rendered with sampled instruments (FluidSynth or TinySoundFont with the GeneralUser GS SoundFont, which is free for commercial use), then ducked under the voice. You also get the score as a MIDI file to open in any music app. You can use your own licensed track instead.
9. **Delivers** the MP4, captions (.srt), and a description with chapters, sources and media credits.

## Skills
| Skill | Use it for |
|---|---|
| `make-reconstruction-video` | The whole pipeline, end to end, with checkpoints |
| `find-stories` | "Find me trending stories to reconstruct", or a check on your own topic |
| `research-story` | Deep, sourced research and the 3D brief |
| `write-script` | Write, check or adopt a script; the approval gate |
| `voiceover` | VoiceStudio, ElevenLabs or upload; the pause question; Whisper timestamps |
| `build-video` | Shot plan, 3D sets and shots, previews, final render, mix |
| `compose-music` | The film's original score: compose, change ("darker here", "silence under that line"), render |
| `setup-studio` | Install or check everything; a rendered self-test |

Just ask in plain words, e.g. "Find a trending story and make a reconstruction video", "Make a 60-second short about this article: <link>", or "Here's my script, use my ElevenLabs voice".

## What gets installed (with your OK)
- **ffmpeg:** encoding.
- **Node.js packages:** Three.js, postprocessing and N8AO (ambient occlusion), Playwright, map data (world-atlas, us-atlas), fonts.
- **Headless Chromium:** draws the frames.
- **Python:**
  - numpy and scipy: sound effects;
  - mido and pedalboard: the score's MIDI, reverb and mastering;
  - TinySoundFont: a sample synth for the score;
  - faster-whisper: timestamps;
  - requests: ElevenLabs;
  - PyMuPDF (optional): PDF highlights.

- **The score's instruments:** the GeneralUser GS SoundFont (about 32 MB), plus FluidSynth, the best-sounding renderer. On Windows FluidSynth is downloaded into the studio folder; on macOS it's `brew install fluid-synth`; on Linux it comes from apt. Without FluidSynth, TinySoundFont plays the score instead.

The studio is copied into a `reconstruction-studio/` folder in your workspace. Each video lives in `reconstruction-studio/projects/<name>/`.

## Rendering speed
A graphics card matters most.
- **On a desktop with a GPU,** a 15-minute 1080p film renders in roughly 0.5–2 hours.
- **Without a GPU** (cloud workspace, or a VM shell), rendering falls back to software. That's fine for previews and contact sheets, but very slow for a full film.

In that case the plugin prepares everything and gives you two commands to run the final render on your own PC.

## Requirements and notes
- Web search and fetch are used for story finding and research.
- **VoiceStudio:** needs the chat linked to your Windows PC, with computer use available. Otherwise you can generate the audio in VoiceStudio yourself and upload it.
- **ElevenLabs:** uses your own subscription's character quota (about 14,000 characters for a 16-minute film).
- **Real media** (photos, screenshots, documents) is logged with its source and basis in `research/media_log.csv`. Borderline items are flagged for your decision. This is not legal advice.
- **Style:** the house style follows the restrained look of investigative reconstruction channels. Violence is abstracted, minors are never identified, and accused people are described by their exact legal status.

Version 0.2.0 · aiTrends
