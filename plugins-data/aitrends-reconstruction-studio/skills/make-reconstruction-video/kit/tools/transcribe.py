"""tools/transcribe.py — word-level timestamps for the (pause-cleaned) voiceover with faster-whisper.

  python tools/transcribe.py --project projects/X [--model small] [--lang en] [--script script/script_final.txt]

Always run on audio/voiceover.wav (the master, after the pause step). If a plain-text script is given (default:
script/script_final.txt when it exists) its exact wording is kept and aligned onto Whisper's word timings, so captions
and on-screen text use the approved spelling. Writes timeline/words.json ({source, words:[{word,start,end}]}), sentences.json,
transcript.txt (approved wording with times), whisper_heard.txt (what Whisper actually heard), alignment_report.txt (every
place script and audio differ), captions.srt, and prints the match rate, pace (wpm) and the longest pauses.
--check: only report on a sample/take (writes nothing).
"""
import argparse, difflib, json, os, re, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import load_json, save_json, norm_word, sentences_from_words, write_timeline, ts


def decode16k(path):
    """ffmpeg -> float32 mono 16 kHz (avoids PyAV version problems inside faster-whisper)."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def align_script(script_text, wwords):
    toks = re.findall(r"\S+", script_text); a = [norm_word(t) for t in toks]; b = [norm_word(w["word"]) for w in wwords]
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False); times = [None] * len(toks)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size): w = wwords[blk.b + k]; times[blk.a + k] = (w["start"], w["end"])
    n, i = len(toks), 0
    while i < n:
        if times[i] is not None: i += 1; continue
        j = i
        while j < n and times[j] is None: j += 1
        t0 = times[i - 1][1] if i > 0 else (wwords[0]["start"] if wwords else 0.0)
        t1 = times[j][0] if j < n else (wwords[-1]["end"] if wwords else t0 + 0.4 * (j - i))
        span = max(0.05, t1 - t0) / (j - i)
        for k in range(i, j): times[k] = (t0 + span * (k - i), t0 + span * (k - i + 1))
        i = j
    matched = sum(b.size for b in sm.get_matching_blocks())
    return [{"word": t, "start": round(s, 3), "end": round(e, 3)} for t, (s, e) in zip(toks, times)], matched / max(1, len(toks))


def clean_script(txt):
    txt = re.sub(r"^\s*#.*$", "", txt, flags=re.M)                 # markdown headings
    txt = re.sub(r"\[(?:[^\]]*)\]", "", txt)                        # [visual notes] / [mm:ss]
    txt = re.sub(r"^\s*(VO|NARRATOR)\s*:\s*", "", txt, flags=re.M | re.I)
    return txt


def srt(words, path, max_words=8):
    def stamp(t): h, r = divmod(t, 3600); m, s = divmod(r, 60); return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)):03d}"
    out, cur, k = [], [], 1
    for i, w in enumerate(words):
        cur.append(w); nxt = words[i + 1] if i + 1 < len(words) else None
        if len(cur) >= max_words or re.search(r"[.!?]$", w["word"]) or not nxt or nxt["start"] - w["end"] > 0.6:
            out.append(f"{k}\n{stamp(cur[0]['start'])} --> {stamp(cur[-1]['end'])}\n{' '.join(x['word'] for x in cur)}\n"); k += 1; cur = []
    open(path, "w", encoding="utf-8").write("\n".join(out))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--project", required=True); ap.add_argument("--audio")
    ap.add_argument("--model", default="small", help="tiny|base|small|medium|large-v3"); ap.add_argument("--lang", default="en"); ap.add_argument("--script")
    ap.add_argument("--check", action="store_true", help="only check a sample/take: print what Whisper heard and how much of it matches the script; writes nothing")
    a = ap.parse_args(); P = a.project; cfg = load_json(os.path.join(P, "config.json"))
    audio = a.audio or os.path.join(P, cfg.get("voiceover") or "audio/voiceover.wav")
    if not os.path.exists(audio): sys.exit(f"no voiceover at {audio} (run tools/pauses.py --apply or --skip first)")
    from faster_whisper import WhisperModel
    device = "cpu"
    try:
        import ctranslate2; device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception: pass
    name = a.model + (".en" if a.lang == "en" and a.model in ("tiny", "base", "small", "medium") else "")
    print(f"loading whisper '{name}' on {device} (first run downloads the model)…")
    model = WhisperModel(name, device=device, compute_type="float16" if device == "cuda" else "int8")
    segs, info = model.transcribe(decode16k(audio), language=a.lang, word_timestamps=True, vad_filter=False, beam_size=5, condition_on_previous_text=False)
    words = []
    for s in segs:
        for w in s.words or []: words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
        print(f"  {ts(s.start)}  {s.text.strip()[:96]}")
    if not words: sys.exit("no speech found")
    if a.check:
        heard = [norm_word(w["word"]) for w in words]
        scr = a.script or os.path.join(P, "script", "synthesis.txt")
        if not os.path.exists(scr): scr = os.path.join(P, "script", "script_final.txt")
        if os.path.exists(scr):
            toks = [norm_word(t) for t in re.findall(r"\S+", clean_script(open(scr, encoding="utf-8").read()))]
            sm = difflib.SequenceMatcher(a=heard, b=toks, autojunk=False)
            got = sum(b.size for b in sm.get_matching_blocks())
            print(f"check: {got}/{len(heard)} heard words match the script in order ({got / max(1, len(heard)) * 100:.0f}%)")
            ok_i = {blk.a + k for blk in sm.get_matching_blocks() for k in range(blk.size)}
            miss = [w["word"] for i, w in enumerate(words) if i not in ok_i]
            if miss: print("check: heard differently from the script: " + ", ".join(miss[:30]))
        span = (words[-1]["end"] - words[0]["start"]) / 60
        print(f"check: {len(words)} words, {len(words) / max(1e-6, span):.0f} wpm — nothing written")
        return
    source = f"whisper:{name}"
    heard_words = list(words)
    if not a.check:
        for f in (os.path.join(P, "audio", "voiceover_raw.wav"),):
            if a.audio is None and os.path.exists(f) and os.path.getmtime(f) > os.path.getmtime(audio) + 1:
                sys.exit("STOP: audio/voiceover_raw.wav is newer than audio/voiceover.wav — run tools/pauses.py (--apply or --skip) for the new take first")
    script = a.script or (os.path.join(P, "script", "script_final.txt") if os.path.exists(os.path.join(P, "script", "script_final.txt")) else None)
    if script and os.path.exists(script):
        aligned, rate = align_script(clean_script(open(script, encoding="utf-8").read()), words)
        print(f"script alignment: {rate * 100:.0f}% of script words matched the audio")
        if rate < 0.9: print("WARNING: below 90% — the narration and the script differ (ad-libs, skipped lines, or the wrong script). Check before building shots.")
        words = aligned; source += "+script"
    tl = os.path.join(P, "timeline"); write_timeline(tl, words, sentences_from_words(words), source); srt(words, os.path.join(tl, "captions.srt"))
    # what Whisper itself heard (transcript.txt carries the approved script wording) + where script and audio differ
    with open(os.path.join(tl, "whisper_heard.txt"), "w", encoding="utf-8") as f:
        for snt in sentences_from_words(heard_words): f.write(f"[{ts(snt['start'])} -> {ts(snt['end'])}] {snt['text']}\n")
    if source.endswith("+script"):
        A = [norm_word(w["word"]) for w in words]; B = [norm_word(w["word"]) for w in heard_words]
        rep = []
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=A, b=B, autojunk=False).get_opcodes():
            if op == "equal": continue
            t = heard_words[j1]["start"] if j1 < len(heard_words) else (words[i1]["start"] if i1 < len(words) else 0)
            rep.append(f"{ts(t)}  {op:8s} script: {' '.join(w['word'] for w in words[i1:i2])[:120] or '—'}  |  heard: {' '.join(w['word'] for w in heard_words[j1:j2])[:120] or '—'}")
        with open(os.path.join(tl, "alignment_report.txt"), "w", encoding="utf-8") as f: f.write("\n".join(rep) + ("\n" if rep else "script and audio match word for word\n"))
        big = [r for r in rep if len(r.split("script:")[1].split("|")[0].split()) >= 4 or len(r.split("heard:")[1].split()) >= 4]
        print(f"differences script vs audio: {len(rep)} (see timeline/alignment_report.txt){'; larger ones: ' + str(len(big)) if big else ''}")
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", audio], capture_output=True, text=True).stdout.strip())
    gaps = sorted(((b["start"] - w["end"], w["end"]) for w, b in zip(words, words[1:])), reverse=True)[:5]
    wpm = len(words) / max(1e-6, (words[-1]["end"] - words[0]["start"]) / 60)
    cfg["duration"] = round(dur, 3); save_json(os.path.join(P, "config.json"), cfg)
    print(f"{len(words)} words | {wpm:.0f} wpm | audio {dur:.1f}s, last word ends {words[-1]['end']:.1f}s | longest gaps: " + ", ".join(f"{g:.2f}s@{ts(t)}" for g, t in gaps))


if __name__ == "__main__":
    main()
