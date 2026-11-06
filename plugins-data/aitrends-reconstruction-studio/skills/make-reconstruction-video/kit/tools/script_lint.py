"""tools/script_lint.py — check a narration script against the reconstruction-documentary house style.

  python tools/script_lint.py script/script_v01.md [--format long|short] [--wpm 150]

Reports length/runtime, sentence rhythm, attribution density, stated unknowns, signature devices, and flags hype words,
AI-sounding phrasing and unsourced claims. FAIL items must be fixed before the script goes to the user for approval.
"""
import argparse, re, statistics as st, sys

HYPE = r"\b(shocking|terrifying|horrifying|chilling|insane|unbelievable|mind-?blowing|jaw-?dropping|you won'?t believe|stunning|explosive|bombshell|nightmare|tragic(ally)?|devastating(ly)?|heart-?breaking|gruesome|brutal(ly)?|epic)\b"
AIISMS = r"\b(delve|tapestry|testament to|in the realm of|navigat(e|ing) the|ever-?evolving|unravel(s|ed|ing)?|a stark reminder|serves as a reminder|it'?s worth noting|it is important to note|in today'?s world|buckle up|let'?s dive in|game-?changer|nestled|intricate|pivotal|underscores?|showcas(e|es|ing))\b"
ATTR = r"\b(says|said|told|tells|according to|reports?|reported|writes|wrote|describes|recalls|remembers|calls it|called it|by (his|her|their) (own )?account|citing|confirmed|announced|statement)\b"
UNKNOWN = r"(has not been (made public|published|released|explained|said|named)|hasn'?t (said|been)|have not (said|given|named)|haven'?t (said|been)|not (yet )?known|no one has said|isn'?t public|unclear|not been disclosed|declined to comment|did not respond|was asked for comment|not officially)"
TIME = r"\b(\d{1,2}:\d{2}|\d{1,2} (minutes )?(past|to) \d{1,2}|a quarter (past|to)|half past|(mon|tues|wednes|thurs|fri|satur|sun)day|january|february|march|april|may|june|july|august|september|october|november|december|\d{4})\b"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("script"); ap.add_argument("--format", default="long", choices=["long", "short"]); ap.add_argument("--wpm", type=float, default=None)
    a = ap.parse_args(); raw = open(a.script, encoding="utf-8").read()
    body = re.sub(r"^\s*#.*$", "", raw, flags=re.M); body = re.sub(r"\[[^\]]*\]", "", body); body = re.sub(r"^\s*(VO|NARRATOR)\s*:\s*", "", body, flags=re.M | re.I)
    words = re.findall(r"\S+", body); n = len(words); wpm = a.wpm or (150 if a.format == "long" else 175)
    sents = [s.strip() for s in re.split(r"(?<=[.!?])[\"”’]?\s+", body) if s.strip()]; L = [len(s.split()) for s in sents]
    low = body.lower(); fails, warns, notes = [], [], []
    mins = n / wpm
    notes.append(f"{n} words -> ~{mins:.1f} min at {wpm:.0f} wpm")
    if a.format == "long" and not (1500 <= n <= 2900): warns.append(f"long-form target is 1,800-2,700 words (12-18 min); this is {n}")
    if a.format == "short" and not (140 <= n <= 290): warns.append(f"short target is 160-260 words (60-90 s); this is {n}")
    if L:
        med = st.median(L); frag = sum(1 for x in L if x <= 6) / len(L); longs = [s for s, x in zip(sents, L) if x > 32]
        notes.append(f"{len(sents)} sentences | median {med:.0f} words | fragments (<=6 words) {frag:.0%} | longest {max(L)}")
        if med > 14: fails.append(f"sentences too long (median {med:.0f}; house style median 8-12)")
        if frag < 0.15: warns.append(f"few short fragments ({frag:.0%}); the style uses 20-35% (numbers, times, 'Head, hands, neck.')")
        for s in longs[:4]: warns.append(f"over-long sentence ({len(s.split())} words): {s[:90]}…")
    hype = re.findall(HYPE, low); ai = re.findall(AIISMS, low)
    if hype: fails.append("hype words (let facts and quotes carry emotion): " + ", ".join(sorted(set(h[0] if isinstance(h, tuple) else h for h in hype))))
    if ai: fails.append("AI-sounding phrasing: " + ", ".join(sorted(set(x[0] if isinstance(x, tuple) else x for x in ai))))
    na = len(re.findall(ATTR, low)); nu = len(re.findall(UNKNOWN, low)); nt = len(re.findall(TIME, low)); nq = body.count("“") + body.count('"') // 2
    per = na / max(1, mins)
    notes.append(f"attributions {na} ({per:.1f}/min) | stated unknowns {nu} | dates/times {nt} | quote marks {nq}")
    if a.format == "long":
        if per < 1.5: fails.append(f"too few attributions ({per:.1f}/min; the house style runs ~2.5-3.5/min: 'says', 'according to', 'X reports', 'told NBC')")
        elif per < 2.3: warns.append(f"attribution a little thin ({per:.1f}/min; aim ~2.5-3.5/min) — every factual claim needs a named source")
        if nu < 3: warns.append("state what is NOT known at least 3-5 times ('Police haven't said...', '...has not been made public')")
        if "this is the story of" not in low: warns.append("missing the 'This is the story of… Of a… And…' preview after the cold open")
        if not re.search(r"(where it stands|as of (the )?\d|as of (mon|tues|wednes|thurs|fri|satur|sun)day|here is what is known)", low): warns.append("missing a dated status wrap-up ('Here is where it stands on <date>' / 'As of <date>')")
        if not re.search(r"(built on|reconstruction|we rebuilt|what follows is)", low): warns.append("missing the method line (what the film is built on / that the 3D is a reconstruction)")
    if re.search(r"\b(allegedly|reportedly)\b", low) and per < 6: warns.append("prefer naming the source over 'reportedly/allegedly'")
    if re.search(r"\b(i think|i believe|in my opinion)\b", low): fails.append("narrator opinion — the voice reports, it doesn't opine")
    if re.search(r"\b(click|smash) the like\b|\bsubscribe\b", low) and a.format == "long": warns.append("audience calls-to-action belong in one short line after the preview, not scattered")
    print("\nSCRIPT LINT —", a.script)
    for x in notes: print("  ·", x)
    for x in warns: print("  WARN", x)
    for x in fails: print("  FAIL", x)
    print(f"\n{len(fails)} FAIL, {len(warns)} WARN")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
