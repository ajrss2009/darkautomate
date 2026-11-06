"""tools/voice_import.py — bring any voiceover file into the project as audio/voiceover_raw.wav (48 kHz mono PCM).

  python tools/voice_import.py --project projects/X --file "C:/Users/me/Downloads/voice.mp3" [--engine voicestudio|elevenlabs|upload] [--voice "Name"]

Accepts wav, mp3, m4a, m4b, aac, flac, ogg, mp4/mov (audio track). Reports duration, loudness, peak, words-per-minute
estimate (if a script exists) and the long pauses found, so the pause question can be asked with real numbers.
"""
import argparse, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import load_json, save_json, probe_duration

ap = argparse.ArgumentParser()
ap.add_argument("--project", required=True)
ap.add_argument("--file", required=True)
ap.add_argument("--engine", default="upload")
ap.add_argument("--voice", default=None)
a = ap.parse_args()
P = a.project
if not os.path.exists(a.file):
    sys.exit(f"file not found: {a.file}")
out = os.path.join(P, "audio", "voiceover_raw.wav")
if os.path.abspath(a.file) == os.path.abspath(out):
    sys.exit("that file already is audio/voiceover_raw.wav (ElevenLabs writes it directly) — skip the import and run tools/pauses.py")
os.makedirs(os.path.dirname(out), exist_ok=True)
r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.file, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s24le", out], capture_output=True, text=True)
if r.returncode:
    sys.exit("ffmpeg could not read the file: " + r.stderr[-500:])
dur = probe_duration(out)
st = subprocess.run(["ffmpeg", "-hide_banner", "-i", out, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
I = re.findall(r"I:\s+(-?[\d.]+) LUFS", st); pk = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", st)
cfg = load_json(os.path.join(P, "config.json"))
cfg.setdefault("voice", {}).update({"engine": a.engine, "voice": a.voice or cfg.get("voice", {}).get("voice"), "source_file": os.path.basename(a.file)})
cfg["voiceover_raw"] = "audio/voiceover_raw.wav"
save_json(os.path.join(P, "config.json"), cfg)
print(f"imported {a.file}\n  -> {out}\n  duration {dur:.2f}s ({dur / 60:.1f} min), loudness {I[-1] if I else '?'} LUFS, peak {pk[-1] if pk else '?'} dBFS")
scr = os.path.join(P, "script", "script_final.txt")
if os.path.exists(scr):
    n = len(re.findall(r"\S+", open(scr, encoding="utf-8").read()))
    print(f"  script words {n} -> {n / max(1e-6, dur / 60):.0f} wpm")
try:
    from common import approval_status
    ok_, msg = approval_status(P)
    if not ok_: print("NOTE: " + msg + " — the narration is timed against the approved script, so settle that before transcribing.")
except Exception:
    pass
print("next: python tools/pauses.py --project " + P + "   (analysis only; nothing is changed until --apply)")
