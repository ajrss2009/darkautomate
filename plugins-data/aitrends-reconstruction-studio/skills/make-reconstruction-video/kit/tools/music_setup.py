#!/usr/bin/env python3
"""tools/music_setup.py — install what the film score needs (audio/compose.py), then test-render a few seconds.

  python tools/music_setup.py            check + install the missing pieces (pip packages, SoundFont, FluidSynth)
  python tools/music_setup.py --check    report only
  python tools/music_setup.py --system   also run the system package install for FluidSynth (brew / apt) — ask the user first

What it installs:
  - Python: mido (MIDI files), pedalboard (reverb, EQ, compression, limiter), tinysoundfont (built-in sample synth; fallback)
  - SoundFont: GeneralUser GS (S. Christian Collins; free for any music, private or commercial) -> soundfonts/GeneralUser-GS.sf2
  - FluidSynth (best-sounding renderer, optional — TinySoundFont is used without it):
      Windows: the official release zip from GitHub, unpacked into reconstruction-studio/bin/fluidsynth/ (no admin rights needed)
      macOS:   brew install fluid-synth        Linux: sudo apt-get install -y --no-install-recommends fluidsynth
Everything lands inside the studio folder or the current Python; nothing else on the computer is changed unless --system.
"""
import glob, hashlib, importlib.util, io, json, os, platform, shutil, subprocess, sys, tempfile, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OS = platform.system()
SF_DIR = os.path.join(ROOT, "soundfonts")
SF_URLS = [("GeneralUser-GS.sf2", "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2"),
           ("MuseScore_General.sf3", "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3")]
SF_LICENSE = "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/documentation/LICENSE.txt"
GU_SHA256 = "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe"   # v2.0.x as tested; a newer release may differ
sys.path.insert(0, os.path.join(ROOT, "audio"))   # compose.find_soundfont / find_fluidsynth


def say(ok, name, detail=""): print(f"  {'OK     ' if ok else 'MISSING'} {name:46s} {detail}")


def have(mod): return importlib.util.find_spec(mod) is not None


def pip(*args):
    cmd = [sys.executable, "-m", "pip", "install", "-q", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode and "externally-managed" in (r.stderr + r.stdout):
        r = subprocess.run(cmd + ["--break-system-packages"], capture_output=True, text=True)
    if r.returncode: print((r.stderr or r.stdout)[-800:])
    return r.returncode == 0


def fetch(url, dst, min_bytes=0):
    tmp = dst + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "reconstruction-studio/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f: shutil.copyfileobj(r, f, 1 << 20)
    if os.path.getsize(tmp) < min_bytes: os.remove(tmp); raise RuntimeError(f"download too small: {url}")
    os.replace(tmp, dst); return dst


def valid_sf(path):
    try:
        with open(path, "rb") as f: h = f.read(12)
        return h[:4] == b"RIFF" and h[8:12] == b"sfbk" and os.path.getsize(path) > 5_000_000
    except OSError: return False


def soundfont():
    import compose
    return compose.find_soundfont()


def install_soundfont():
    os.makedirs(SF_DIR, exist_ok=True)
    for name, url in SF_URLS:
        dst = os.path.join(SF_DIR, name)
        if os.path.exists(dst) and valid_sf(dst): return dst
        try:
            print(f"  downloading {name} …"); fetch(url, dst, 5_000_000)
            if not valid_sf(dst): os.remove(dst); raise RuntimeError("not a SoundFont")
            if name.startswith("GeneralUser"):
                sha = hashlib.sha256(open(dst, "rb").read()).hexdigest()
                if sha != GU_SHA256: print(f"  note: GeneralUser GS checksum {sha[:12]}… differs from the tested version (probably a newer release) — fine")
                try: fetch(SF_LICENSE, os.path.join(SF_DIR, "GeneralUser-GS_LICENSE.txt"))
                except Exception: pass
            return dst
        except Exception as e:
            print(f"  could not get {name}: {e}")
    return None


def fluidsynth_path():
    import compose
    return compose.find_fluidsynth()


def install_fluidsynth(system=False):
    if OS == "Windows":
        try:
            api = "https://api.github.com/repos/FluidSynth/fluidsynth/releases/latest"
            rel = json.load(urllib.request.urlopen(urllib.request.Request(api, headers={"User-Agent": "reconstruction-studio"}), timeout=60))
            arm = platform.machine().lower() in ("arm64", "aarch64")
            def fits(n):
                n = n.lower()
                if not (n.endswith(".zip") and "win" in n): return False
                return ("arm64" in n) if arm else ("x64" in n or "amd64" in n) and "arm" not in n
            assets = [a for a in rel.get("assets", []) if fits(a["name"])]
            assets.sort(key=lambda a: ("win10" not in a["name"].lower(), "cpp11" in a["name"].lower(), a["name"]))
            if not assets: raise RuntimeError("no Windows zip in the latest release")
            a = assets[0]; print(f"  downloading FluidSynth {rel.get('tag_name')} ({a['name']}) …")
            data = urllib.request.urlopen(urllib.request.Request(a["browser_download_url"], headers={"User-Agent": "reconstruction-studio"}), timeout=300).read()
            dst = os.path.join(ROOT, "bin", "fluidsynth"); shutil.rmtree(dst, ignore_errors=True); os.makedirs(dst)
            zipfile.ZipFile(io.BytesIO(data)).extractall(dst)
        except Exception as e:
            print(f"  FluidSynth download failed ({e}) — the score will render with TinySoundFont instead")
    elif system:
        cmd = ["brew", "install", "fluid-synth"] if OS == "Darwin" else ["sudo", "apt-get", "install", "-y", "--no-install-recommends", "fluidsynth"]
        print("  running: " + " ".join(cmd)); subprocess.run(cmd)
    return fluidsynth_path()


def main():
    check = "--check" in sys.argv; system = "--system" in sys.argv
    print("\nFilm score tools\n")
    pk = {"mido": have("mido"), "pedalboard": have("pedalboard"), "tinysoundfont": have("tinysoundfont")}
    if not check:
        if not (pk["mido"] and pk["pedalboard"]): pip("mido", "pedalboard"); pk["mido"], pk["pedalboard"] = have("mido"), have("pedalboard")
        if not pk["tinysoundfont"]:
            pip("--no-deps", "--prefer-binary", "tinysoundfont"); pk["tinysoundfont"] = have("tinysoundfont")   # wheels exist for Python <= 3.12; newer Pythons need a compiler
    say(pk["mido"], "python: mido (MIDI score files)")
    say(pk["pedalboard"], "python: pedalboard (reverb, EQ, compression)")
    say(pk["tinysoundfont"], "python: tinysoundfont (sample synth, fallback)", "" if pk["tinysoundfont"] else "optional when FluidSynth is installed")
    sf = soundfont()
    own = glob.glob(os.path.join(SF_DIR, "*.sf2")) + glob.glob(os.path.join(SF_DIR, "*.sf3"))
    if not own and not check: sf = install_soundfont() or sf      # the studio's own copy, so every machine sounds the same
    say(bool(sf), "SoundFont (the instrument samples)", sf or "run without --check to download GeneralUser GS (~32 MB)")
    fs = fluidsynth_path()
    if not fs and not check and (OS == "Windows" or system): fs = install_fluidsynth(system)
    hint = {"Darwin": "brew install fluid-synth", "Windows": "python tools/music_setup.py"}.get(OS, "sudo apt-get install -y --no-install-recommends fluidsynth")
    say(bool(fs), "FluidSynth (the score's renderer)", fs or (f"not found — TinySoundFont will be used. For the best sound: {hint}" if pk["tinysoundfont"] else hint))
    ready = sf and pk["mido"] and pk["pedalboard"] and (fs or pk["tinysoundfont"])
    if not (fs or pk["tinysoundfont"]):
        print(f"\n  No synth yet. FluidSynth is the one to install here: {hint}" + ("  (ask the user, then run: python tools/music_setup.py --system)" if OS != "Windows" else ""))
    if ready and not check:
        out = os.path.join(tempfile.mkdtemp(), "test.wav")
        r = subprocess.run([sys.executable, os.path.join(ROOT, "audio", "compose.py"), "--audition", "investigation", "--dur", "8", "--out", out], capture_output=True, text=True)
        ok = r.returncode == 0 and os.path.exists(out)
        say(ok, "test render (8 s of the 'investigation' preset)", (r.stdout.strip().splitlines() or [""])[-1][:90] if ok else (r.stderr or r.stdout)[-300:])
        ready = ok
    print("\n" + ("Score tools ready: audio/compose.py can render the music." if ready else "Not ready yet — fix the MISSING lines above."))
    sys.exit(0 if ready else 1)


if __name__ == "__main__":
    main()
