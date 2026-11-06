"""tools/media_log.py — download a public image/document and log every third-party asset with its source and basis.

  python tools/media_log.py fetch --project projects/X --url "https://..." --out assets/photos/park_gate.jpg --owner "Outlet/Agency" --basis "CC BY 4.0" --credit "Photo: Name / Agency"
  python tools/media_log.py add   --project projects/X --file assets/articles/cnn_1.png --url "https://..." --owner CNN --basis "news screenshot, commentary (fair use review)" --credit "CNN"
  python tools/media_log.py list  --project projects/X        # also prints a credits block for the video description

Every real photo, screenshot, document or clip used in the video must have a row. 'basis' records why it can be used:
public domain, CC licence (+ version), government work, press/handout photo with terms, own capture, or
'news screenshot – commentary/criticism (fair use review)' for the user to judge. Nothing here is legal advice.
"""
import argparse, csv, os, sys

HDR = ["file", "source_url", "owner_or_outlet", "licence_or_basis", "credit_line", "used_in_shots", "notes"]


def log_path(P): return os.path.join(P, "research", "media_log.csv")


def append(P, row):
    p = log_path(P); new = not os.path.exists(p); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new: w.writerow(HDR)
        w.writerow([row.get(k, "") for k in HDR])


ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest="cmd", required=True)
for c in ("fetch", "add"):
    p = sp.add_parser(c); p.add_argument("--project", required=True); p.add_argument("--url", default=""); p.add_argument("--out"); p.add_argument("--file")
    p.add_argument("--owner", default=""); p.add_argument("--basis", default=""); p.add_argument("--credit", default=""); p.add_argument("--shots", default=""); p.add_argument("--notes", default="")
p = sp.add_parser("list"); p.add_argument("--project", required=True)
a = ap.parse_args()
if a.cmd == "fetch":
    import requests
    if not a.out: sys.exit("--out is required")
    dst = os.path.join(a.project, a.out); os.makedirs(os.path.dirname(dst), exist_ok=True)
    r = requests.get(a.url, timeout=60, headers={"User-Agent": "ReconstructionStudio/0.1 (research; contact via project owner)"})
    if r.status_code != 200: sys.exit(f"download failed: HTTP {r.status_code}")
    open(dst, "wb").write(r.content); print(f"saved {dst} ({len(r.content) // 1024} KB)")
    append(a.project, {"file": a.out, "source_url": a.url, "owner_or_outlet": a.owner, "licence_or_basis": a.basis, "credit_line": a.credit, "used_in_shots": a.shots, "notes": a.notes})
elif a.cmd == "add":
    append(a.project, {"file": a.file or a.out, "source_url": a.url, "owner_or_outlet": a.owner, "licence_or_basis": a.basis, "credit_line": a.credit, "used_in_shots": a.shots, "notes": a.notes}); print("logged", a.file or a.out)
else:
    p = log_path(a.project)
    if not os.path.exists(p): sys.exit("no media log yet")
    rows = list(csv.DictReader(open(p, encoding="utf-8")))
    for r in rows: print(f"- {r['file']}: {r['owner_or_outlet']} — {r['licence_or_basis']}  ({r['source_url']})")
    missing = [r["file"] for r in rows if not r["licence_or_basis"].strip()]
    if missing: print("\nWARNING: no basis recorded for: " + ", ".join(missing))
    credits = sorted({r["credit_line"] for r in rows if r["credit_line"].strip()})
    if credits: print("\nCredits for the description:\n" + "\n".join(credits))
