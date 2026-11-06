"""audio/mix.py (adapted from aiTrends 2D Studio) — build the soundtrack (voice + music + SFX + ambience), duck, master, and mux.

  python audio/mix.py --project projects/my-video [--video build/video_silent.mp4] [--no-music] [--no-sfx]
  python audio/mix.py --project P --video build/preview.mp4 --start 60 --out build/preview_mix.mp4   (range preview rendered with --from 60;
                                                                        relative paths are inside the project)

Reads config.json and story/shots.json:
  shot "sfx":  [{"at": 0.2, "name": "whoosh", "gain": -8, "dur": 0.7, "seed": 3, "pitch": 1.0}]  (at = seconds from shot start;
               name may also be a path to your own .wav/.mp3 relative to the project)
  shot "amb":  {"name": "rain", "gain": -20}   ambience bed looped under that shot (0.4 s fades)
  music (config.music.source): "score" (default) = the film's original score composed by Claude in audio/score.py and
  rendered by audio/compose.py (re-rendered automatically when score.py, shots.json or words.json changed);
  "file" = config.music.file, your own track (looped/trimmed); "procedural" = the simple synth bed from story "music".
Ducking: music −9 dB and ambience −5 dB while the narrator speaks. Master: loudness-normalised to config.loudness (default −14 LUFS).
Outputs build/mix.wav and, if the silent video exists, out/<title>.mp4.
"""
import argparse, json, os, re, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from dsp import SR, secs, db, rms_db, place, write_wav, as_stereo, lp
from common import load_audio
import sfx as SFX
import music as MUSIC


def envelope(x, att=0.03, rel=0.45):
    """smoothed voice level 0..1 used to duck the music."""
    mono = np.abs(x).mean(axis=1) if x.ndim == 2 else np.abs(x)
    hop = secs(0.01); frames = np.sqrt(np.add.reduceat(mono ** 2, np.arange(0, len(mono), hop)) / hop)
    lv = np.clip((20 * np.log10(frames + 1e-9) + 50) / 30, 0, 1)
    out = np.zeros_like(lv); a, r = np.exp(-0.01 / att), np.exp(-0.01 / rel); v = 0.0
    for i, s in enumerate(lv):
        v = a * v + (1 - a) * s if s > v else r * v + (1 - r) * s; out[i] = v
    return np.repeat(out, hop)[: len(mono)]


def load_any(path, sr=SR):
    return load_audio(path, sr, mono=False)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--project", required=True); ap.add_argument("--video"); ap.add_argument("--no-music", action="store_true"); ap.add_argument("--no-sfx", action="store_true"); ap.add_argument("--out")
    ap.add_argument("--start", type=float, default=0.0, help="for range previews: seconds into the film where --video begins (same as render --from)")
    a = ap.parse_args(); P = a.project
    cfg = json.load(open(os.path.join(P, "config.json"), encoding="utf-8")); story = json.load(open(os.path.join(P, "story", "shots.json"), encoding="utf-8"))
    total = story.get("duration") or story["shots"][-1]["end"]; n = secs(total)
    voice = load_any(os.path.join(P, cfg["voiceover"])) if cfg.get("voiceover") and os.path.exists(os.path.join(P, cfg["voiceover"])) else np.zeros((n, 2), np.float32)
    voice = np.concatenate([voice, np.zeros((max(0, n - len(voice)), 2), np.float32)])[:n]
    v_rms = rms_db(voice[np.abs(voice).mean(1) > db(-40)]) if np.any(np.abs(voice).mean(1) > db(-40)) else -20
    env = envelope(voice)
    mix = voice.copy()
    # ---- music
    mcfg = cfg.get("music", {}) or {}
    if mcfg.get("enabled", True) and not a.no_music:
        src = mcfg.get("source") or ("file" if mcfg.get("file") else "score")
        mus = None
        if src == "file":
            mus = load_any(os.path.join(P, mcfg["file"]))
            reps = int(np.ceil(n / len(mus))); mus = np.concatenate([mus] * reps)[:n]
            k = secs(3); mus[-k:] *= np.linspace(1, 0, k)[:, None]
            print(f"music: your track {mcfg['file']}")
        elif src == "score":
            # the film's own score, composed by Claude in audio/score.py and rendered by audio/compose.py
            score = os.path.join(P, "audio", "score.py"); wav = os.path.join(P, "build", "music.wav")
            comp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "compose.py")
            if not os.path.exists(score):
                print("music: no audio/score.py yet — writing the starter score from the story's music plan (compose it for this film: compose-music skill)")
                subprocess.run([sys.executable, comp, "--project", P, "--init"], check=False)
            deps = [score, comp] + [os.path.join(P, x) for x in ("story/shots.json", "timeline/words.json", "config.json")]
            stale = not os.path.exists(wav) or os.path.getmtime(wav) < max(os.path.getmtime(d) for d in deps if os.path.exists(d))
            ok = os.path.exists(wav) and not stale
            if stale and os.path.exists(score):
                print("music: rendering the score (audio/score.py) …")
                r = subprocess.run([sys.executable, comp, "--project", P]); ok = r.returncode == 0 and os.path.exists(wav)
                if not ok and os.path.exists(wav):
                    print("music: WARNING — the score did not re-render (see above); using the previous build/music.wav, whose sync points may be off. Fix audio/score.py and mix again.")
                    ok = True
                elif not ok: print("music: WARNING — the score did not render (see above); using the procedural bed instead")
            if os.path.exists(score) and "# STARTER SCORE" in open(score, encoding="utf-8").read():
                print("music: WARNING — audio/score.py is still the unedited starter; compose it for this film (compose-music skill)")
            if ok:
                mus = load_any(wav); print("music: composed score build/music.wav")
        if mus is None:
            path = os.path.join(P, "build", "music_procedural.wav")
            plan = story.get("music") or MUSIC.default_plan(total)
            print(f"music: procedural bed, {len(plan)} section(s) — " + ", ".join(f"{s['mood']}@{s.get('intensity', .5)}" for s in plan))
            mus = MUSIC.render_score(plan, total, mcfg.get("seed", 1), mcfg.get("key")); write_wav(path, mus)
        mus = as_stereo(mus)[:n]; mus = np.concatenate([mus, np.zeros((n - len(mus), 2), np.float32)])
        act = np.abs(mus).mean(1) > db(-50)
        mus *= db(v_rms + mcfg.get("gainDb", -17) - (rms_db(mus[act]) if np.any(act) else -30))
        mus *= db(-9 * env)[:, None]
        mix += mus
    # ---- sfx + ambience
    scfg = cfg.get("sfx", {}) or {}
    if scfg.get("enabled", True) and not a.no_sfx:
        bed = np.zeros((n, 2), np.float32); hits = np.zeros((n, 2), np.float32); cache = {}
        cues = []
        for s in story["shots"]:
            for c in s.get("sfx", []) or []: cues.append({**c, "t": s["start"] + float(c.get("at", 0))})
            if s.get("amb"):
                am = s["amb"]; ln = s["end"] - s["start"]
                key = (am["name"], am.get("seed", 1)); base = cache.get(key)
                if base is None: base = cache[key] = SFX.make(am["name"], dur=6.0, seed=am.get("seed", 1))
                loop = np.concatenate([base] * int(np.ceil(ln / (len(base) / SR) + 1)))[: secs(ln)]
                f = min(secs(0.4), len(loop) // 2); loop[:f] *= np.linspace(0, 1, f)[:, None]; loop[-f:] *= np.linspace(1, 0, f)[:, None]
                place(bed, loop, secs(s["start"]), db(am.get("gain", -20)))
        for c in story.get("sfx", []) or []: cues.append({**c, "t": float(c["t"])})
        for c in cues:
            nm = c["name"]
            if re.search(r"\.(wav|mp3|ogg|flac|m4a)$", nm, re.I): snd = load_any(os.path.join(P, nm))
            else: snd = SFX.make(nm, dur=c.get("dur"), seed=c.get("seed"), pitch=c.get("pitch"))
            place(hits, snd, secs(c["t"]), db(c.get("gain", -8)))
        bed *= db(-5 * env)[:, None]
        g = db(scfg.get("gainDb", -6) + (v_rms + 18))   # SFX levels are relative to the voice level
        mix += (hits + bed) * g
        print(f"sfx: {len(cues)} cue(s), ambience on {sum(1 for s in story['shots'] if s.get('amb'))} shot(s)")
    # ---- master: gentle high-pass, soft clip, loudness normalise with ffmpeg
    mix = mix - lp(mix, 25)
    peak = np.abs(mix).max()
    if peak > 0.95: mix = np.tanh(mix / peak * 1.2) / np.tanh(1.2) * 0.95
    raw = os.path.join(P, "build", "mix_raw.wav"); write_wav(raw, mix)
    out_wav = os.path.join(P, "build", "mix.wav"); lufs = cfg.get("loudness", -14)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af", f"loudnorm=I={lufs}:TP=-1.5:LRA=11", "-ar", str(SR), out_wav], check=True)
    print(f"wrote {out_wav}  ({total:.1f}s, target {lufs} LUFS)")
    def proj(pth):   # absolute, cwd-relative inside the project, or project-relative
        if os.path.isabs(pth): return pth
        c = os.path.abspath(pth); pr = os.path.abspath(P)
        return c if c.startswith(pr + os.sep) else os.path.join(pr, pth)
    video = proj(a.video) if a.video else os.path.join(P, "build", "video_silent.mp4")
    if os.path.exists(video):
        safe = re.sub(r"[^\w\- ]+", "", cfg.get("title") or "video").strip().replace(" ", "_") or "video"
        out = proj(a.out) if a.out else os.path.join(P, "out", f"{safe}.mp4"); os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", video, "-ss", f"{a.start:.3f}", "-i", out_wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], check=True)
        print(f"FINAL VIDEO: {out}")
    else:
        print(f"(no silent video at {video} yet — render it, then run this again to mux)")


if __name__ == "__main__":
    main()
