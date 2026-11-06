"""tools/pauses.py — find and (only when told to) shorten long silences in the voiceover, BEFORE timestamping.

  python tools/pauses.py --project projects/X                         # analysis only: prints what WOULD change
  python tools/pauses.py --project projects/X --apply [--profile documentary|tight|gentle] [--max 1.15 --to 0.85]
  python tools/pauses.py --project projects/X --skip                  # keep the narration exactly as recorded

Input  audio/voiceover_raw.wav (from voice_import.py / elevenlabs_tts.py / VoiceStudio export)
Output audio/voiceover.wav (the master every later step uses) + audio/pauses_report.json

Energy-based: a pause is a run of frames 30 dB under the speech level (and below -42 dBFS). Every pause longer than
--max is shortened to --to, cutting in the quietest middle part with 15 ms equal-power crossfades (no clicks; breaths
at the edges are kept). Leading silence is trimmed to --lead, trailing to --tail.
Profiles (measured from long-form reconstruction narrations: sentence pauses median ~0.7 s, 90th pct ~1.1 s):
  documentary  max 1.15 s -> 0.85 s   keeps the deliberate beats, removes dead air        (long-form default)
  gentle       max 1.60 s -> 1.10 s   only the really long gaps
  tight        max 0.60 s -> 0.42 s   near-continuous delivery for 9:16 shorts             (short-form default)
"""
import argparse, json, os, shutil, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import load_json, save_json

SR = 48000
PROFILES = {"documentary": (1.15, 0.85), "gentle": (1.6, 1.1), "tight": (0.6, 0.42)}


def read(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def write(path, x):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "pcm_s24le", path], input=np.clip(x, -1, 1).astype(np.float32).tobytes(), check=True)


def find_pauses(x, min_len=0.25):
    fr = int(0.01 * SR); nf = len(x) // fr
    env = np.sqrt(np.mean(x[: nf * fr].reshape(nf, fr) ** 2, axis=1) + 1e-12); db = 20 * np.log10(env + 1e-12)
    speech = np.percentile(db[db > -60], 70) if np.any(db > -60) else -20
    floor = np.percentile(db, 8)                      # room tone / noise floor of this recording
    thr = min(speech - 18, max(floor + 8, speech - 35)); quiet = db < thr
    runs, i = [], 0
    while i < nf:
        if quiet[i]:
            j = i
            while j < nf and quiet[j]: j += 1
            if (j - i) * 0.01 >= min_len: runs.append((i * fr, j * fr))
            i = j
        else: i += 1
    return runs, thr, speech


def plan_cuts(x, runs, mx, to, lead, tail):
    n = len(x); cuts = []
    for k, (a, b) in enumerate(runs):
        L = (b - a) / SR
        if a == 0:                      # leading silence
            if L > lead: cuts.append((0, b - int(lead * SR), L, "lead"))
            continue
        if b >= n - int(0.02 * SR):      # trailing silence
            if L > tail: cuts.append((a + int(tail * SR), n, L, "tail"))
            continue
        if L > mx:
            remove = int((L - to) * SR); mid = (a + b) // 2
            c0 = max(a + int(0.03 * SR), mid - remove // 2); cuts.append((c0, c0 + remove, L, "pause"))
    return cuts


def apply_cuts(x, cuts, fade=0.015):
    fl = int(fade * SR); out, pos = [], 0
    for c0, c1, *_ in sorted(cuts):
        seg = x[pos:c0]
        if out and fl and len(seg) > fl and len(out[-1]) > fl:
            t = np.linspace(0, 1, fl, dtype=np.float32); mixed = out[-1][-fl:] * np.cos(t * np.pi / 2) + seg[:fl] * np.sin(t * np.pi / 2)
            out[-1] = out[-1][:-fl]; seg = np.concatenate([mixed, seg[fl:]])
        out.append(seg); pos = c1
    if pos < len(x):
        seg = x[pos:]
        if out and fl and len(seg) > fl and len(out[-1]) > fl:
            t = np.linspace(0, 1, fl, dtype=np.float32); mixed = out[-1][-fl:] * np.cos(t * np.pi / 2) + seg[:fl] * np.sin(t * np.pi / 2)
            out[-1] = out[-1][:-fl]; seg = np.concatenate([mixed, seg[fl:]])
        out.append(seg)
    return np.concatenate(out) if out else x


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True); ap.add_argument("--apply", action="store_true"); ap.add_argument("--skip", action="store_true")
    ap.add_argument("--profile", choices=sorted(PROFILES)); ap.add_argument("--max", type=float); ap.add_argument("--to", type=float)
    ap.add_argument("--lead", type=float, default=0.15); ap.add_argument("--tail", type=float, default=0.8); ap.add_argument("--input")
    a = ap.parse_args(); P = a.project
    cfg = load_json(os.path.join(P, "config.json"))
    src = a.input or os.path.join(P, cfg.get("voiceover_raw", "audio/voiceover_raw.wav"))
    dst = os.path.join(P, "audio", "voiceover.wav")
    if not os.path.exists(src): sys.exit(f"no raw voiceover at {src} — import or generate it first")
    if a.skip:
        shutil.copy(src, dst); cfg.setdefault("voice", {})["pauses"] = "kept as recorded"; save_json(os.path.join(P, "config.json"), cfg)
        print(f"kept the narration as recorded -> {dst}"); return
    prof = a.profile or (cfg.get("voice", {}).get("pauses") if cfg.get("voice", {}).get("pauses") in PROFILES else ("tight" if cfg.get("format") == "short" else "documentary"))
    mx, to = PROFILES[prof]; mx = a.max or mx; to = a.to or min(to, mx)
    x = read(src); runs, thr, speech = find_pauses(x)
    cuts = plan_cuts(x, runs, mx, to, a.lead, a.tail)
    pauses = [c for c in cuts if c[3] == "pause"]; removed = sum((c[1] - c[0]) for c in cuts) / SR; dur = len(x) / SR
    all_mid = [(b - a_) / SR for a_, b in runs if a_ > 0 and b < len(x) - int(0.02 * SR)]
    print(f"voiceover {dur:.1f}s | speech level {speech:.0f} dBFS, silence threshold {thr:.0f} dBFS")
    print(f"pauses >= 0.25 s: {len(all_mid)}  (median {np.median(all_mid) if all_mid else 0:.2f}s, longest {max(all_mid) if all_mid else 0:.2f}s)")
    print(f"profile '{prof}': pauses longer than {mx:.2f}s -> {to:.2f}s  =>  {len(pauses)} pause(s) shortened, {removed:.1f}s removed in total ({dur:.1f}s -> {dur - removed:.1f}s)")
    for c in sorted(pauses, key=lambda c: -c[2])[:8]: print(f"   at {int(c[0] / SR // 60):d}:{(c[0] / SR) % 60:05.2f}  {c[2]:.2f}s -> {to:.2f}s")
    lead = [c for c in cuts if c[3] == "lead"]; tail = [c for c in cuts if c[3] == "tail"]
    if lead: print(f"   leading silence {lead[0][2]:.2f}s -> {a.lead:.2f}s")
    if tail: print(f"   trailing silence {tail[0][2]:.2f}s -> {a.tail:.2f}s")
    report = {"profile": prof, "max": mx, "to": to, "duration_before": round(dur, 3), "duration_after": round(dur - removed, 3), "removed_s": round(removed, 3),
              "cuts": [{"at": round(c[0] / SR, 3), "was": round(c[2], 3), "kind": c[3]} for c in cuts], "applied": bool(a.apply)}
    save_json(os.path.join(P, "audio", "pauses_report.json"), report)
    if not a.apply:
        print("\nanalysis only — nothing changed. Re-run with --apply to shorten, or --skip to keep the narration as recorded."); return
    y = apply_cuts(x, cuts); write(dst, y)
    cfg.setdefault("voice", {})["pauses"] = prof; cfg["voiceover"] = "audio/voiceover.wav"; save_json(os.path.join(P, "config.json"), cfg)
    print(f"\nwrote {dst} ({len(y) / SR:.1f}s). The untouched original stays at {src}.")


if __name__ == "__main__":
    main()
