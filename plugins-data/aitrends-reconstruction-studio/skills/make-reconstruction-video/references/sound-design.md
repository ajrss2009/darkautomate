# Sound design

The reference films are restrained:
- **Narration** is upfront and dry.
- **Music** is a low, slow investigative score (soft piano, pulses, pads, slow strings) that rarely swells. Here it is composed for each film by Claude (see below).
- **SFX** are sparse and diegetic: cabin hum, track clack, a station chime, an alarm, the snap of a mechanism, paper and shutter sounds on evidence.

Nothing should compete with the words.

`audio/mix.py` builds everything from `story/shots.json` and `config.json`:
- music −9 dB and ambience −5 dB under the voice (ducked);
- the master is normalised to −14 LUFS (YouTube), with true peak at −1.5 dBTP;
- output: `build/mix.wav`, then `out/<title>.mp4` muxed with `build/video_silent.mp4`.

## Music: an original score for every film, composed by Claude
The music is composed for each film by Claude, as code, in `audio/score.py`. It's rendered with sampled instruments by `audio/compose.py`, which uses FluidSynth or TinySoundFont plus the GeneralUser GS SoundFont, installed by `tools/music_setup.py`. The result is `build/music.wav`, plus `build/score.mid` and the stems. **The compose-music skill** runs this stage; its `references/composing-guide.md` has the API, the palette, writing under the narrator, and sync technique.

- **Sections** follow the chapters (every 60–180 s in long-form), each with its own key/progression, tempo and instrumentation. The tempo is nudged so whole bars land exactly on the section boundaries.
- **The film's motif** (3–7 notes) is stated sparsely and transformed across the film.
- **Sync points on words:**
  - a riser into the reveal and a hit on it (`S.riser`, `S.hit` at `S.word("…")`);
  - silence under the heaviest line (`S.drop`).
- **Levels:** the score is normalised to −20 LUFS. `config.music.gainDb` sets it against the voice: new projects use −19 dB, and −16 to −22 is the useful range. The mix ducks it another 9 dB under speech.
- **Fallbacks and alternatives:**
  - `config.music.source = "file"` with `music.file` uses the user's own licensed track (looped or trimmed with a fade).
  - `"procedural"` uses the simple synth bed from the `"music"` plan in shots.json (`audio/music.py`; moods investigation, tension, somber, mystery, dark, calm, hopeful, epic…).
  - mix.py also falls back to the procedural bed, with a warning, if the score can't render.

Moods as a guide to scoring each part of the story:

| Mood | Use |
|---|---|
| `investigation` | setting the scene, evidence, the investigation: felt piano motif, warm pad, slow strings, a soft side-stick clock |
| `tension` | the event itself, the minutes before and during: low synth pulse, tremolo strings, building, a hit |
| `somber` | victims, aftermath, family statements: slow strings, cello motif, no rhythm |
| `mystery` | open questions, possibilities: halo pad, celesta pattern, drone |
| `dark` | the worst moment, if it needs music at all: drone, glass pad, timpani |
| `calm` / `hopeful` | context, history, recoveries (sparingly): piano arpeggios in the relative major |

Intensity 0.25–0.45 is normal; above 0.6 only at the event. **Silence** for 2–6 s on a key line is a valid choice.

## SFX (per shot `"sfx": [{"at": 0.3, "name": "whoosh", "gain": -12}]`)
`at` is seconds from the shot start, ideally `info.w`-aligned to the word. Optional `dur`, `seed`, `pitch`. `name` can also be a project-relative path to the user's own wav or mp3.

**Library** (`python audio/sfx.py --list`; audition all with `--demo build/sfx_demo`):
- **Reconstruction set:** `clack` (coaster chain lift / track), `cabin` (aircraft cabin hum), `alarm` (cockpit or master caution), `clacker` (overspeed), `radio` (ATC burst), `typing`, `shutter` (photo appears), `paper` (document appears), `boom`, `siren`.
- **General:** `whoosh`, `swish`, `impact`, `hit`, `riser`, `tick`, `clock`, `heartbeat`, `pop`, `blip`, `counter`, `ding`, `shimmer`, `stinger`, `footstep`, `wind`, `rain`, `thunder`, `roomtone`, `city`, `murmur`, `hum`, `glitch`, `flash`, `buzz`, `phonebuzz`, `phonering`, `cheer`, `applause`, `carpass`, `kick`, `whistle`, `powerup`, `slowmo`, `freeze`.

**Conventions for this style:**
- **Evidence cards:** `paper` on documents, `shutter` on photos, a soft `blip` (−16) on cards and tags. Articles get nothing, or a very soft `paper`.
- **Clock-time chips:** a single `tick` (−18).
- **Mechanisms:** a `hit` at low pitch (0.7–0.8) on each ratchet click, at −12.
- **The moment of failure:** a `riser` (−14) for 1–2 s before it, then `impact` or `boom` at −8 with the `flash` transition. Then silence for 0.5–1 s.
- **Maps:** a soft `whoosh` (−16) on fast moves only.
- **Gains:** −14 to −18 for UI ticks, −8 to −12 for diegetic sounds, −6 to −8 only for the one big moment. Never stack more than 2 cues at once.

## Ambience beds (per shot `"amb": {"name": "cabin", "gain": -24}`)
Looped with 0.4 s fades:
- aircraft interiors: `cabin`;
- outdoors: `wind` or `city`;
- crowds and queues: `murmur`;
- indoors: `roomtone`;
- machinery: `hum`.

Keep them at −20 to −28. Use the same bed on consecutive shots of the same set, so the place feels continuous.

## Respect
No screams, crashes or injury sounds for real victims. Imply instead: the alarm, then silence. Keep sirens distant and short.
