# Composing guide: the API, the house sound, and syncing to the narration

## How it renders
1. `score.py` adds notes to instrument parts.
2. Each part becomes a MIDI track (`build/score.mid`, which opens in any DAW) and is rendered on its own:
   - **FluidSynth** (the reference renderer);
   - or **TinySoundFont**, when FluidSynth is missing or fails on a part;
   - with a General MIDI SoundFont: GeneralUser GS by default. `config.music.soundfont` can point at another `.sf2`/`.sf3`, for example an orchestral bank the user owns.
3. Per part: a high-pass filter (and a low-pass on some), gain and pan, plus a send to a shared hall reverb (`config.music.reverb = {size, damping, gainDb}`).
4. The main bus gets light compression (2:1), then the drops. Hits get their own reverb and skip the compressor and the drops, so they stay punchy and ring out into a silence.
5. Then the level automation, a limiter at −1.5 dB, and loudness normalisation to `music.lufs` (−20).
6. The renderer writes `build/music.wav`, `build/music.json` and **`build/music_report.txt`**. Stems are kept only with `--stems`.

**Renderer balance:** TinySoundFont plays some instruments up to about 10 dB louder or softer than FluidSynth (strings and tremolo especially), so a score balanced on one renderer can sound different on the other. Compose and check with FluidSynth (`music_setup.py` installs it on Windows; it's `brew install fluid-synth` on macOS and apt on Linux).

## The report: how to check a score you can't hear
Every render prints a summary and writes `build/music_report.txt`; `--report` prints it all. Read it after every render and fix what it flags:
- **SECTIONS:** key, the actual tempo (flagged if bar-fitting moved it more than 8%, or the section isn't bar-fitted), and the chords bar by bar in letter names.
- **CLASHES:** held melody notes a semitone above a chord tone (minor 9ths). Rewrite these.
- **TENSIONS:** 9ths and major 7ths. These are fine as colour; check only the long ones.
- **CUT AT SECTION ENDS:** motif notes dropped or shortened because they ran past the section. Move the motif earlier or shorten it.
- **BUSY HIGH PARTS UNDER THE VOICE:** windows with 6 or more loud notes above C5 while words are being spoken. Thin them out, lower the velocity, or move them to gaps.
- **SYNC POINTS:** for every hit, riser and drop, the nearest word and the level before and after.
  - A hit should be at least +6 dB over the bed 3–6 s before it.
  - A riser's peaks should sit at its time.
  - A drop should read about −100 dB inside.

## The API (inside `score.py`)
```python
S.set_key("D minor")                                   # home key: 'D minor', 'Eb major', 'F# dorian', 'E phrygian' …
theme = Motif("5 4 3 . 1 2 3", "1 .5 1.5 1 1 1 2")    # scale degrees of the key's MODE (or UPPERCASE note names 'A4'), '.' rest; beats
#   degrees: 1..7, 8 = octave up, 5- = an octave down, 3+ = up; accidentals alter the MODE's degree:
#   in D minor '3' = F, 'b2' = Eb, '#4' = G#, '#7' = C# (leading note);  theme.transposed(-2) moves it down two degrees

A = S.section("open", t0, t1, bpm=84, key=None, meter=4, chords="i:2 bVI:2 bIII:2 bVII:2", fit="auto")
#   fit="auto": the tempo is nudged (up to 10%) so whole bars land exactly on t0..t1 (A.bpm, A.bars). If that would need
#   more, the tempo is kept and notes stop at t1 (the report says so). Chords cycle to fill the section.
#   chords: roman numerals relative to the tonic's MAJOR scale (unlike motif degrees) — in D minor: i=Dm, bIII=F, iv=Gm,
#           v=Am, V=A, bVI=Bb, bVII=C, bII=Eb. Extensions 7 (dominant on upper case, minor 7 on lower case, °7 = fully
#           diminished), ø7 (half-diminished), maj7, m7 (minor 7 chord), 9, add9, 6, sus2, sus4, + (aug); /N puts degree N
#           of the key's MODE in the bass (i/5 in D minor = Dm/A). "i:2" = 2 bars, "-" = repeat a bar.

A.pad("pad_warm", octave=3, vel=40, voicing="open", swell=0.3, bars=None)   # sustained, voice-led chords (open|close|spread|shell)
A.strings("strings_slow", octave=3, vel=38, swell=0.45)                     # pad with string defaults (spread voicing)
A.bass("contrabass", octave=2, vel=46, rhythm="whole", notes="1")          # whole|half|quarter|pulse8|pulse16|dotted|[1.5, 2.5];
#                                                                            notes "1 5": restarts on each chord; "1" follows slash basses
A.pulse("synth_bass", octave=2, vel=50, step=0.5)                           # driving root pulse
A.arp("celesta", "1 5 8 10 8 5", step=0.5, octave=5, vel=28)                # chord-tone indexes 1 3 5 7 8 9 10 12 14 15, '.' rest
A.motif(theme, "felt_piano", at=[1, (5, 2.0)], every=None, octave=5, vel=48, transpose=0)
A.ostinato(Motif("1 5- 1 8-", ".5 .5 .5 .5"), "pizz", octave=3, vel=40, every=1)
A.drums({"kick": "x...............", "hat": "..x...x...x...x."}, kit="kit_room", step=0.25, vel=60, swing=0)
#   each string cycles over the steps (a bar = meter/step steps; a longer string spans several bars); x, X accent, o soft, . rest
A.ticks("stick", step=0.5, vel=20)                                          # stick | hat | shaker | wood | tamb … (a clock)
A.drone("contrabass", "1", octave=2, vel=40, every=8)
A.note("cello", bar=3, beat=1.5, pitch="5", beats=2, vel=50, octave=3)      # one note: degree (at `octave`), 'D3', or a MIDI int
A.expr("tremolo", [(3, 0.4), (A.bars, 1.0)])                                # expression 0..1 by bar: smooth ramps, held to the
#                                                                            section edges, multiplied with any swell on that part
#   every part takes bars=(a, b) (1-based, inclusive; b None = to the end) so layers enter and leave
#   a part name can carry a tag — "strings@2" — for a separate track with its own expression (e.g. a second strings layer)

t = S.word("seven seven zero zero")                    # start of a phrase in timeline/words.json (prefix match, at/after `after`)
e = S.wend("right there", after=t)                     # end of a phrase — pass the same `after`
S.shot("s042").start / .end / .line                    # from story/shots.json;  S.chapters() -> [(start, end, first shot id)]
S.riser(end=t, dur=2.2, kind="both")                   # strings crescendo over `dur` + reverse cymbal; both peak exactly at `end`
#                                                        (the cymbal sample is ~2 s whatever `dur` is; its timing is measured)
S.hit(t, "boom", vel=96)                               # boom | impact | low | sting | bell | pluck | cluster (in the key at t)
S.drop(t0, t1, fade=0.4)                               # fades out over `fade` from t0, silent to t1, back after t1; hits ring through
S.level([(0, -2), (14, 0), (60, 1), (90, 0)])         # master level automation (dB)
S.note_at("bells", 61.2, "D6", dur=4, vel=70)          # a free note at an absolute time (MIDI int, 'D6', or a degree)
S.preset("investigation", t0, t1, intensity=0.4, key=None, motif=theme)   # a complete arrangement; a starting point only
```
- **Instruments:** run `python audio/compose.py --list`.
- **Keys and mallets:** `piano`, `felt_piano` (piano through a low-pass: soft and intimate), `bright_piano`, `epiano`, `celesta`, `glockenspiel`, `music_box`, `vibes`, `marimba`, `bells`, `harp`, `kalimba`.
- **Strings and voices:** `violin`, `viola`, `cello`, `contrabass`, `tremolo`, `pizz`, `strings`, `strings_slow`, `synth_strings`, `choir`, `oohs`.
- **Winds and brass:** `flute`, `oboe`, `english_horn`, `clarinet`, `bassoon`, `horns`, `brass`, `trombone`, `tuba`.
- **Pads:** `pad_warm`, `pad_halo`, `pad_sweep`, `pad_glass`, `pad_space`, `pad_metal`, `pad_poly`, `pad_fantasia`, `atmosphere`, `soundtrack`, `ice_rain`, `crystal`, `brightness`, `echo_drops`.
- **Bass:** `synth_bass`, `synth_bass2`, `finger_bass`, `fretless`, `acoustic_bass`.
- **Percussion and FX:** `timpani`, `taiko`, `melodic_tom`, `reverse_cymbal`, `orchestra_hit`, `wood_block`.
- **Drum kits:** `kit`, `kit_room`, `kit_electronic`, `kit_808`, `kit_brush`, `kit_orch`. Drum sounds: `kick`, `snare`, `stick`, `clap`, `hat`, `open_hat`, `pedal_hat`, `ride`, `crash`, `tom`, `tom_lo`, `tom_hi`, `shaker`, `tamb`, `wood`, `claves`, `triangle` …
- **MIDI ranges:** notes must be 0–127, and the report and errors name the culprit. Useful ranges: bass octave 1–2, pads 3–4, melody 4–5, sparkle 5–6.

Audition a preset: `python audio/compose.py --audition tension --dur 30 --intensity 0.6 --out build/tension.wav`.

## The house sound (restrained investigative documentary)
- **Palette:**
  - felt or soft piano;
  - slow strings (`strings_slow`, `cello`, `contrabass`);
  - warm or halo pads;
  - a low pulse (`synth_bass` eighths) for the event itself;
  - quiet clock-like ticks (`stick`/`hat`/`shaker`) for investigative passages;
  - celesta or vibes for unknowns;
  - timpani or taiko only for hits.
- **Keys and tempo:** minor or modal (D minor, C# minor, F minor, B minor, E phrygian for menace). 60–96 bpm. Major (relative major) only for genuine relief or context.
- **Arc of a long film:**

  | Part | Music |
  |---|---|
  | Cold open | sparse: pad + motif |
  | Setting | investigation bed with ticks |
  | The event | tension: pulse, tremolo, build, hit |
  | Aftermath | somber: strings, slow, no rhythm |
  | Investigation and unknowns | mystery: arps, suspended chords |
  | Status | low, unresolved |
  | Ending | the motif complete, then silence |

  Change sections every 60–180 s, at chapter turns.
- **Intensity:** most of the film sits at 0.25–0.45. Peaks above 0.6 only at the event. Silence is a tool: 2–6 s of nothing under the heaviest line hits harder than any stinger.
- **Shorts (9:16):** one section, or two with a single hit. Start at intensity 0.4–0.5 so the hook lands. End on the motif.

## Writing under a narrator
- **Register:** the voice lives roughly between 100 and 4,000 Hz. While someone speaks, keep parts either:
  - sustained (pads and strings, long notes, `swell` ≤ 0.5);
  - low (bass, drones);
  - quiet and high (celesta or arps in octave 5–6 at vel ≤ 30). The report flags 6 or more loud notes above C5 in 4 s under speech.
- **Melody goes in the gaps:** put motif statements at section starts, in pauses over 0.8 s (find them in `words.json`), and under on-screen text with no narration.
- **No drums competing with consonants:** ticks vel ≤ 24. Kicks only in the event section, and sparse.
- **Ducking:** the mix lowers the music 9 dB while the voice talks. Compose as if the music will be heard mostly in those ducked moments.

## Sync technique
- **Riser + hit:** `S.riser(end=t, dur=1.5–2.5)` followed by `S.hit(t, 'boom')` on the reveal word (the number, the moment of failure, "seven seven zero zero").
- **Drop:** `S.drop(t - 0.2, end_of_line + 0.8)` under the gravest line, then let the next section enter. A hit placed at the drop's start rings out into the silence (`S.hit(t, 'low'); S.drop(t, t + 3)`).
- **Downbeats on cuts:** start a new section exactly at a chapter's first shot (`S.shot(id).start`). Whole bars fit automatically.
- **Arrival:** end the film on the tonic with the motif's last note on the last line. Let `S.duration` and the final fade (3 s) take care of the tail.
- **Check numerically:** the report's SYNC POINTS table already measures every hit, riser and drop. For anything else, measure the RMS around `S.word(...)` in `build/music.wav`:
  ```python
  import subprocess, numpy as np
  x = np.frombuffer(subprocess.run(["ffmpeg","-v","error","-i","projects/X/build/music.wav","-ac","1","-ar","8000","-f","f32le","-"], capture_output=True).stdout, np.float32)
  rms = lambda a, b: 20*np.log10(np.sqrt((x[int(a*8000):int(b*8000)]**2).mean())+1e-9)
  ```

## A complete example
`examples/demo/audio/score.py` is the 98-second demo's score:
- five sections (open, reports, flight, questions, ending);
- a film motif;
- layers entering by bar;
- a riser and hit on "seven seven zero zero";
- a drop under "The door is right there.";
- a bell on "not a finding".

Read it before writing the first score.
