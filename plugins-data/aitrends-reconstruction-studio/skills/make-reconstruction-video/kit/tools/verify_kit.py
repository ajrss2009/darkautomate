"""tools/verify_kit.py — confirm the studio files are all present after copying the kit."""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ["package.json", "player.html", "render.mjs",
         *[f"engine/{f}" for f in ["api.js", "core.js", "looks.js", "world.js", "kit3d.js", "vehicles.js", "maps.js", "ui.js", "player.js"]],
         *[f"tools/{f}" for f in ["common.py", "doctor.py", "new_project.py", "voice_import.py", "pauses.py", "transcribe.py", "beats.py", "script_lint.py", "script_export.py", "elevenlabs_tts.py", "capture_article.mjs", "doc_page.py", "media_log.py", "qc_video.py", "verify_kit.py", "music_setup.py"]],
         *[f"audio/{f}" for f in ["dsp.py", "sfx.py", "music.py", "mix.py", "compose.py"]],
         "examples/demo/config.json", "examples/demo/story/shots.json", "examples/demo/timeline/words.json"]
missing = [f for f in FILES if not os.path.exists(os.path.join(ROOT, f))]
sets = os.listdir(os.path.join(ROOT, "examples/demo/scenes/sets")) if os.path.isdir(os.path.join(ROOT, "examples/demo/scenes/sets")) else []
shots = os.listdir(os.path.join(ROOT, "examples/demo/scenes/shots")) if os.path.isdir(os.path.join(ROOT, "examples/demo/scenes/shots")) else []
print(f"kit files: {len(FILES) - len(missing)}/{len(FILES)}; demo sets {len(sets)}, demo shots {len(shots)}")
if missing: print("MISSING:", ", ".join(missing)); sys.exit(1)
print("kit OK")
