# examples/demo/audio/score.py — an example of a film's own score, composed for the 98-second engine demo.
# Render: python audio/compose.py --project examples/demo    (mix.py re-renders it when it is out of date)
# Names available here: S (Score), Motif, INSTR, DRUM, MOODS. Times in seconds; bars 1-based, beats 0-based.

S.set_key("D minor")
# The film's motif: a falling three-note figure (the drop) answered by a small rise (the question).
theme = Motif("5 4 3 . 1 2 3", "1 .5 1.5 1 1 1 2")

# 1. Cold open — the park, the lift hill. Sparse high piano over a warm pad; the bass arrives with the numbers.
t2 = S.shot("s03").start
A = S.section("open", 0, t2, bpm=84, chords="i:2 bVI:2 bIII:2 bVII:2")
A.pad("pad_warm", octave=3, vel=40, voicing="open", swell=0.3)
A.bass("contrabass", octave=2, vel=46, rhythm="whole", bars=(3, None))
A.motif(theme, "felt_piano", at=[1], octave=5, vel=50)

# 2. The reports — map, article, witness quote. Strings enter, a quiet celesta pattern, a soft side-stick clock.
t3 = S.shot("s06").start
B = S.section("reports", t2, t3, bpm=84, chords="i:2 bVI:2 iv:2 V:2")
B.pad("pad_warm", 3, 38, "open")
B.strings("strings_slow", 3, 36, swell=0.4)
B.bass("contrabass", 2, 44, "whole")
B.arp("celesta", "1 5 8 10 8 5", step=0.5, octave=5, vel=28, bars=(3, None))
B.ticks("stick", step=0.5, vel=20)
B.motif(theme, "felt_piano", at=[5], octave=5, vel=46)

# 3. The flight — the cockpit, the cabin, the climb and the fall. Tempo up, a pulse underneath, tremolo strings.
t4 = S.shot("s11").start
C = S.section("flight", t3, t4, bpm=96, chords="i:2 i:2 bVI:2 V:2")
C.pad("pad_sweep", 3, 34, "open")
C.pulse("synth_bass", octave=2, vel=52, step=0.5)
C.strings("tremolo", 3, 36, swell=0.5, bars=(3, None))
C.ticks("hat", step=0.25, vel=16, bars=(5, None))
C.motif(theme, "piano", every=4, octave=4, vel=42)
C.expr("tremolo", [(3, 0.4), (C.bars, 1.0)])               # the strings grow towards the emergency

# The transponder moment: a build that peaks on the words, then a low hit.
t = S.word("seven seven zero zero")
S.riser(end=t, dur=2.2, kind="both")
S.hit(t, "boom", vel=96)

# 4. The questions — investigators, three possibilities. Suspended, no pulse.
t5 = S.shot("s14").start
D = S.section("questions", t4, t5, bpm=72, chords="i:2 bVI:2 bVII:2 i:2")
D.pad("pad_halo", 3, 34, "open", swell=0.4)
D.drone("contrabass", "1", octave=2, vel=40)
D.arp("celesta", "1 5 8 . 10 8", step=0.5, octave=5, vel=22)

# Silence under "The door is right there." — let the line land, then the ending comes in.
d = S.word("the door is right there")
S.drop(d - 0.25, S.wend("right there", after=d) + 1.0, fade=0.35)

# 5. Ending — the mechanism, the photos, "a possibility, not a finding". Slow, resolving on the tonic.
E = S.section("ending", t5, S.duration, bpm=66, chords="iv:2 bVI:2 i:4")
E.strings("strings_slow", 3, 38, swell=0.5)
E.pad("pad_halo", 4, 26, "close")
E.bass("contrabass", 2, 40, "whole")
E.motif(theme, "felt_piano", at=[1, 3], octave=5, vel=44)          # bars 1–4, then the last bar resolves on Dm
S.hit(S.word("not a finding"), "bell", vel=80)

S.level([(0, -2), (14, 0), (60, 1), (90, 0)])
