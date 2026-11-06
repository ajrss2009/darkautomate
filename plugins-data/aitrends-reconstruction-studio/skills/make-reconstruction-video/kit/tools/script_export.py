"""tools/script_export.py — turn the approved readable script into the spoken-words file (and record the approval).

  python tools/script_export.py --project projects/X --from script/script_v03.md [--approved "user's words"]

Writes script/script_final.txt (spoken words only: no headings, no [visual notes], no speaker tags) and, with --approved,
script/SCRIPT_APPROVAL.md with the version, time, the user's words and the sha256 of script_final.txt.
script/synthesis.txt (the text the voice engine reads, for pronunciation respellings) is rewritten from the final text whenever
the final text changes (the old one is kept as synthesis_prev_*.txt); script/synthesis.base records which version it came from.
"""
import argparse, hashlib, os, re, time

ap = argparse.ArgumentParser(); ap.add_argument("--project", required=True); ap.add_argument("--from", dest="src", required=True); ap.add_argument("--approved")
a = ap.parse_args(); P = a.project
src = a.src if os.path.isabs(a.src) or os.path.exists(a.src) else os.path.join(P, a.src)
txt = open(src, encoding="utf-8").read()
txt = re.sub(r"^\s*#.*$", "", txt, flags=re.M)
txt = re.sub(r"^\s*\[[^\]]*\]\s*$", "", txt, flags=re.M)        # note lines
txt = re.sub(r"\[[^\]]*\]", "", txt)                             # inline notes
txt = re.sub(r"^\s*(VO|NARRATOR)\s*:\s*", "", txt, flags=re.M | re.I)
paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", txt)]
final = "\n\n".join(p for p in paras if p) + "\n"
out = os.path.join(P, "script", "script_final.txt"); open(out, "w", encoding="utf-8").write(final)
h = hashlib.sha256(final.encode("utf-8")).hexdigest(); n = len(final.split())
syn = os.path.join(P, "script", "synthesis.txt"); base = os.path.join(P, "script", "synthesis.base")
prev = open(base).read().strip() if os.path.exists(base) else None
if not os.path.exists(syn) or prev != h:
    if os.path.exists(syn) and prev != h:
        bak = os.path.join(P, "script", f"synthesis_prev_{(prev or 'old')[:8]}.txt"); os.replace(syn, bak)
        print(f"script changed -> fresh synthesis.txt; the previous one (with its respellings) is kept as {bak} — re-apply the respellings")
    open(syn, "w", encoding="utf-8").write(final); open(base, "w").write(h + "\n")
print(f"wrote {out}: {n} words, ~{n / 150:.1f} min at 150 wpm, sha256 {h[:12]}…")
if a.approved:
    with open(os.path.join(P, "script", "SCRIPT_APPROVAL.md"), "w", encoding="utf-8") as f:
        f.write(f"# Script approval\n\n- version: {os.path.basename(src)}\n- approved: {time.strftime('%Y-%m-%d %H:%M')}\n- user said: \"{a.approved}\"\n- script_final.txt sha256: {h}\n- words: {n}\n")
    print("approval recorded in script/SCRIPT_APPROVAL.md")
