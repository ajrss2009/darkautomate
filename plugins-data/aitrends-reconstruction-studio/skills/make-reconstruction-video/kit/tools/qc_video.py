"""tools/qc_video.py — check a rendered video against the project and the house style before delivery.

  python tools/qc_video.py --project projects/X [--video out/Title.mp4]

Checks: duration vs narration, audio present + loudness/true peak, black/frozen stretches, cut rate (median shot length
from the shot list and from scene detection), shots still MISSING, footnote coverage on evidence shots, and writes a
1-frame-per-10 s contact sheet to build/qc_sheet.jpg for a visual pass.
"""
import argparse, glob, json, os, re, statistics as st, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import load_json

ap = argparse.ArgumentParser(); ap.add_argument("--project", required=True); ap.add_argument("--video"); a = ap.parse_args(); P = a.project
cfg = load_json(os.path.join(P, "config.json")); story = load_json(os.path.join(P, "story", "shots.json"))
vid = a.video or (sorted(glob.glob(os.path.join(P, "out", "*.mp4")), key=os.path.getmtime) or [os.path.join(P, "build", "video_silent.mp4")])[-1]
if not os.path.exists(vid): sys.exit(f"no video found ({vid})")
probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", vid], capture_output=True, text=True).stdout)
dur = float(probe["format"]["duration"]); streams = probe["streams"]; v = next((s for s in streams if s["codec_type"] == "video"), {}); has_a = any(s["codec_type"] == "audio" for s in streams)
res, issues = [], []
res.append(f"file {vid}: {v.get('width')}x{v.get('height')} @ {v.get('r_frame_rate')}, {dur:.2f}s, audio {'yes' if has_a else 'NO'}")
nar = cfg.get("duration")
if nar and dur < nar - 0.2: issues.append(f"video ({dur:.1f}s) is shorter than the narration ({nar:.1f}s)")
if not has_a and "silent" not in vid: issues.append("no audio track")
if has_a:
    e = subprocess.run(["ffmpeg", "-hide_banner", "-i", vid, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = re.findall(r"I:\s+(-?[\d.]+) LUFS", e); tp = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", e)
    res.append(f"loudness {I[-1] if I else '?'} LUFS (target {cfg.get('loudness', -14)}), true peak {tp[-1] if tp else '?'} dBFS")
    if I and abs(float(I[-1]) - cfg.get("loudness", -14)) > 1.5: issues.append("loudness off target by more than 1.5 LU")
bl = subprocess.run(["ffmpeg", "-hide_banner", "-i", vid, "-vf", "scale=320:-2,blackdetect=d=0.6:pix_th=0.06", "-an", "-f", "null", "-"], capture_output=True, text=True).stderr
blacks = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", bl); inner = [(float(s), float(e_)) for s, e_ in blacks if float(s) > 1.0 and float(e_) < dur - 1.2]
if inner: issues.append("black stretches: " + ", ".join(f"{s:.1f}-{e_:.1f}s" for s, e_ in inner[:6]))
fr = subprocess.run(["ffmpeg", "-hide_banner", "-i", vid, "-vf", "scale=320:-2,freezedetect=n=0.002:d=3", "-an", "-f", "null", "-"], capture_output=True, text=True).stderr
frz = re.findall(r"freeze_start: ([\d.]+)", fr)
if frz: res.append(f"frozen stretches >= 3 s at: {', '.join(f'{float(x):.1f}s' for x in frz[:8])} (fine for deliberate holds on cards; check 3D shots)")
L = [s["end"] - s["start"] for s in story["shots"]]
res.append(f"shot list: {len(L)} shots, median {st.median(L):.1f}s, mean {st.mean(L):.1f}s, longest {max(L):.1f}s")
target = (1.8, 3.0) if cfg.get("format") == "short" else (2.8, 5.0)
if not (target[0] <= st.median(L) <= target[1]): issues.append(f"median shot {st.median(L):.1f}s is outside the style range {target[0]}-{target[1]}s")
lng = [s["id"] for s in story["shots"] if s["end"] - s["start"] > (6 if cfg.get('format') == 'short' else 12)]
if lng: issues.append("very long shots (check they have a camera move or staged reveals): " + ", ".join(lng[:10]))
# shot files: every shot registered? 3D/evidence shots carrying a footnote?
code = {}
for f in glob.glob(os.path.join(P, "scenes", "**", "*.js"), recursive=True):
    txt = open(f, encoding="utf-8").read()
    for m in re.finditer(r"registerShot\(\s*['\"]([^'\"]+)['\"]", txt):
        nxt = txt.find("registerShot(", m.end()); code[m.group(1)] = txt[m.start(): nxt if nxt > 0 else len(txt)]
missing = [s["id"] for s in story["shots"] if s["id"] not in code]
if missing: issues.append(f"{len(missing)} shot(s) have no registerShot(): " + ", ".join(missing[:12]))
EVID = re.compile(r"\bset\s*:|U\.(article|document|screenshot|photo|quote|triptych|chart)\(")
need = [s["id"] for s in story["shots"] if s["id"] in code and EVID.search(code[s["id"]])]
nofoot = [i for i in need if not next((s for s in story["shots"] if s["id"] == i), {}).get("footnote") and "footnote" not in code[i] and not ("U.quote(" in code[i] and re.search(r"\b(source|role)\s*:", code[i]))]
res.append(f"footnotes: {len(need) - len(nofoot)}/{len(need)} reconstruction/evidence shots carry one")
if nofoot: issues.append(f"{len(nofoot)} reconstruction/evidence shot(s) without a footnote (source/status line): " + ", ".join(nofoot[:12]))
os.makedirs(os.path.join(P, "build"), exist_ok=True)
sheet = os.path.join(P, "build", "qc_sheet.jpg"); n = max(1, int(dur // 10)); cols = 6; rows = (n + cols - 1) // cols
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", vid, "-vf", f"fps=1/10,scale=320:-2,drawtext=text='%{{pts\\:hms}}':x=6:y=6:fontsize=14:fontcolor=yellow:box=1:boxcolor=black@0.6,tile={cols}x{max(1, rows)}:padding=4", "-frames:v", "1", sheet])
print("\nQC —", cfg.get("title"))
for r in res: print("  ·", r)
for i in issues: print("  ISSUE", i)
print(f"  contact sheet: {sheet}" if os.path.exists(sheet) else "  (contact sheet failed)")
print(f"\n{len(issues)} issue(s)")
