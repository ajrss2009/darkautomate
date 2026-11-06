#!/usr/bin/env python3
"""audio/compose.py — original film score composed by Claude, rendered with sampled instruments.

Claude composes each film's music as a short Python file, projects/<slug>/audio/score.py, using this library:
sections aligned to the chapters, keys and chord progressions, a motif for the film, instrument parts (pads,
strings, piano, bass, arpeggios, percussion), risers / hits / silences synced to words, and level automation.

  python audio/compose.py --project P --init            write a starter audio/score.py from the story (Claude then composes it)
  python audio/compose.py --project P                   render -> build/music.wav, build/score.mid, build/music.json,
                                                        build/music_report.txt (chords, clashes, cuts, busy-under-voice, sync table)
  python audio/compose.py --project P --report          also print the full report
  python audio/compose.py --project P --stems           keep per-instrument stems in build/music_stems/
  python audio/compose.py --project P --from 60 --to 120   also write build/music_preview.wav for that range
  python audio/compose.py --list                        instruments, kits, drum sounds, moods, hits
  python audio/compose.py --audition investigation --dur 30 --out build/test.wav   one mood preset on its own

Rendering: each part is a MIDI track (build/score.mid opens in any DAW), rendered with a General MIDI SoundFont
(GeneralUser GS; tools/music_setup.py installs it) by FluidSynth — the reference renderer — or TinySoundFont when
FluidSynth is missing or fails. Then per-instrument EQ/gain/pan, a shared hall reverb, bus compression, drops and
level automation, a limiter, and loudness normalisation to config.music.lufs (-20 LUFS). Temporary audio is streamed
through disk-backed buses, so a 20-minute film needs about 2 GB of free disk while rendering and little RAM.

Names ready in score.py: S (the Score), Motif, INSTR, DRUM, MOODS. Times are seconds; in a section bars are 1-based
and beats 0-based. A part name may carry a tag, e.g. "strings@2", to get a separate track with its own automation.
See the compose-music skill (references/composing-guide.md).
"""
from __future__ import annotations

import argparse
import glob
import itertools
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile

SR = 48000
KIT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STARTER_MARK = "# STARTER SCORE"

# ----------------------------------------------------------------------------- instruments (General MIDI programs)
# program, pan (-1..1), gain dB, reverb send (0..1), high-pass Hz, low-pass Hz (None = open), bank, drum kit?
def _i(prog, pan=0.0, gain=0.0, send=0.3, hp=40, lp=None, bank=0, drum=False, kind="melodic"):
    return dict(prog=prog, pan=pan, gain=gain, send=send, hp=hp, lp=lp, bank=bank, drum=drum, kind=kind)

INSTR = {
    # keys & mallets
    "piano": _i(0, -0.08, 0, 0.32, 45), "felt_piano": _i(0, -0.08, 1.5, 0.42, 45, 2600), "bright_piano": _i(1, -0.08, -1, 0.3, 50),
    "epiano": _i(4, 0.1, -1, 0.35, 50), "celesta": _i(8, 0.25, -3, 0.45, 200), "glockenspiel": _i(9, 0.3, -8, 0.45, 300),
    "music_box": _i(10, 0.2, -4, 0.45, 250), "vibes": _i(11, 0.2, -3, 0.4, 120), "marimba": _i(12, -0.2, -2, 0.3, 80),
    "bells": _i(14, 0.0, -6, 0.5, 120), "harp": _i(46, -0.25, -1, 0.4, 60), "kalimba": _i(108, 0.2, -3, 0.35, 150),
    # strings & choir
    "violin": _i(40, -0.3, -2, 0.35, 150), "viola": _i(41, 0.1, -2, 0.35, 100), "cello": _i(42, 0.15, 0, 0.35, 45),
    "contrabass": _i(43, 0.05, 0, 0.25, 28, kind="bass"), "tremolo": _i(44, 0.0, -3, 0.4, 70, kind="sustain"), "pizz": _i(45, -0.15, -2, 0.35, 70),
    "strings": _i(48, 0.0, -2, 0.4, 50, kind="sustain"), "strings_slow": _i(49, 0.0, -1, 0.42, 45, kind="sustain"),
    "synth_strings": _i(50, 0.0, -3, 0.42, 60, kind="sustain"), "choir": _i(52, 0.0, -4, 0.5, 100, kind="sustain"), "oohs": _i(53, 0.0, -4, 0.5, 100, kind="sustain"),
    # winds & brass
    "flute": _i(73, -0.2, -3, 0.4, 200), "oboe": _i(68, 0.15, -3, 0.35, 150), "english_horn": _i(69, 0.15, -3, 0.35, 120),
    "clarinet": _i(71, -0.1, -3, 0.35, 100), "bassoon": _i(70, 0.1, -3, 0.3, 50), "horns": _i(60, -0.15, -3, 0.42, 60, kind="sustain"),
    "brass": _i(61, 0.0, -5, 0.35, 70, kind="sustain"), "trombone": _i(57, 0.2, -4, 0.35, 50), "tuba": _i(58, 0.0, -3, 0.3, 30, kind="bass"),
    # pads & atmospheres
    **{k: _i(p, 0.0, g, s, hp, kind="sustain") for k, p, g, s, hp in [
        ("pad_fantasia", 88, -6, 0.5, 80), ("pad_warm", 89, -3, 0.45, 60), ("pad_poly", 90, -6, 0.4, 80), ("pad_space", 91, -6, 0.55, 100),
        ("pad_glass", 92, -5, 0.55, 100), ("pad_metal", 93, -8, 0.5, 120), ("pad_halo", 94, -4, 0.55, 80), ("pad_sweep", 95, -6, 0.5, 80),
        ("ice_rain", 96, -9, 0.55, 200), ("soundtrack", 97, -8, 0.5, 80), ("crystal", 98, -9, 0.5, 300), ("atmosphere", 99, -7, 0.55, 100),
        ("brightness", 100, -9, 0.5, 200), ("echo_drops", 102, -9, 0.55, 200)]},
    # bass
    "synth_bass": _i(38, 0.0, -2, 0.12, 30, 2200, kind="bass"), "synth_bass2": _i(39, 0.0, -3, 0.12, 30, 2200, kind="bass"),
    "finger_bass": _i(33, 0.0, -1, 0.12, 30, kind="bass"), "fretless": _i(35, 0.0, -1, 0.15, 30, kind="bass"), "acoustic_bass": _i(32, 0.0, 0, 0.15, 30, kind="bass"),
    # orchestral percussion & fx (melodic channels)
    "timpani": _i(47, 0.0, 0, 0.45, 30, kind="perc"), "taiko": _i(116, 0.0, 0, 0.45, 30, kind="perc"), "melodic_tom": _i(117, 0.0, -3, 0.4, 40, kind="perc"),
    "reverse_cymbal": _i(119, 0.0, -1, 0.5, 200, kind="perc"), "orchestra_hit": _i(55, 0.0, -8, 0.5, 60, kind="perc"), "wood_block": _i(115, 0.2, -8, 0.3, 300, kind="perc"),
    # drum kits (MIDI channel 10)
    "kit": _i(0, 0.0, -3, 0.2, 35, bank=128, drum=True, kind="drums"), "kit_room": _i(8, 0.0, -3, 0.25, 35, bank=128, drum=True, kind="drums"),
    "kit_electronic": _i(24, 0.0, -4, 0.2, 35, bank=128, drum=True, kind="drums"), "kit_808": _i(25, 0.0, -4, 0.2, 30, bank=128, drum=True, kind="drums"),
    "kit_brush": _i(40, 0.0, -3, 0.25, 40, bank=128, drum=True, kind="drums"), "kit_orch": _i(48, 0.0, -2, 0.45, 30, bank=128, drum=True, kind="drums"),
}
DRUM = {"kick": 36, "kick2": 35, "stick": 37, "snare": 38, "clap": 39, "snare2": 40, "tom_lo": 41, "hat": 42, "tom": 45,
        "pedal_hat": 44, "open_hat": 46, "tom_mid": 47, "tom_hi": 50, "crash": 49, "ride": 51, "ride_bell": 53, "tamb": 54,
        "splash": 55, "cabasa": 69, "shaker": 70, "claves": 75, "wood": 76, "wood_lo": 77, "triangle": 81, "mute_triangle": 80}
HITS = ("boom", "impact", "low", "sting", "bell", "pluck", "cluster")

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MODES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10], "harmonic": [0, 2, 3, 5, 7, 8, 11],
         "dorian": [0, 2, 3, 5, 7, 9, 10], "phrygian": [0, 1, 3, 5, 7, 8, 10], "lydian": [0, 2, 4, 6, 7, 9, 11],
         "mixolydian": [0, 2, 4, 5, 7, 9, 10]}
MINORISH = {"minor", "harmonic", "dorian", "phrygian"}
MAJOR = MODES["major"]
ROMAN = {"i": 0, "ii": 1, "iii": 2, "iv": 3, "v": 4, "vi": 5, "vii": 6}
PC_SHARP = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
PC_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

MOODS = {   # starting points for S.preset(); a film normally keeps ONE home key and Claude picks its progressions
    "investigation": dict(key="D minor", bpm=84, chords="i:2 bVI:2 bIII:2 bVII:2"),
    "tension":       dict(key="C# minor", bpm=96, chords="i:2 i:2 bVI:2 V:2"),
    "somber":        dict(key="F minor", bpm=62, chords="i:2 iv:2 bVI:2 v:2"),
    "mystery":       dict(key="D minor", bpm=72, chords="i:2 bVI:2 bVII:2 i:2"),
    "dark":          dict(key="B minor", bpm=60, chords="i:4 bII:2 i:2"),
    "calm":          dict(key="Eb major", bpm=70, chords="I:2 IV:2 vi:2 V:2"),
    "hopeful":       dict(key="G major", bpm=88, chords="IV:2 I:2 V:2 vi:2"),
    "action":        dict(key="E minor", bpm=120, chords="i bVII bVI bVII"),
}


def base(track): return track.split("@")[0]
def info(track):
    b = base(track)
    if b not in INSTR: raise KeyError(f"unknown instrument '{b}' (python audio/compose.py --list)")
    return INSTR[b]


# ----------------------------------------------------------------------------- theory
def parse_key(k):
    m = re.match(r"^\s*([A-Ga-g])([#b]?)\s*(\w+)?\s*$", k or "D minor")
    if not m: raise ValueError(f"bad key '{k}' (use e.g. 'D minor', 'Eb major', 'F# dorian')")
    pc = (NOTE[m.group(1).upper()] + {"#": 1, "b": -1, "": 0}[m.group(2)]) % 12
    mode = (m.group(3) or "major").lower(); mode = {"min": "minor", "maj": "major", "m": "minor"}.get(mode, mode)
    if mode not in MODES: raise ValueError(f"unknown mode '{mode}' (one of {', '.join(MODES)})")
    return pc, mode


NOTE_RX = re.compile(r"^([A-G])([#b]?)(-?\d)$")          # note names are UPPERCASE: 'D3', 'F#4', 'Bb2'
DEG_RX = re.compile(r"^([#b]?)(-?\d+)([+-]*)$")           # degrees: '5', 'b3', '#4', '5-', '3+'


def note_midi(name):
    """'D3' / 'F#4' / 'Bb2' (uppercase letter) or an int MIDI number (C4 = 60)."""
    if isinstance(name, (int, float)): return int(name)
    m = NOTE_RX.match(str(name).strip())
    if not m: raise ValueError(f"bad note name '{name}' (use an uppercase letter: 'D3', 'Bb2', 'F#4')")
    return 12 * (int(m.group(3)) + 1) + NOTE[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]


def degree_midi(tok, key, octave):
    """scale degree of the key's MODE -> MIDI. '1'..'7', '8' = octave up, accidentals raise/lower the mode's degree
    ('b2' in D minor = Eb, '#4' = G#), '5-' an octave down, '3+' up. Uppercase note names ('A4') pass through."""
    tok = str(tok).strip()
    if NOTE_RX.match(tok): return note_midi(tok)
    m = DEG_RX.match(tok)
    if not m: raise ValueError(f"bad degree '{tok}' (degrees like 5, b3, 5-, 3+, or note names like A4)")
    pc, mode = key; sc = MODES[mode]; d = int(m.group(2)) - 1
    o, i = divmod(d, 7)
    v = 12 * (octave + 1) + pc + sc[i] + 12 * o + {"#": 1, "b": -1, "": 0}[m.group(1)]
    return v + 12 * m.group(3).count("+") - 12 * m.group(3).count("-")


def pitch_of(p, key, octave=4):
    """int -> MIDI; uppercase note name -> MIDI; otherwise a degree of the key at `octave`."""
    if isinstance(p, (int, float)): return int(p)
    return note_midi(p) if NOTE_RX.match(str(p).strip()) else degree_midi(p, key, octave)


def note_name(m): return f"{PC_SHARP[m % 12]}{m // 12 - 1}"


class Chord:
    """Roman numeral relative to the tonic's MAJOR scale (film/pop convention): in D minor i = Dm, bIII = F, iv = Gm,
    v = Am, V = A, bVI = Bb, bVII = C, bII = Eb. Case gives the triad (I major, i minor); ° dim, ø half-dim 7, + aug;
    7 (dominant on upper case, minor 7 on lower, fully diminished with °), maj7, m7 (minor 7 chord), 9, add9, 6, sus2, sus4;
    /N puts degree N of the key's mode in the bass (i/5 in D minor = Dm over A)."""
    RX = re.compile(r"^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|o|dim|ø|\+|aug)?(maj7|m7|7|9|add9|6|sus2|sus4)?(?:/([b#]?\d))?$")

    def __init__(self, sym, key):
        m = self.RX.match(sym.strip())
        if not m: raise ValueError(f"bad chord '{sym}' (roman numerals like i, bVI, V7, iv, bVII, ii°, viiø7, Isus4, i/5)")
        acc, num, q, ext, bass = m.groups()
        self.sym, self.key = sym, key
        self.root = (key[0] + MAJOR[ROMAN[num.lower()]] + {"b": -1, "#": 1, "": 0}[acc]) % 12
        minor = num.islower()
        t = [0, 3, 7] if minor else [0, 4, 7]
        if q in ("°", "o", "dim"): t = [0, 3, 6]
        if q == "ø": t = [0, 3, 6, 10]
        if q in ("+", "aug"): t = [0, 4, 8]
        if ext == "sus2": t = [0, 2, 7]
        if ext == "sus4": t = [0, 5, 7]
        if ext == "7" and q != "ø": t = t + [9 if q in ("°", "o", "dim") else 10]
        if ext == "m7": t = [0, 3, 7, 10]
        if ext == "maj7": t = t + [11]
        if ext == "9": t = t + [10, 14]
        if ext == "add9": t = t + [14]
        if ext == "6": t = t + [9]
        self.tones = t
        self.pcs = {(self.root + x) % 12 for x in t}
        self.bass_pc = None
        if bass:
            n = int(bass.lstrip("b#")) - 1; sc = MODES[key[1]]
            self.bass_pc = (key[0] + sc[n % 7] + (-1 if bass.startswith("b") else 1 if bass.startswith("#") else 0)) % 12

    def name(self):
        r = (PC_SHARP if self.key[1] in MINORISH else PC_FLAT)[self.root]
        q = {(0, 3, 7): "m", (0, 4, 7): "", (0, 3, 6): "°", (0, 4, 8): "+", (0, 2, 7): "sus2", (0, 5, 7): "sus4"}.get(tuple(self.tones[:3]), "")
        ext = {10: "7", 11: "maj7", 9: "6" if len(self.tones) == 4 and self.tones[:3] in ([0, 4, 7], [0, 3, 7]) else "°7"}.get(self.tones[3], "") if len(self.tones) > 3 else ""
        if self.tones == [0, 3, 6, 10]: q, ext = "ø", "7"
        if self.tones == [0, 3, 6, 9]: q, ext = "°", "7"
        s = r + q + ext
        if self.bass_pc is not None: s += "/" + (PC_SHARP if self.key[1] in MINORISH else PC_FLAT)[self.bass_pc]
        return s

    def tone(self, idx, octave):
        """chord tone by index: 1 root, 3 third, 5 fifth, 7 seventh (octave if none), 8 root+12, 9 ninth, 10 third+12, 12 fifth+12, 14 7th+12, 15 root+24."""
        b = 12 * (octave + 1) + self.root; t = self.tones
        table = {1: 0, 3: t[1], 5: t[2], 7: (t[3] if len(t) > 3 else 12), 8: 12, 9: (t[4] if len(t) > 4 else 14), 10: t[1] + 12,
                 12: t[2] + 12, 14: 12 + (t[3] if len(t) > 3 else 12), 15: 24}
        if idx not in table: raise ValueError(f"chord-tone index {idx} (use 1 3 5 7 8 9 10 12 14 15)")
        return b + table[idx]

    def bass(self, octave):
        """the bass note (the slash bass when there is one) in `octave`: the root, or the slash note nearest to it."""
        r = 12 * (octave + 1) + self.root
        if self.bass_pc is None: return r
        b = 12 * (octave + 1) + self.bass_pc
        if b > r + 6: b -= 12
        if b < r - 6: b += 12
        return b

    def voicing(self, octave, kind="open"):
        r = 12 * (octave + 1) + self.root; t = self.tones
        if kind == "close": v = [r + x for x in t[:4]]
        elif kind == "spread": v = [r - 12, r + t[2], r + 12 + t[1], r + 12 + (t[3] if len(t) > 3 else t[2])]
        elif kind == "shell": v = [r, r + (t[3] if len(t) > 3 else 12), r + 12 + t[1]]
        else: v = [r, r + t[2], r + 12 + t[1]] + ([r + 12 + t[3]] if len(t) > 3 else [])      # open
        v = sorted(set(v))
        if self.bass_pc is not None:                     # slash chord: the named bass goes under the whole voicing
            b = self.bass(octave)
            while b >= v[0]: b -= 12
            v = [b] + v
        return v


def voice_lead(prev, chord, target, center=None):
    """smooth pads: the bass stays within a fixed register (the octave around `center`, so the pad never sinks or climbs),
    and the upper voices move to the nearest notes of the new chord while staying near the intended spacing."""
    if not prev or len(target) < 3: return target
    b0 = target[0]; center = center if center is not None else b0
    bass = min((b0 - 12, b0, b0 + 12), key=lambda b: abs(b - center))
    ups = target[1:]; pcs = [x % 12 for x in ups]; pu = sorted(prev[1:])[:len(ups)]
    if len(pu) < len(ups): pu = pu + ups[len(pu):]
    reg = sum(ups) / len(ups) - (b0 - bass)                   # intended register follows the bass octave
    best, bc = None, None
    for perm in set(itertools.permutations(pcs)):
        opts = []
        for p, pc in zip(pu, perm):
            c = p + ((pc - p) % 12); opts.append((c, c - 12))
        for out in itertools.product(*opts):
            out = list(out)
            if len(set(out)) < len(out) or min(out) <= bass + 4 or max(out) - bass > 31: continue
            cost = sum(abs(a - b) for a, b in zip(sorted(out), pu)) + 1.0 * abs(sum(out) / len(out) - reg)
            if bc is None or cost < bc: best, bc = sorted(out), cost
    return [bass] + (best or [u - (b0 - bass) for u in ups])


class Motif:
    """A melodic idea: degrees of the key's mode (or uppercase note names), '.' = rest, durations in beats.
    Motif('5 4 3 . 1 2 3', '1 .5 1.5 1 1 1 2')"""

    def __init__(self, notes, rhythm=None, vel=None):
        self.notes = notes.split() if isinstance(notes, str) else list(notes)
        r = rhythm.split() if isinstance(rhythm, str) else (rhythm or [1] * len(self.notes))
        self.rhythm = [float(x) for x in r]
        if len(self.rhythm) != len(self.notes): raise ValueError(f"motif has {len(self.notes)} notes but {len(self.rhythm)} durations")
        for n in self.notes:
            if n != "." and not (NOTE_RX.match(n) or DEG_RX.match(n)): raise ValueError(f"bad motif note '{n}'")
        self.vel = [int(v) for v in vel.split()] if isinstance(vel, str) else vel
        self.beats = sum(self.rhythm)

    def transposed(self, steps):
        def tr(n):
            if n == "." or NOTE_RX.match(n): return n
            m = DEG_RX.match(n); return f"{m.group(1)}{int(m.group(2)) + steps}{m.group(3)}"
        return Motif([tr(n) for n in self.notes], self.rhythm, self.vel)


# ----------------------------------------------------------------------------- section
class Section:
    def __init__(self, score, name, t0, t1, bpm=84, key=None, meter=4, chords="i", fit="auto"):
        self.S, self.name, self.t0, self.t1, self.meter, self.target_bpm = score, name, float(t0), float(t1), meter, float(bpm)
        self.key = parse_key(key) if isinstance(key, str) else (key or score.key)
        dur = self.t1 - self.t0
        if dur <= 0.3: raise ValueError(f"section '{name}' is too short ({dur:.2f}s)")
        bar_t = meter * 60.0 / bpm; nx = dur / bar_t
        fitted = fit is True or (fit == "auto" and nx >= 0.75 and abs(max(1, round(nx)) / nx - 1) <= 0.10)
        if fitted:
            self.bars = max(1, round(nx)); self.beat = dur / (self.bars * meter)       # whole bars that land exactly on t1
        else:
            self.bars = max(1, math.ceil(nx)); self.beat = 60.0 / bpm                  # keep the tempo; notes stop at t1
        self.fitted, self.bpm = fitted, 60.0 / self.beat
        prog = []
        for tok in chords.split():
            if tok == "-": prog.append((prog[-1][0] if prog else "i", meter)); continue
            sym, _, n = tok.partition(":"); prog.append((sym, float(n or 1) * meter))
        self.timeline, b, i, total = [], 0.0, 0, self.bars * meter
        while b < total - 1e-6:
            sym, L = prog[i % len(prog)]; L = min(L, total - b)
            self.timeline.append((b, L, Chord(sym, self.key))); b += L; i += 1
        self._prev_voicing = {}
        score.sections.append(self)

    # --- time helpers
    def t(self, bar, beat=0.0): return self.t0 + ((bar - 1) * self.meter + beat) * self.beat
    def chord_at(self, beat_abs):
        for b, L, c in self.timeline:
            if b <= beat_abs < b + L: return c
        return self.timeline[-1][2]
    def _bars(self, bars):
        """None = the whole section, N = just bar N, (a, b) = bars a..b inclusive (b None = to the end)."""
        if bars is None: a, b = 1, self.bars
        elif isinstance(bars, int): a, b = bars, bars
        else: a, b = bars[0], (bars[1] if bars[1] is not None else self.bars)
        return max(1, int(a)), min(self.bars, int(b))
    def _spans(self, bars):
        a, b = self._bars(bars); lo, hi = (a - 1) * self.meter, b * self.meter; out = []
        for st, L, c in self.timeline:
            s0, s1 = max(st, lo), min(st + L, hi)
            if s1 <= s0: continue
            if out and out[-1][2].sym == c.sym and abs(out[-1][0] + out[-1][1] - s0) < 1e-6: out[-1] = (out[-1][0], out[-1][1] + s1 - s0, c)
            else: out.append((s0, s1 - s0, c))
        return out
    def _add(self, track, beat_abs, beats, midi, vel, human=True, tail=0.15, part=""):
        t = self.t0 + beat_abs * self.beat; end = t + beats * self.beat; lim = self.t1 + tail
        if t >= self.t1 - 0.02:
            self.S.cuts.append((t, track, part, note_name(midi), "dropped (starts after the section ends)")); return
        if end > lim:
            if end - lim > 0.25 and part in ("motif", "note"): self.S.cuts.append((t, track, part, note_name(midi), f"shortened by {end - lim:.2f}s at the section end"))
            end = lim
        self.S._note(track, t, end - t, midi, vel, human)

    # --- parts
    def pad(self, instr="pad_warm", octave=3, vel=45, voicing="open", bars=None, legato=0.6, swell=0.0, retrigger=None, voice_lead_=True):
        """sustained chords, voice-led (upper voices move to the nearest chord tones). swell 0..1 = crescendo/diminuendo per chord."""
        for s, L, c in self._spans(bars):
            v = c.voicing(octave, voicing)
            if voice_lead_: v = voice_lead(self._prev_voicing.get(instr) or self.S._last_voicing.get(instr), c, v,
                                           12 * (octave + (0 if voicing == "spread" else 1)) + 5)
            self._prev_voicing[instr] = v; self.S._last_voicing[instr] = v
            pieces = [(s, L)] if not retrigger else [(x, min(retrigger * self.meter, s + L - x)) for x in _frange(s, s + L, retrigger * self.meter)]
            for ps, pl in pieces:
                for n in v: self._add(instr, ps, pl + legato / self.beat, n, vel, human=False, tail=0.6, part="pad")
            if swell: self.S._swell(instr, self.t0 + s * self.beat, L * self.beat, swell)
        return self

    def strings(self, instr="strings_slow", octave=3, vel=42, voicing="spread", bars=None, swell=0.45):
        return self.pad(instr, octave, vel, voicing, bars, 0.8, swell)

    def bass(self, instr="contrabass", octave=2, vel=55, rhythm="whole", bars=None, notes="1", gate=0.92):
        """the chord's bass (slash-aware) or chord tones ('1 5') per step; the pattern restarts on every chord.
        rhythm: whole | half | quarter | pulse8 | pulse16 | dotted | list/str of beats like '1.5 1.5 1'."""
        named = {"whole": [self.meter], "half": [2.0], "quarter": [1.0], "pulse8": [0.5], "pulse16": [0.25], "dotted": [1.5, 1.5, 1.0]}
        steps = [float(x) for x in rhythm] if isinstance(rhythm, (list, tuple)) else (named.get(rhythm) or [float(x) for x in str(rhythm).split()])
        seq = str(notes).split()
        for s, L, c in self._spans(bars):
            b, j = s, 0
            while b < s + L - 1e-6:
                d = min(steps[j % len(steps)], s + L - b); tok = seq[j % len(seq)]
                if tok != ".":
                    n = c.bass(octave) if tok == "1" else c.tone(int(tok), octave)
                    self._add(instr, b, d * gate, n, _accent(vel, j, len(steps)), part="bass")
                b += d; j += 1
        return self

    def pulse(self, instr="synth_bass", octave=2, vel=50, step=0.5, bars=None, gate=0.55):
        return self.bass(instr, octave, vel, [step], bars, "1", gate)

    def arp(self, instr="celesta", pattern="1 5 8 10 8 5", step=0.5, octave=5, vel=40, bars=None, gate=0.9):
        """chord-tone arpeggio; tokens are chord-tone indexes (1 3 5 7 8 9 10 12 14 15) or '.' rests."""
        toks = pattern.split(); a, b = self._bars(bars); x0, i = (a - 1) * self.meter, 0
        while x0 + i * step < b * self.meter - 1e-6:
            x = x0 + i * step; t = toks[i % len(toks)]
            if t != ".": self._add(instr, x, step * gate, self.chord_at(x + 1e-6).tone(int(t), octave), _accent(vel, i, len(toks)), part="arp")
            i += 1
        return self

    def motif(self, motif, instr="felt_piano", at=None, every=None, octave=4, vel=50, transpose=0, bars=None, gate=0.95):
        """place a Motif at bars (at=[3, 7] or [(3, 1.5)]) and/or every N bars inside `bars`. Notes past the section end are cut (see the report)."""
        m = motif if isinstance(motif, Motif) else Motif(motif)
        if transpose: m = m.transposed(transpose)
        a, b = self._bars(bars)
        spots = [((p, 0.0) if isinstance(p, (int, float)) else tuple(p)) for p in (at or [])]
        if every:                                              # repeats only where the whole motif fits before the range ends
            spots += [(bar, 0.0) for bar in range(a, b + 1, every) if (bar - 1) * self.meter + m.beats <= b * self.meter + 1e-6]
        for bar, bt in spots:
            if bar > self.bars: self.S.cuts.append((self.t(bar), instr, "motif", "-", f"bar {bar} is beyond this section ({self.bars} bars)")); continue
            x = (bar - 1) * self.meter + bt
            for k, (n, d) in enumerate(zip(m.notes, m.rhythm)):
                if n != ".": self._add(instr, x, d * gate, degree_midi(n, self.key, octave), (m.vel[k] if m.vel else vel) + (4 if k == 0 else 0), part="motif")
                x += d
        return self

    def ostinato(self, motif, instr="pizz", octave=3, vel=45, bars=None, every=1):
        return self.motif(motif, instr, every=every, octave=octave, vel=vel, bars=bars)

    def drums(self, pattern, kit="kit", step=0.25, vel=70, bars=None, swing=0.0):
        """pattern {'kick': 'x...x...', 'hat': '..x.'}: each string cycles over the steps (one bar = meter/step steps,
        so a longer string spans several bars). x normal, X accent, o soft, . rest."""
        a, b = self._bars(bars); per = int(round(self.meter / step))
        for name, pat in pattern.items():
            note = DRUM[name] if isinstance(name, str) else int(name); p = pat.replace(" ", "")
            for bar in range(a, b + 1):
                for k in range(per):
                    g = (bar - 1) * per + k; ch = p[g % len(p)]
                    if ch == ".": continue
                    v = vel + {"X": 25, "x": 0, "o": -25}.get(ch, 0)
                    self._add(kit, (bar - 1) * self.meter + k * step + (swing * step if k % 2 else 0.0), step * 0.9, note, v, part="drums")
        return self

    def ticks(self, sound="stick", step=0.5, vel=26, bars=None, kit="kit"):
        return self.drums({sound: "x"}, kit, step, vel, bars)

    def drone(self, instr="contrabass", note="1", octave=2, vel=45, bars=None, every=8):
        a, b = self._bars(bars)
        for bar in range(a, b + 1, every):
            L = min(every, b - bar + 1) * self.meter
            self._add(instr, (bar - 1) * self.meter, L, degree_midi(note, self.key, octave), vel, human=False, tail=0.8, part="drone")
        return self

    def note(self, instr, bar, beat, pitch, beats=1.0, vel=60, octave=4):
        """one note: an int MIDI number, an uppercase note name ('D3'), or a degree of the key at `octave`."""
        self._add(instr, (bar - 1) * self.meter + beat, beats, pitch_of(pitch, self.key, octave), vel, part="note"); return self

    def expr(self, instr, points):
        """expression automation (0..1) for one part across this section: [(bar, value), ...] — bars may be fractional (3.5).
        Ramps smoothly between points, holds the first/last value to the section edges, and multiplies with any swell."""
        pts = sorted((self.t(b) if not isinstance(b, tuple) else self.t(*b), float(v)) for b, v in points)
        self.S._curve(instr, [(self.t0, pts[0][1])] + pts + [(self.t1, pts[-1][1])]); return self


def _frange(a, b, s):
    x = a
    while x < b - 1e-6: yield x; x += s

def _accent(vel, i, n): return vel + (6 if i % max(1, n) == 0 else 0)


# ----------------------------------------------------------------------------- score
class Score:
    def __init__(self, project=None, duration=None, seed=1):
        self.P = project; self.sections, self.events, self.curves, self.levels, self.drops, self.risers, self.hits = [], {}, {}, [], [], [], []
        self.cuts, self._last_voicing = [], {}
        self.key = parse_key("D minor"); self.words, self.shots, self.story, self.duration = [], [], {}, duration
        self.cfg = {}
        if project:
            for name, attr in (("timeline/words.json", "words"), ("story/shots.json", "story"), ("config.json", "cfg_all")):
                try: setattr(self, attr, json.load(open(os.path.join(project, name), encoding="utf-8")))
                except Exception: setattr(self, attr, {} if attr != "words" else [])
            if isinstance(self.words, dict): self.words = self.words.get("words", [])
            self.shots = self.story.get("shots", []) if isinstance(self.story, dict) else []
            self.cfg = (getattr(self, "cfg_all", {}) or {}).get("music") or {}
            self.duration = self.duration or self.story.get("duration") or (self.shots[-1]["end"] if self.shots else None) or (getattr(self, "cfg_all", {}) or {}).get("duration")
            seed = self.cfg.get("seed", seed)
        self.seed = seed; self._rng = random.Random(seed)
        self.duration = float(self.duration or 60.0)

    # --- lookups for sync
    def _match(self, phrase, after):
        parts = [_norm(x) for x in str(phrase).split() if _norm(x)]; W = self.words
        for i in range(len(W)):
            if W[i]["start"] < after - 0.05: continue
            if all(i + k < len(W) and _norm(W[i + k]["word"]).startswith(p) for k, p in enumerate(parts)): return i, len(parts)
        return None, len(parts)

    def word(self, phrase, after=0.0, fallback=None):
        """start (s) of a spoken word/phrase at or after `after` (prefix match, like the video engine)."""
        i, _ = self._match(phrase, after)
        if i is not None: return float(self.words[i]["start"])
        if fallback is not None: return fallback
        raise KeyError(f"phrase not found in timeline/words.json: '{phrase}' (after {after}s)")

    def wend(self, phrase, after=0.0):
        """end (s) of the phrase's last word — pass the same `after` you used with word()."""
        i, n = self._match(phrase, after)
        if i is None: raise KeyError(f"phrase not found in timeline/words.json: '{phrase}' (after {after}s)")
        return float(self.words[i + n - 1]["end"])

    def shot(self, sid):
        """the shot from story/shots.json: .start, .end, .line (also a dict)."""
        for s in self.shots:
            if s["id"] == sid: return _Obj(s)
        raise KeyError(f"no shot '{sid}' in story/shots.json")

    def chapters(self):
        """[(start, end, first shot id)] split at 'dip' transitions (the chapter starts in the shot plan)."""
        starts = [0.0] + [s["start"] for s in self.shots if (s.get("in") or {}).get("type") in ("dip", "dipWhite") and s["start"] > 0]
        ends = starts[1:] + [self.duration]
        return [(a, b, next((s["id"] for s in self.shots if abs(s["start"] - a) < 1e-3), None)) for a, b in zip(starts, ends)]

    def section_at(self, t):
        for s in self.sections:
            if s.t0 <= t < s.t1: return s
        return None

    def key_at(self, t, key=None):
        if key: return parse_key(key)
        s = self.section_at(t); return s.key if s else self.key

    # --- building
    def set_key(self, k): self.key = parse_key(k)
    def section(self, name, t0, t1, bpm=84, key=None, meter=4, chords="i", fit="auto"):
        return Section(self, name, t0, t1, bpm, key, meter, chords, fit)

    def _note(self, track, t, dur, midi, vel, human=True):
        info(track)
        midi = int(midi)
        if not 0 <= midi <= 127: raise ValueError(f"{track}: note {midi} is outside MIDI 0..127 (check octave/degree)")
        if human: t += self._rng.uniform(-0.007, 0.007); vel += self._rng.randint(-4, 4)
        self.events.setdefault(track, []).append((max(0.0, t), max(0.03, dur), int(min(127, max(1, vel))), midi))

    def note_at(self, instr, t, pitch, dur=1.0, vel=70, octave=4):
        """a free note at an absolute time: int MIDI, 'D6', or a degree of the key at that time."""
        self._note(instr, t, dur, pitch_of(pitch, self.key_at(t), octave), vel, False); return self

    def _curve(self, track, pts): self.curves.setdefault(track, []).append(sorted(pts))

    def _swell(self, track, t, dur, amt):
        lo = 1.0 - 0.6 * amt
        self._curve(track, [(t + x / 16 * dur, lo + (1 - lo) * math.sin(math.pi * min(1.0, (x / 16) * 1.12)) ** 1.5) for x in range(17)])

    def hit(self, t, kind="boom", vel=100, key=None):
        """a sync hit (rings through drops): boom (taiko + timpani + low strings), impact (boom + crash), low (contrabass +
        low piano), sting (short strings chord), bell (tubular bell), pluck (harp), cluster (low piano cluster)."""
        if kind not in HITS: raise ValueError(f"unknown hit '{kind}' ({', '.join(HITS)})")
        k = self.key_at(t, key); root = 12 * 3 + k[0]                      # tonic in octave 2
        tonic = Chord("i" if k[1] in MINORISH else "I", k)
        N = lambda tr, *a: self._note(tr + "@hit", t, *a, human=False)
        if kind in ("boom", "impact"):
            N("taiko", 2.5, root, vel); N("timpani", 3.0, root, vel - 15); N("contrabass", 3.5, root, vel - 25)
            if kind == "impact": N("kit", 2.0, DRUM["crash"], vel - 20)
        elif kind == "low": N("contrabass", 4.0, root, vel - 10); N("piano", 4.0, root, vel - 20)
        elif kind == "sting":
            for n in tonic.voicing(4, "close"): N("strings", 0.45, n, vel - 10)
        elif kind == "bell": N("bells", 4.0, root + 36, vel)
        elif kind == "pluck": N("harp", 3.0, root + 24, vel - 20)
        elif kind == "cluster":
            for n in (root, root + 1, root + 3): N("piano", 4.0, n + 12, vel - 25)
        self.hits.append((t, kind)); return self

    def riser(self, end, dur=2.5, kind="both", vel=90, key=None):
        """a build that peaks exactly at `end` (s). cymbal = reverse cymbal (its sample is ~2 s long whatever `dur` is,
        timed by measuring the SoundFont), strings = tremolo crescendo over `dur`, both = the two together."""
        if kind not in ("cymbal", "strings", "both"): raise ValueError("riser kind: cymbal | strings | both")
        k = self.key_at(max(0.0, end - 0.01), key)
        if kind in ("strings", "both"):
            ch = Chord("i" if k[1] in MINORISH else "I", k)
            for n in ch.voicing(3, "spread"): self._note("tremolo@riser", max(0.0, end - dur), dur + 0.25, n, vel - 20, False)
            self._curve("tremolo@riser", [(end - dur, 0.12), (end - dur * 0.5, 0.45), (end - 0.02, 1.0), (end + 0.25, 0.5)])
        self.risers.append({"end": float(end), "dur": float(dur), "kind": kind, "vel": vel}); return self

    def drop(self, t0, t1, fade=0.4):
        """silence between t0 and t1: fades out over `fade` s starting at t0, silent until t1, fades back in after t1.
        Notes that would start inside are removed; hits ring through."""
        if t1 <= t0: raise ValueError("drop: t1 must be after t0")
        self.drops.append((float(t0), float(t1), float(fade))); return self

    def level(self, points):
        """master level automation in dB: [(t, dB), ...] — e.g. [(0, -4), (40, 0), (300, -2)]."""
        self.levels.extend((float(t), float(d)) for t, d in points); return self

    def preset(self, mood, t0, t1, intensity=0.4, key=None, bpm=None, chords=None, motif=None, name=None):
        """a complete arrangement in one call (layers enter as the section develops). A starting point — edit freely."""
        if mood not in MOODS: raise ValueError(f"unknown mood '{mood}' ({', '.join(MOODS)})")
        c = MOODS[mood]; sec = self.section(name or mood, t0, t1, bpm or c["bpm"], key or c["key"], 4, chords or c["chords"])
        _arrange(sec, mood, max(0.0, min(1.0, intensity)), motif); return sec

    def in_drop(self, t): return any(a + 0.02 <= t < b for a, b, _ in self.drops)


def _norm(w): return re.sub(r"[^\w']", "", str(w).lower())


class _Obj(dict):
    def __getattr__(self, k):
        try: return self[k]
        except KeyError: raise AttributeError(k)


def _arrange(s, mood, I, motif):
    """the preset arrangements (Claude-written defaults for each mood)."""
    v = lambda base_, span: int(base_ + span * I)
    n = s.bars; half = max(1, n // 2); q = max(1, n // 4)
    m = motif if motif is not None else {"investigation": Motif("5 4 3 . 1", "1 .5 1.5 1 4"), "tension": Motif("1 b2 1 . 5-", "1 1 1 1 4"),
                                         "somber": Motif("3 2 1 . 5- 1", "2 1 1 1 1 2"), "mystery": Motif("1 5 4 3 . 2", "1 1 1 2 1 2"),
                                         "dark": Motif("1 b2 1", "2 1 5"), "calm": Motif("3 5 8 7 5", "1 1 1 1 4"),
                                         "hopeful": Motif("5 6 8 7 5 3", "1 1 1 .5 .5 4"), "action": Motif("1 1 3 4 5", ".5 .5 1 1 1")}[mood]
    if mood == "investigation":
        s.pad("pad_warm", 3, v(38, 14), "open", swell=0.3)
        if n >= 4: s.strings("strings_slow", 3, v(30, 18), bars=(min(3, n), n))
        s.bass("contrabass", 2, v(44, 14), "whole")
        s.motif(m, "felt_piano", every=4, octave=5, vel=v(44, 16))           # on i and bIII: the motif's 5-4-3 sits on both
        if I >= 0.3: s.ticks("stick", 0.5, v(14, 12), bars=(min(half, n), n))
        if I >= 0.4: s.arp("celesta", "1 5 8 10 8 5", 0.5, 5, v(18, 12), bars=(min(half + 1, n), n))
        if I >= 0.55: s.pulse("synth_bass", 2, v(36, 22), 0.5, bars=(min(q + 1, n), n))
    elif mood == "tension":
        s.pad("pad_sweep", 3, v(34, 14), "open")
        s.strings("tremolo", 3, v(28, 22), swell=0.5, bars=(min(2, n), n))
        s.pulse("synth_bass", 2, v(40, 22), 0.5)
        s.ticks("hat", 0.25, v(12, 12), bars=(min(q + 1, n), n))
        s.motif(m, "piano", every=4, octave=3, vel=v(40, 16))
        if I >= 0.5: s.drums({"kick": "x..............."}, "kit_orch", 0.25, v(50, 25), bars=(min(half, n), n))
        if I >= 0.6: s.drums({"tom_lo": "....x.......x..."}, "kit_orch", 0.25, v(40, 20), bars=(min(half + 2, n), n))
    elif mood == "somber":
        s.strings("strings_slow", 3, v(34, 16), swell=0.5)
        s.pad("pad_halo", 4, v(26, 12), "close")
        s.bass("contrabass", 2, v(40, 12), "whole")
        s.motif(m, "cello", every=4, octave=3, vel=v(46, 14), bars=(min(2, n), n))
        if n >= 6:                                             # a higher answer on the bVI bars (5, 13, 21 …) of the second half
            st = next((b for b in range(half, n + 1) if (b - 1) % 8 == 4), None)
            if st: s.motif(m.transposed(2), "felt_piano", every=8, octave=5, vel=v(34, 12), bars=(st, n))
    elif mood == "mystery":
        s.pad("pad_halo", 3, v(32, 12), "open", swell=0.4)
        s.pad("atmosphere", 4, v(22, 10), "close", bars=(min(2, n), n))
        s.drone("contrabass", "1", 2, v(38, 12))
        s.arp("celesta", "1 5 8 . 10 8", 0.5, 5, v(18, 12), bars=(min(q + 1, n), n))
        s.motif(m, "vibes", every=4, octave=4, vel=v(36, 14), bars=(min(3, n), n))
        if I >= 0.45: s.ticks("shaker", 0.5, v(10, 12), bars=(min(half, n), n))
    elif mood == "dark":
        s.drone("contrabass", "1", 2, v(42, 14)); s.pad("pad_glass", 3, v(30, 14), "open", swell=0.5)
        s.strings("strings_slow", 2, v(26, 16), bars=(min(2, n), n))
        for bar in range(1, n + 1, 4): s.note("timpani", bar, 0, "1", 4, v(40, 30), octave=2)
        s.motif(m, "piano", every=4, octave=2, vel=v(38, 14), bars=(min(3, n), n))
    elif mood == "calm":
        s.pad("pad_warm", 3, v(30, 12), "open"); s.strings("strings_slow", 3, v(28, 14), bars=(min(3, n), n))
        s.arp("piano", "1 5 8 10 12 10 8 5", 0.5, 3, v(32, 14))
        s.bass("contrabass", 2, v(36, 10), "half")
        s.motif(m, "felt_piano", every=4, octave=5, vel=v(36, 12), bars=(min(half, n), n))
    elif mood == "hopeful":
        s.pad("pad_warm", 3, v(32, 12), "open"); s.strings("strings", 3, v(30, 16), bars=(min(2, n), n))
        s.arp("piano", "1 5 8 5 10 5 8 5", 0.5, 3, v(34, 16))
        s.bass("finger_bass", 2, v(40, 14), "quarter", bars=(min(q + 1, n), n))
        if I >= 0.35: s.ticks("shaker", 0.5, v(14, 14), bars=(min(half, n), n))
        if I >= 0.5: s.drums({"kick": "x.......x.......", "snare": "........x......."}, "kit_room", 0.25, v(40, 24), bars=(min(half + 1, n), n))
        s.motif(m, "felt_piano", every=4, octave=5, vel=v(38, 14), bars=(min(3, n), n))
    elif mood == "action":
        s.pad("synth_strings", 3, v(34, 14), "open")
        s.ostinato(Motif("1 1 5- 1 1 1 5- 8-", ".5 .5 .5 .5 .5 .5 .5 .5"), "strings", 3, v(40, 20))
        s.pulse("synth_bass", 2, v(46, 24), 0.5)
        s.drums({"kick": "x...x...x...x...", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."}, "kit_room", 0.25, v(48, 26), bars=(min(2, n), n))
        if I >= 0.5: s.pad("horns", 3, v(36, 22), "open", bars=(min(half, n), n))


# ----------------------------------------------------------------------------- tools
def find_soundfont(cfg_path=None):
    if cfg_path and os.path.exists(cfg_path): return os.path.abspath(cfg_path)
    own = sorted(glob.glob(os.path.join(KIT_ROOT, "soundfonts", "*.sf2")) + glob.glob(os.path.join(KIT_ROOT, "soundfonts", "*.sf3")),
                 key=lambda p: (not os.path.basename(p).startswith("GeneralUser"), p))
    cands = own + [os.path.expanduser("~/.reconstruction_studio/soundfonts/GeneralUser-GS.sf2"),
                   "/usr/share/sounds/sf2/FluidR3_GM.sf2", "/usr/share/soundfonts/FluidR3_GM.sf2", "/usr/share/sounds/sf2/default-GM.sf2",
                   "/opt/homebrew/share/soundfonts/default.sf2", "/usr/local/share/soundfonts/default.sf2"]
    for c in cands:
        if c and os.path.exists(c): return os.path.abspath(c)
    return None


def find_fluidsynth():
    p = shutil.which("fluidsynth")
    if p: return p
    for c in glob.glob(os.path.join(KIT_ROOT, "bin", "**", "fluidsynth.exe"), recursive=True) + glob.glob(os.path.join(KIT_ROOT, "bin", "**", "fluidsynth"), recursive=True):
        if os.path.isfile(c): return c
    return None


def _have(mod):
    import importlib.util
    return importlib.util.find_spec(mod) is not None


def _cc_track(curves, t_end):
    """multiply all expression curves of a track and sample them at 20 Hz -> [(t, 0..127)] (neutral 1.0 outside each curve)."""
    if not curves: return []
    lo = max(0.0, min(c[0][0] for c in curves)); hi = min(t_end + 1.0, max(c[-1][0] for c in curves) + 0.05)
    out, last, t = [], None, lo
    while t <= hi:
        v = 1.0
        for c in curves:
            if c[0][0] <= t <= c[-1][0]: v *= _interp(c, t)
        val = int(round(127 * max(0.0, min(1.0, v))))
        if val != last: out.append((t, val)); last = val
        t += 0.05
    if last != 127: out.append((hi + 0.05, 127))
    return out


def _interp(pts, t):
    for (a, va), (b, vb) in zip(pts, pts[1:]):
        if a <= t <= b: return va if b == a else va + (vb - va) * (t - a) / (b - a)
    return pts[-1][1]


def build_tracks(S):
    """per-track sorted notes (drops applied except to hits, same-pitch overlaps fixed, clipped to the film) + CC11 curves."""
    out = {}
    for tr, ev in S.events.items():
        keep = [e for e in ev if e[0] < S.duration - 0.02 and ("@hit" in tr or not S.in_drop(e[0]))]
        keep.sort(key=lambda e: (e[0], e[3]))
        fixed, last = [], {}
        for t, d, v, n in keep:
            if n in last:                                   # a re-struck pitch: end the earlier note just before the new one
                j = last[n]; pt, pd, pv, pn = fixed[j]
                if pt + pd > t - 0.004: fixed[j] = (pt, max(0.02, t - 0.004 - pt), pv, pn)
            last[n] = len(fixed); fixed.append((t, min(d, S.duration + 2.0 - t), v, n))
        if fixed: out[tr] = {"notes": fixed, "cc": _cc_track(S.curves.get(tr, []), S.duration)}
    return out


def write_midi(tracks, path, end_t):
    """MIDI type 1 at 120 bpm (ticks = seconds * 960). Each track gets its own channel; past 15 melodic tracks (or more
    than one drum kit) tracks move to further MIDI ports, so DAWs keep them apart."""
    import mido
    mf = mido.MidiFile(ticks_per_beat=480)
    meta = mido.MidiTrack(); meta.append(mido.MetaMessage("set_tempo", tempo=500000, time=0)); mf.tracks.append(meta)
    mel, drums = 0, 0
    for tr_name, tr in tracks.items():
        I = info(tr_name)
        if I["drum"]: ch, port = 9, drums; drums += 1
        else: ch, port = [c for c in range(16) if c != 9][mel % 15], mel // 15; mel += 1
        msgs = [(0, mido.MetaMessage("midi_port", port=min(port, 127), time=0)),
                (0, mido.Message("control_change", channel=ch, control=0, value=0, time=0)),
                (0, mido.Message("program_change", channel=ch, program=I["prog"], time=0)),
                (0, mido.Message("control_change", channel=ch, control=7, value=110, time=0)),
                (0, mido.Message("control_change", channel=ch, control=11, value=127, time=0)),
                (0, mido.Message("control_change", channel=ch, control=91, value=0, time=0))]
        for t, dur, vel, n in tr["notes"]:
            a = int(round(t * 960)); b = max(a + 1, int(round((t + dur) * 960)))
            msgs.append((a, mido.Message("note_on", channel=ch, note=n, velocity=vel, time=0)))
            msgs.append((b, mido.Message("note_off", channel=ch, note=n, velocity=0, time=0)))
        for t, val in tr["cc"]: msgs.append((int(round(t * 960)), mido.Message("control_change", channel=ch, control=11, value=val, time=0)))
        msgs.append((int(round((end_t + 2.5) * 960)), mido.Message("control_change", channel=ch, control=123, value=0, time=0)))
        msgs.sort(key=lambda m: (m[0], 0 if m[1].type in ("midi_port", "note_off") else 1))
        trk = mido.MidiTrack(); trk.append(mido.MetaMessage("track_name", name=tr_name, time=0)); last = 0
        for tick, m in msgs: m.time = tick - last; last = tick; trk.append(m)
        mf.tracks.append(trk)
    mf.save(path)


def render_fluidsynth(fs, sf2, mid, out_wav, gain=0.5):
    cmd = [fs, "-ni", "-q", "-R", "0", "-C", "0", "-r", str(SR), "-g", str(gain), "-O", "float", "-T", "wav", "-F", out_wav, sf2, mid]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode or not os.path.exists(out_wav) or os.path.getsize(out_wav) < 1000:
        raise RuntimeError("fluidsynth failed: " + (r.stderr or r.stdout)[-600:])


def render_tsf(sf2, track, tr, out_wav, end_t, gain=0.5):
    import numpy as np
    import tinysoundfont
    from pedalboard.io import AudioFile
    I = info(track); syn = tinysoundfont.Synth(samplerate=SR, gain=-6.0); sf = syn.sfload(sf2)
    ch = 9 if I["drum"] else 0
    try: syn.program_select(ch, sf, 0, I["prog"], is_drums=I["drum"])
    except Exception: syn.program_select(ch, sf, 128 if I["drum"] else 0, I["prog"], is_drums=I["drum"])
    syn.control_change(ch, 7, 110); syn.control_change(ch, 11, 127)
    ev = []
    for t, dur, vel, n in tr["notes"]: ev.append((t, 1, n, vel)); ev.append((t + dur, 0, n, 0))
    for t, val in tr["cc"]: ev.append((t, 2, 11, val))
    ev.sort(key=lambda e: (e[0], e[1]))
    total = int((end_t + 2.5) * SR); pos = 0
    with AudioFile(out_wav, "w", SR, 2, bit_depth=32) as f:
        def gen(upto):
            nonlocal pos
            while pos < upto:
                k = min(upto - pos, SR)
                buf = np.frombuffer(syn.generate(k), dtype=np.float32).reshape(-1, 2).T * (gain * 2)
                f.write(np.ascontiguousarray(buf, dtype=np.float32)); pos += k
        for t, kind, a, b in ev:
            gen(min(total, int(t * SR)))
            if kind == 1: syn.noteon(ch, a, b)
            elif kind == 0: syn.noteoff(ch, a)
            else: syn.control_change(ch, a, b)
        gen(total)


def probe_peak(renderer, fs, sf2, prog, note, vel=100):
    """seconds from note-on to the loudest moment of a sample (used to land reverse-cymbal swells exactly), cached."""
    cache_p = os.path.expanduser("~/.reconstruction_studio/probe_cache.json")
    k = f"{os.path.basename(sf2)}|{os.path.getsize(sf2)}|{renderer}|{prog}|{note}|{vel}"
    try: cache = json.load(open(cache_p))
    except Exception: cache = {}
    if k in cache: return cache[k]
    import numpy as np
    from pedalboard.io import AudioFile
    d = tempfile.mkdtemp(); tr = {"notes": [(0.0, 4.0, vel, note)], "cc": []}; name = next(n for n, v in INSTR.items() if v["prog"] == prog and not v["drum"])
    wav = os.path.join(d, "p.wav")
    try:
        if renderer == "fluidsynth": write_midi({name: tr}, os.path.join(d, "p.mid"), 4.0); render_fluidsynth(fs, sf2, os.path.join(d, "p.mid"), wav)
        else: render_tsf(sf2, name, tr, wav, 4.0)
        with AudioFile(wav) as f: x = f.read(f.frames).mean(axis=0)
        hop = SR // 100; env = np.sqrt(np.add.reduceat(x.astype(np.float64) ** 2, np.arange(0, len(x), hop)) / hop)
        peak = float(np.argmax(env) * hop / SR)
    except Exception:
        peak = 1.9
    shutil.rmtree(d, ignore_errors=True)
    cache[k] = peak
    try: os.makedirs(os.path.dirname(cache_p), exist_ok=True); json.dump(cache, open(cache_p, "w"))
    except Exception: pass
    return peak


def loudness(path):
    e = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = re.findall(r"I:\s+(-?[\d.]+) LUFS", e); P = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", e)
    return (float(I[-1]) if I else None), (float(P[-1]) if P else None)


# ----------------------------------------------------------------------------- render
def render(S, P, renderer="auto", sf2=None, keep_stems=False, quiet=False):
    import numpy as np
    from pedalboard import Pedalboard, HighpassFilter, LowpassFilter, Reverb, Compressor, Limiter, Gain
    from pedalboard.io import AudioFile
    cfg = S.cfg or {}
    sf2 = find_soundfont(sf2 or cfg.get("soundfont"))
    if not sf2: sys.exit("No SoundFont found. Run: python tools/music_setup.py   (downloads GeneralUser GS into reconstruction-studio/soundfonts/)")
    fs = find_fluidsynth(); tsf = _have("tinysoundfont")
    if renderer == "auto": renderer = "fluidsynth" if fs else ("tsf" if tsf else None)
    if renderer is None: sys.exit("No synth: run python tools/music_setup.py (FluidSynth, or the TinySoundFont fallback)")
    if renderer == "fluidsynth" and not fs: sys.exit("FluidSynth not found (python tools/music_setup.py), or use --renderer tsf")
    if not _have("pedalboard") or not _have("mido"): sys.exit("Missing python packages: python tools/music_setup.py")
    log = (lambda *a: None) if quiet else print
    build = os.path.join(P, "build"); os.makedirs(build, exist_ok=True)
    sd = os.path.join(build, "music_stems"); shutil.rmtree(sd, ignore_errors=True); os.makedirs(sd)
    # risers: land the reverse cymbal's measured peak on the requested time
    for r in S.risers:
        if r["kind"] in ("cymbal", "both"):
            pk = probe_peak(renderer, fs, sf2, INSTR["reverse_cymbal"]["prog"], 48)
            S._note("reverse_cymbal@riser", max(0.0, r["end"] - pk), pk + 0.4, 48, r["vel"], False); r["cymbal_lead"] = round(pk, 3)
    tracks = build_tracks(S)
    if not tracks: sys.exit("score.py produced no notes")
    end_t = S.duration; N = int(end_t * SR)
    write_midi(tracks, os.path.join(build, "score.mid"), end_t)
    tmp = tempfile.mkdtemp(dir=build, prefix="_bus_")
    bus = {k: np.lib.format.open_memmap(os.path.join(tmp, f"{k}.npy"), mode="w+", dtype=np.float32, shape=(2, N)) for k in ("dry", "send", "hdry", "hsend")}
    CH = SR * 5; riser_peaks = []; used = {}
    for tr_name, tr in tracks.items():
        I = info(tr_name); out = os.path.join(sd, f"{tr_name.replace('@', '_')}.wav"); how = renderer
        try:
            if renderer == "fluidsynth":
                mid = os.path.join(sd, "_t.mid"); write_midi({tr_name: tr}, mid, end_t); render_fluidsynth(fs, sf2, mid, out); os.remove(mid)
            else: render_tsf(sf2, tr_name, tr, out, end_t)
        except Exception as e:
            if renderer == "fluidsynth" and tsf:
                log(f"  {tr_name}: FluidSynth failed ({str(e)[:80]}) — rendering this part with TinySoundFont"); render_tsf(sf2, tr_name, tr, out, end_t); how = "tsf"
            else: raise
        used[tr_name] = how
        fx = [HighpassFilter(cutoff_frequency_hz=I["hp"])] + ([LowpassFilter(cutoff_frequency_hz=I["lp"])] if I["lp"] else []) + [Gain(gain_db=I["gain"])]
        board = Pedalboard(fx); hit = "@hit" in tr_name
        pl, pr = math.cos((I["pan"] + 1) * math.pi / 4) * 1.4142, math.sin((I["pan"] + 1) * math.pi / 4) * 1.4142
        env_r = []
        with AudioFile(out) as f:
            pos = 0
            while pos < N:
                n = min(CH, N - pos)
                x = f.read(n) if f.tell() < f.frames else np.zeros((2, 0), np.float32)
                if x.shape[0] == 1: x = np.vstack([x, x])
                if x.shape[1] < n: x = np.pad(x, ((0, 0), (0, n - x.shape[1])))
                y = board(x.astype(np.float32), SR, reset=False); y[0] *= pl; y[1] *= pr
                bus["hdry" if hit else "dry"][:, pos:pos + n] += y; bus["hsend" if hit else "send"][:, pos:pos + n] += y * I["send"]
                if "@riser" in tr_name:
                    hop = SR // 50; mm = n - n % hop
                    env_r.append(np.sqrt(np.mean(y[:, :mm].reshape(2, -1, hop) ** 2, axis=(0, 2))) if mm else np.zeros(0))
                pos += n
        if env_r:
            e = np.concatenate([a for a in env_r if len(a)]) if any(len(a) for a in env_r) else np.zeros(1)
            for r in S.risers:
                a, b = int(max(0, r["end"] - 4) * 50), int((r["end"] + 0.5) * 50)
                if b > a and b <= len(e): riser_peaks.append((r["end"], tr_name, (a + int(np.argmax(e[a:b]))) / 50.0))
        if not keep_stems: os.remove(out)
    # gain staging: bring the bus to about -20 dBFS RMS (active part) so the compressor and limiter do their job
    probe = np.asarray(bus["dry"][:, ::50] + bus["hdry"][:, ::50]); act = np.abs(probe).max(axis=0) > 1e-4
    rms = float(np.sqrt(np.mean(probe[:, act] ** 2))) if act.any() else 1e-3
    pre = 10 ** ((-20.0 - 20 * math.log10(rms + 1e-9)) / 20)
    rv = cfg.get("reverb", {}) or {}
    def verb(): return Pedalboard([Reverb(room_size=rv.get("size", 0.86), damping=rv.get("damping", 0.45), wet_level=1.0, dry_level=0.0, width=1.0),
                                   HighpassFilter(cutoff_frequency_hz=220), LowpassFilter(cutoff_frequency_hz=8500), Gain(gain_db=rv.get("gainDb", -5.0))])
    vm, vh = verb(), verb()
    comp = Pedalboard([HighpassFilter(cutoff_frequency_hz=28), Compressor(threshold_db=-18, ratio=2.0, attack_ms=20, release_ms=300)])
    lim = Pedalboard([Limiter(threshold_db=-1.5, release_ms=200)])
    env_main, env_all = drop_envelope(S), level_envelope(S)
    raw = os.path.join(build, "music_raw.wav")
    with AudioFile(raw, "w", SR, 2, bit_depth=32) as out:
        pos = 0
        while pos < N:
            n = min(CH, N - pos); sl = slice(pos, pos + n)
            main = (bus["dry"][:, sl] * pre) + vm(np.ascontiguousarray(bus["send"][:, sl] * pre), SR, reset=False)
            hits = (bus["hdry"][:, sl] * pre) + vh(np.ascontiguousarray(bus["hsend"][:, sl] * pre), SR, reset=False)
            m = (comp(np.ascontiguousarray(main * env_main(pos, n), dtype=np.float32), SR, reset=False) + hits) * env_all(pos, n)   # hits skip the compressor
            out.write(lim(np.ascontiguousarray(m, dtype=np.float32), SR, reset=False)); pos += n
    for k in list(bus): del bus[k]
    shutil.rmtree(tmp, ignore_errors=True)
    if not keep_stems: shutil.rmtree(sd, ignore_errors=True)
    I, _ = loudness(raw); target = float(cfg.get("lufs", -20.0)); g = (target - I) if I is not None and I > -70 else 0.0
    final = os.path.join(build, "music.wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af", f"volume={g:.2f}dB,alimiter=limit=0.84:level=false", "-ar", str(SR), "-c:a", "pcm_s24le", final], check=True)
    os.remove(raw)
    I2, pk = loudness(final)
    rep = report(S, tracks, final, riser_peaks)
    meta = {"renderer": renderer, "renderers_used": sorted(set(used.values())), "soundfont": os.path.basename(sf2), "duration": round(S.duration, 3),
            "lufs": I2, "peak": pk, "seed": S.seed, "starter_unchanged": bool(getattr(S, "starter", False)),
            "sections": [{"name": s.name, "start": round(s.t0, 3), "end": round(s.t1, 3), "bpm": round(s.bpm, 2), "target_bpm": s.target_bpm,
                          "fitted": s.fitted, "bars": s.bars, "key": key_name(s.key), "chords": [c.name() for _, _, c in s.timeline]} for s in S.sections],
            "parts": {k: len(v["notes"]) for k, v in tracks.items()}, **rep["json"]}
    json.dump(meta, open(os.path.join(build, "music.json"), "w"), indent=1)
    open(os.path.join(build, "music_report.txt"), "w", encoding="utf-8").write(rep["text"])
    return final, meta, rep


def drop_envelope(S):
    import numpy as np
    def env(pos, n):
        t = (pos + np.arange(n)) / SR; g = np.ones(n, np.float32)
        for a, b, f in S.drops:
            f = max(0.02, f)
            g *= np.clip(np.where(t < b, 1 - (t - a) / f, (t - b) / f), 0, 1).astype(np.float32)
        return g[None, :]
    return env


def level_envelope(S):
    import numpy as np
    pts = sorted(S.levels) or [(0.0, 0.0)]
    tt = np.array([p[0] for p in pts]); dd = np.array([p[1] for p in pts])
    def env(pos, n):
        t = (pos + np.arange(n)) / SR
        g = 10 ** (np.interp(t, tt, dd) / 20) * np.clip(t / 1.2, 0, 1) * np.clip((S.duration - t) / 3.0, 0, 1)
        return g.astype(np.float32)[None, :]
    return env


def key_name(k): return f"{(PC_FLAT if k[1] in ('major', 'lydian', 'mixolydian') else PC_SHARP)[k[0]]} {k[1]}"


def _mmss(t): return f"{int(t // 60)}:{t % 60:04.1f}"


# ----------------------------------------------------------------------------- report (Claude can't listen: this is how the score is checked)
def report(S, tracks, wav, riser_peaks):
    import numpy as np
    L, J = [], {}
    L.append(f"SCORE REPORT  {S.P or ''}  duration {_mmss(S.duration)}  seed {S.seed}")
    if getattr(S, "starter", False): L.append("WARNING: audio/score.py is still the unedited starter — compose it for this film.")
    L.append("\nSECTIONS")
    for s in S.sections:
        flag = "" if s.fitted and abs(s.bpm / s.target_bpm - 1) <= 0.08 else (f"  NOTE tempo {s.bpm:.1f} vs asked {s.target_bpm:.0f}" if s.fitted else "  NOTE not bar-fitted: notes stop at the section end")
        L.append(f"  {_mmss(s.t0)}–{_mmss(s.t1)}  {s.name:<14} {key_name(s.key):<10} {s.bpm:5.1f} bpm  {s.bars} bars{flag}")
        bars = []
        for bar in range(1, s.bars + 1):
            names = []
            for b, l, c in s.timeline:
                if b < bar * s.meter and b + l > (bar - 1) * s.meter: names.append(c.name())
            bars.append(" ".join(dict.fromkeys(names)))
        L.append("      | " + " | ".join(bars) + " |")
    # melody against harmony: a held note a semitone ABOVE a chord tone (a minor 9th) is a clash; a semitone below
    # (a 9th over the root, a major 7th) is a colour/tension — listed separately
    clashes, tensions = [], []
    for tr, d in tracks.items():
        I = info(tr)
        if I["kind"] in ("drums", "perc", "bass", "sustain") or "@" in tr: continue
        notes = d["notes"]
        for k, (t, dur, v, n) in enumerate(notes):
            s = S.section_at(t)
            if not s or dur < 0.45 * s.beat: continue
            c = s.chord_at((t + 0.012 - s.t0) / s.beat); pc = n % 12           # +12 ms: ignore the humanising jitter
            if pc in c.pcs: continue
            nxt = notes[k + 1] if k + 1 < len(notes) else None
            if nxt and dur < 1.5 * s.beat and nxt[0] - (t + dur) < 0.6 and abs(nxt[3] - n) <= 2:     # a neighbour / passing note
                s2 = S.section_at(nxt[0]); c2 = s2.chord_at((nxt[0] + 0.012 - s2.t0) / s2.beat) if s2 else c
                if nxt[3] % 12 in c2.pcs: continue
            if any((pc - x) % 12 == 1 for x in c.pcs): clashes.append((t, tr, note_name(n), c.name(), dur / s.beat))
            elif any((x - pc) % 12 == 1 for x in c.pcs): tensions.append((t, tr, note_name(n), c.name(), dur / s.beat))
    L.append(f"\nCLASHES (melody note a semitone above a chord tone, held or unresolved — usually rewrite): {len(clashes)}")
    for t, tr, nn, cn, b in clashes[:25]: L.append(f"  {_mmss(t)}  {tr:<14} {nn:<5} over {cn:<6} {b:.1f} beats")
    L.append(f"TENSIONS (9ths / major 7ths — fine as colour, check the long ones): {len(tensions)}")
    for t, tr, nn, cn, b in tensions[:12]: L.append(f"  {_mmss(t)}  {tr:<14} {nn:<5} over {cn:<6} {b:.1f} beats")
    L.append(f"\nCUT AT SECTION ENDS: {len(S.cuts)}")
    for t, tr, part, nn, why in S.cuts[:25]: L.append(f"  {_mmss(t)}  {tr:<14} {part:<6} {nn:<5} {why}")
    # busy high parts under speech
    busy = []
    W = [(w["start"], w["end"]) for w in S.words]
    if W:
        ws = np.array([a for a, b in W]); we = np.array([b for a, b in W])
        for tr, d in tracks.items():
            if info(tr)["kind"] in ("drums", "perc", "bass") or "@" in tr: continue
            hi = [t for t, dur, v, n in d["notes"] if n >= 72 and v > 34 and np.any((ws <= t) & (we >= t))]
            for k in range(0, int(S.duration // 4) + 1):
                c = sum(1 for t in hi if 4 * k <= t < 4 * k + 4)
                if c >= 6: busy.append((4 * k, tr, c))
    L.append(f"\nBUSY HIGH PARTS UNDER THE VOICE (≥ 6 loud notes above C5 in 4 s while words are spoken): {len(busy)}")
    for t, tr, c in busy[:20]: L.append(f"  {_mmss(t)}–{_mmss(t + 4)}  {tr:<14} {c} notes")
    # sync table
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", wav, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    def db_(a, b):
        s = x[max(0, int(a * 8000)):max(0, int(b * 8000))]; return round(20 * math.log10(math.sqrt(float(np.mean(s ** 2))) + 1e-9), 1) if len(s) else None
    def near(t):
        if not S.words: return ""
        w = min(S.words, key=lambda w: abs(w["start"] - t)); return f"{w['word']} @ {w['start']:.2f}"
    sync = []
    def peak_(a, b):
        s = x[max(0, int(a * 8000)):max(0, int(b * 8000))]
        if len(s) < 400: return None
        w = s[: len(s) // 400 * 400].reshape(-1, 400); return round(20 * math.log10(float(np.sqrt((w ** 2).mean(axis=1)).max()) + 1e-9), 1)
    for t, kind in S.hits: sync.append({"t": round(t, 3), "what": f"hit {kind}", "word": near(t), "db_before": db_(t - 6, t - 3), "db_after": peak_(t, t + 0.6)})
    for r in S.risers:
        pk = [p for e, tr, p in riser_peaks if abs(e - r["end"]) < 1e-6]
        sync.append({"t": round(r["end"], 3), "what": f"riser {r['kind']} {r['dur']}s", "word": near(r["end"]),
                     "peaks": [round(p, 2) for p in pk], "db_before": db_(r["end"] - r["dur"], r["end"] - r["dur"] + 0.4), "db_after": db_(r["end"] - 0.4, r["end"])})
    for a, b, f in S.drops: sync.append({"t": round(a, 3), "what": f"drop to {b:.2f}", "word": near(a), "db_before": db_(a - 0.6, a), "db_after": db_(a + f + 0.05, b)})
    sync.sort(key=lambda d: d["t"])
    L.append(f"\nSYNC POINTS: {len(sync)}   (hit: bed 3–6 s before -> loudest 20 ms after, aim for +6 dB or more; riser: rising, peaks at its time; drop: after = silence)")
    for d in sync:
        extra = f"  peak {d['peaks']}" if d.get("peaks") else ""
        L.append(f"  {_mmss(d['t'])}  {d['what']:<22} near '{d['word']}'  {d['db_before']} -> {d['db_after']} dB{extra}")
    J.update({"clashes": len(clashes), "tensions": len(tensions), "cuts": len(S.cuts), "busy_under_voice": len(busy), "sync": sync})
    return {"text": "\n".join(L) + "\n", "json": J}


# ----------------------------------------------------------------------------- score.py runner + starter
def run_score(P, path=None):
    path = path or os.path.join(P, "audio", "score.py")
    if not os.path.exists(path): sys.exit(f"no {path} — compose it, or start from: python audio/compose.py --project {P} --init")
    S = Score(P); src = open(path, encoding="utf-8").read(); S.starter = STARTER_MARK in src
    ns = {"S": S, "Motif": Motif, "INSTR": INSTR, "DRUM": DRUM, "MOODS": MOODS, "__name__": "score"}
    exec(compile(src, path, "exec"), ns)
    if not S.sections and not S.events: sys.exit("score.py made no sections or notes")
    return S


def starter_score(P):
    S = Score(P); plan = (S.story or {}).get("music") or []
    secs = [(float(p["start"]), float(p["end"]), p.get("mood", "investigation"), float(p.get("intensity", 0.4))) for p in plan]
    if not secs:
        ch = S.chapters()
        moods = ["investigation", "tension", "tension", "investigation", "somber", "investigation", "mystery", "calm"]
        secs = [(a, b, moods[min(i, len(moods) - 1)] if i < len(ch) - 1 else "somber", 0.35 + 0.1 * (i % 3)) for i, (a, b, _) in enumerate(ch)]
    lines = [
        f'{STARTER_MARK} — not yet composed for this film. Rewrite it (key, motif, instruments, sync points), then delete this line.',
        '# audio/score.py — the original score for this film, composed by Claude.',
        '# Render: python audio/compose.py --project <project>   (mix.py also re-renders it when it is out of date)',
        '# Available: S (Score), Motif, INSTR, DRUM, MOODS. Times are seconds; bars 1-based; beats 0-based.',
        '',
        'KEY, KEY_MAJOR = "D minor", "F major"             # one home key for the film (and its relative major)',
        'S.set_key(KEY)',
        'theme = Motif("5 4 3 . 1", "1 .5 1.5 1 4")          # the film\'s motif — rewrite it for this story',
        '',
    ]
    for i, (a, b, mood, inten) in enumerate(secs):
        k = "KEY_MAJOR" if mood in ("calm", "hopeful") else "KEY"
        lines.append(f'sec{i + 1} = S.preset("{mood}", {a:.3f}, {b:.3f}, intensity={inten:.2f}, key={k}, motif=theme)   # {_mmss(a)}–{_mmss(b)}')
    lines += ['', '# Sync points — examples (point them at real phrases from timeline/words.json):',
              '# t = S.word("the bar opened")', '# S.riser(end=t, dur=2.0, kind="both")', '# S.hit(t, "boom")                              # hits ring through drops',
              '# S.drop(t, t + 3.5)                             # silence after the moment, then the music returns',
              '# S.level([(0, -3), (30, 0)])                    # master level automation in dB']
    return "\n".join(lines) + "\n"


def print_summary(meta, rep, P, full=False):
    print(f"music: {os.path.join(P, 'build', 'music.wav')}  {meta['duration']:.1f}s  {meta['lufs']} LUFS, peak {meta['peak']} dBFS  ({'/'.join(meta['renderers_used'])} + {meta['soundfont']})")
    for s in meta["sections"]: print(f"  {_mmss(s['start'])}–{_mmss(s['end'])}  {s['name']:<14} {s['key']:<10} {s['bpm']:6.1f} bpm  {s['bars']} bars  {' '.join(dict.fromkeys(s['chords']))}")
    print(f"  checks: {meta['clashes']} clash(es), {meta['tensions']} tension(s), {meta['cuts']} cut note(s), {meta['busy_under_voice']} busy-under-voice window(s), {len(meta['sync'])} sync point(s)")
    if meta.get("starter_unchanged"): print("  WARNING: score.py is still the unedited starter — compose it for this film")
    print(f"  report: {os.path.join(P, 'build', 'music_report.txt')}   MIDI: {os.path.join(P, 'build', 'score.mid')}")
    if full: print("\n" + rep["text"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project"); ap.add_argument("--init", action="store_true"); ap.add_argument("--force", action="store_true")
    ap.add_argument("--score", help="score file (default audio/score.py)"); ap.add_argument("--renderer", default="auto", choices=["auto", "fluidsynth", "tsf"])
    ap.add_argument("--soundfont"); ap.add_argument("--stems", action="store_true", help="keep per-instrument stems in build/music_stems/")
    ap.add_argument("--report", action="store_true", help="print the full score report")
    ap.add_argument("--from", dest="t_from", type=float); ap.add_argument("--to", dest="t_to", type=float)
    ap.add_argument("--list", action="store_true"); ap.add_argument("--audition", help="mood preset to render on its own")
    ap.add_argument("--dur", type=float, default=30.0); ap.add_argument("--intensity", type=float, default=0.45); ap.add_argument("--out")
    a = ap.parse_args()
    if a.list:
        print("instruments:", ", ".join(k for k, v in INSTR.items() if not v["drum"]))
        print("drum kits:  ", ", ".join(k for k, v in INSTR.items() if v["drum"]))
        print("drum sounds:", ", ".join(DRUM)); print("moods:      ", ", ".join(f"{k} ({v['key']}, {v['bpm']} bpm)" for k, v in MOODS.items()))
        print("hits:       ", ", ".join(HITS), "  risers: cymbal, strings, both")
        print("soundfont:  ", find_soundfont() or "NONE (python tools/music_setup.py)")
        print("synth:      ", find_fluidsynth() or ("TinySoundFont (FluidSynth not found)" if _have("tinysoundfont") else "NONE (python tools/music_setup.py)"))
        return
    if a.audition:
        P = tempfile.mkdtemp(prefix="audition_")
        S = Score(None, duration=a.dur); S.preset(a.audition, 0, a.dur, a.intensity)
        out, meta, rep = render(S, P, a.renderer, a.soundfont, quiet=True)
        dst = a.out or f"audition_{a.audition}.wav"; os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True); shutil.move(out, dst)
        shutil.rmtree(P, ignore_errors=True)
        print(f"audition {a.audition}: {dst}  ({'/'.join(meta['renderers_used'])}, {meta['soundfont']}, {meta['lufs']} LUFS)"); return
    if not a.project: sys.exit("give --project projects/<slug> (or --list / --audition)")
    P = a.project; sp = a.score or os.path.join(P, "audio", "score.py")
    if a.init:
        if os.path.exists(sp) and not a.force: sys.exit(f"{sp} exists — edit it, or add --force to overwrite")
        os.makedirs(os.path.dirname(sp), exist_ok=True); open(sp, "w", encoding="utf-8").write(starter_score(P))
        print(f"wrote {sp} — a starter only: compose it for this story (key, motif, instruments, sync points), then render"); return
    S = run_score(P, sp)
    out, meta, rep = render(S, P, a.renderer, a.soundfont, keep_stems=a.stems)
    print_summary(meta, rep, P, a.report)
    if a.t_from is not None or a.t_to is not None:
        prev = os.path.join(P, "build", "music_preview.wav"); t0 = a.t_from or 0.0; t1 = a.t_to or S.duration
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t0}", "-t", f"{t1 - t0}", "-i", out, prev], check=True); print(f"  preview: {prev}")


if __name__ == "__main__":
    main()
