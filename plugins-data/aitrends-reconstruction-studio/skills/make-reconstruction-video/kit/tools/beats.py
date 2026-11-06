"""tools/beats.py — beat sheet + draft story/shots.json from the word timings (adapted from aiTrends 2D Studio).

  python tools/beats.py --project projects/X [--target 3.6] [--max 7] [--min 1.6] [--lead 0.12] [--force]

A beat is a phrase that gets its own picture. Long sentences split at commas / conjunctions; short fragments merge.
Reconstruction pacing: median shot 3-4 s in long-form (many 2-3 s cuts in action, 6-8 s holds on 3D moves),
2-2.5 s in shorts. Each beat becomes one draft shot (start = first word - lead), contiguous, no gaps.
Claude then rewrites story/shots.json: names sets, merges beats into longer camera moves, splits action beats,
adds footnotes, transitions, sfx/amb cues and the music plan.
"""
import argparse, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import load_json, save_json, ts

ap = argparse.ArgumentParser()
ap.add_argument("--project", required=True)
ap.add_argument("--target", type=float, default=None); ap.add_argument("--max", type=float, default=None); ap.add_argument("--min", type=float, default=None)
ap.add_argument("--lead", type=float, default=0.12); ap.add_argument("--tail", type=float, default=1.6); ap.add_argument("--force", action="store_true")
a = ap.parse_args()
cfg = load_json(os.path.join(a.project, "config.json")); short = cfg.get("format") == "short"
a.max = a.max or (4.5 if short else 7.0); a.min = a.min or (1.1 if short else 1.6)
words = load_json(os.path.join(a.project, "timeline", "words.json"))["words"]
total = max(cfg.get("duration") or 0, words[-1]["end"]); end_all = max(total, words[-1]["end"] + a.tail)
phr, cur = [], []
for i, w in enumerate(words):
    cur.append(w); nxt = words[i + 1] if i + 1 < len(words) else None
    gap = nxt["start"] - w["end"] if nxt else 9
    if re.search(r"[.?!…:;]['\"”’)]*$", w["word"]) or gap > 0.7 or not nxt: phr.append(cur); cur = []
dur = lambda p: p[-1]["end"] - p[0]["start"]
out = []
for p in phr:
    stack = [p]
    while stack:
        q = stack.pop(0)
        if dur(q) <= a.max or len(q) < 4: out.append(q); continue
        cands = [k for k in range(2, len(q) - 1) if re.search(r"[,–—]$", q[k - 1]["word"]) or q[k]["word"].lower() in ("and", "but", "then", "so", "because", "while", "when", "until", "which", "who")]
        mid = q[0]["start"] + dur(q) / 2
        k = min(cands, key=lambda k: abs(q[k]["start"] - mid)) if cands else min(range(2, len(q) - 1), key=lambda k: abs(q[k]["start"] - mid))
        stack[:0] = [q[:k], q[k:]]
beats = []
for p in out:
    if beats and dur(p) < a.min and dur(beats[-1]) + dur(p) < a.max: beats[-1] = beats[-1] + p
    else: beats.append(p)
B = []
for i, p in enumerate(beats):
    start = 0.0 if i == 0 else max(0.0, p[0]["start"] - a.lead)
    B.append({"i": i, "start": round(start, 3), "speechStart": p[0]["start"], "speechEnd": p[-1]["end"], "text": " ".join(w["word"] for w in p)})
for i, b in enumerate(B): b["end"] = round(B[i + 1]["start"] if i + 1 < len(B) else end_all, 3)
save_json(os.path.join(a.project, "timeline", "beats.json"), B)
sp = os.path.join(a.project, "story", "shots.json")
if os.path.exists(sp) and not a.force: print(f"{sp} exists — not overwritten (use --force)")
else:
    shots = [{"id": f"s{i + 1:03d}", "start": b["start"], "end": b["end"], "line": b["text"], "set": None, "scene": "TODO", "footnote": "", "in": {"type": "cut"}, "sfx": [], "notes": ""} for i, b in enumerate(B)]
    save_json(sp, {"title": cfg.get("title"), "duration": round(end_all, 3), "shots": shots, "music": []})
    print(f"wrote draft {sp}")
ds = [b["end"] - b["start"] for b in B]
print(f"{len(B)} beats | avg {sum(ds) / len(ds):.2f}s  min {min(ds):.2f}s  max {max(ds):.2f}s | video {ts(end_all)}")
for b in B[:10]: print(f"  [{ts(b['start'])}-{ts(b['end'])}] {b['text'][:90]}")
