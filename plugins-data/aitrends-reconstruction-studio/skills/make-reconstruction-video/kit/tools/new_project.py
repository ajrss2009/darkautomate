"""tools/new_project.py — create the folder for one video.

  python tools/new_project.py --name flight-1073 --title "What Really Happened Inside the Cockpit" \
      --format long|short --look clay|day|golden|dusk|night|overcast [--resolution 1080p] [--fps 30] [--captions]

format long  = 16:9, 12-18 min documentary;  short = 9:16, 60-90 s (captions on by default).
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import save_json

ap = argparse.ArgumentParser()
ap.add_argument("--name", required=True)
ap.add_argument("--title", default="")
ap.add_argument("--format", default="long", choices=["long", "short"])
ap.add_argument("--look", default="clay", help="default look: 3D sets/shots that don't name one, and the theme of 2D-only cards")
ap.add_argument("--resolution", default="1080p", choices=["720p", "1080p", "1440p", "2160p", "4k"])
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--captions", action="store_true")
ap.add_argument("--badge", default="RECONSTRUCTION", help="text of the top-right badge on 3D shots ('' for none)")
a = ap.parse_args()

root = os.path.join("projects", a.name)
if os.path.exists(os.path.join(root, "config.json")):
    sys.exit(f"{root} already exists — not overwritten.")
for d in ["research", "script", "audio", "timeline", "story", "scenes/lib", "scenes/sets", "scenes/shots",
          "assets/photos", "assets/articles", "assets/docs", "assets/stills", "build", "out"]:
    os.makedirs(os.path.join(root, d), exist_ok=True)
short = a.format == "short"
cfg = {
    "title": a.title or a.name, "format": a.format, "aspect": "9:16" if short else "16:9", "resolution": a.resolution, "fps": a.fps,
    "look": a.look, "quality": "standard", "voiceover": "audio/voiceover.wav", "duration": None,
    "captions": bool(a.captions or short), "fadeIn": 0.4, "fadeOut": 1.0,
    "ui": {"badge": a.badge or None, "look2d": a.look, "karaoke": short},
    "music": {"enabled": True, "source": "score", "gainDb": -19, "lufs": -20, "soundfont": None, "seed": 1}, "sfx": {"enabled": True, "gainDb": -8}, "loudness": -14,
    "voice": {"engine": None, "voice": None, "pauses": "documentary" if not short else "tight"},
}
save_json(os.path.join(root, "config.json"), cfg)
with open(os.path.join(root, "research", "media_log.csv"), "w", encoding="utf-8") as f:
    f.write("file,source_url,owner_or_outlet,licence_or_basis,credit_line,used_in_shots,notes\n")
with open(os.path.join(root, "PROJECT_STATE.md"), "w", encoding="utf-8") as f:
    f.write(f"# {cfg['title']}\n\n- format: {a.format} ({cfg['aspect']}, {a.resolution} @ {a.fps} fps)\n- stage: created\n- script: not written\n- voiceover: none\n- next: research\n")
print(f"created {root}  ({a.format}: {cfg['aspect']} {a.resolution} @ {a.fps} fps, captions {'on' if cfg['captions'] else 'off'})")
