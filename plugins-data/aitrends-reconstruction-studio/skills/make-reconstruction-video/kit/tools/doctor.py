"""tools/doctor.py — check (and optionally install) everything the studio needs.

  python tools/doctor.py            # report
  python tools/doctor.py --install  # also run the install steps that are safe to automate (npm, playwright, pip)
"""
import importlib.util, os, platform, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OS = platform.system()  # Windows | Darwin | Linux
PY = sys.executable
rows, fixes = [], []


def ok(name, good, detail="", fix=None):
    rows.append((("OK      " if good else "MISSING ") + name, detail))
    if not good and fix:
        fixes.append(fix)


def ver(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()[0]
    except Exception:
        return None


ff = shutil.which("ffmpeg") and shutil.which("ffprobe")
ok("ffmpeg + ffprobe", bool(ff), ver(["ffmpeg", "-version"]) or "",
   {"Windows": "winget install --id Gyan.FFmpeg -e   (then open a NEW terminal)", "Darwin": "brew install ffmpeg"}.get(OS, "sudo apt-get install -y ffmpeg"))
nv = ver(["node", "--version"])
ok("Node.js >= 18", bool(nv) and int(nv.lstrip("v").split(".")[0]) >= 18, nv or "",
   {"Windows": "winget install OpenJS.NodeJS.LTS", "Darwin": "brew install node"}.get(OS, "install Node 20 LTS: https://nodejs.org (or curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs)"))
PKGS = ["three", "playwright", "postprocessing", "n8ao", "topojson-client", "world-atlas", "us-atlas", "@fontsource/inter", "@fontsource/archivo", "@fontsource/ibm-plex-mono", "@fontsource/source-serif-4"]
nm = [p for p in PKGS if not os.path.isdir(os.path.join(ROOT, "node_modules", p))]
ok("npm packages (three.js, renderer, maps, fonts)", not nm, ("missing: " + ", ".join(nm)) if nm else "", f'cd "{ROOT}" && npm install')
chrom = False
try:
    out = subprocess.run(["node", "-e", "import('playwright').then(p=>{console.log(p.chromium.executablePath())})"], cwd=ROOT, capture_output=True, text=True, timeout=60).stdout.strip()
    chrom = bool(out) and os.path.exists(out)
except Exception:
    pass
ok("Chromium for Playwright (draws the frames)", chrom, "", f'cd "{ROOT}" && npx playwright install chromium')
for mod, pipname, why in [("numpy", "numpy", "audio"), ("scipy", "scipy", "audio filters"), ("faster_whisper", "faster-whisper", "timestamps"), ("requests", "requests", "ElevenLabs / downloads")]:
    ok(f"python: {pipname} ({why})", importlib.util.find_spec(mod) is not None, "", f'"{PY}" -m pip install {pipname}' + (" --break-system-packages" if OS == "Linux" else ""))
# film score (audio/compose.py): MIDI + effects packages, a SoundFont, and a synth (FluidSynth, or TinySoundFont as fallback)
sys.path.insert(0, os.path.join(ROOT, "audio"))
try:
    import compose as _c; _sf, _fs = _c.find_soundfont(), _c.find_fluidsynth()
except Exception:
    _sf = _fs = None
_ms = f'"{PY}" "{os.path.join(ROOT, "tools", "music_setup.py")}"'
ok("python: mido + pedalboard (score: MIDI, reverb, mastering)", importlib.util.find_spec("mido") is not None and importlib.util.find_spec("pedalboard") is not None, "", _ms)
_own = bool(_sf) and (os.path.abspath(_sf).startswith(os.path.join(ROOT, "soundfonts")) or ".reconstruction_studio" in _sf)
ok("SoundFont for the score (instrument samples)", _own, os.path.basename(_sf) if _own else (f"only {os.path.basename(_sf)} (system) — GeneralUser GS recommended" if _sf else ""), _ms)
ok("synth for the score (FluidSynth or TinySoundFont)", bool(_fs) or importlib.util.find_spec("tinysoundfont") is not None,
   "FluidSynth" if _fs else ("TinySoundFont (FluidSynth optional, sounds a little better)" if importlib.util.find_spec("tinysoundfont") else ""), _ms)
ok("python: pymupdf (optional: PDF document highlights)", importlib.util.find_spec("fitz") is not None, "optional", None)
ok("python >= 3.9", sys.version_info >= (3, 9), sys.version.split()[0], "install Python 3.10+ from https://python.org")

print("\nReconstruction Studio — environment check\n")
for a, b in rows:
    print(f"  {a:58s} {b}")
gpu = "no NVIDIA GPU detected (Windows/macOS still use the built-in GPU through Chrome)"
if shutil.which("nvidia-smi"):
    g = ver(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"])
    gpu = f"NVIDIA GPU: {g}" if g else "NVIDIA GPU found"
print(f"\n  {OS} {platform.machine()}, {os.cpu_count()} CPU threads, {gpu}")
if OS == "Linux" and not shutil.which("nvidia-smi"):
    print("  Linux without a GPU (server / Cowork VM): frames render in software (SwiftShader) — fine for previews, slow for long videos.")
fixes = list(dict.fromkeys(fixes))          # the same fix can be suggested by several rows
if fixes:
    print("\nTo fix, run:")
    for f in fixes:
        print("  " + f)
    if "--install" in sys.argv:
        for f in fixes:
            if f.startswith(("cd ", f'"{PY}"')):
                print(f"\n>>> {f}")
                subprocess.run(f, shell=True, cwd=ROOT)
        print("\nRe-run: python tools/doctor.py")
else:
    print("\nAll good. Whisper downloads its model the first time tools/transcribe.py runs (base ~150 MB, small ~500 MB).")
