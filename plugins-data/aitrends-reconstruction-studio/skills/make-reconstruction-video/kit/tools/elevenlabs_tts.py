#!/usr/bin/env python3
"""tools/elevenlabs_tts.py — narration with the ElevenLabs API (adapted from Atlas Explainer Studio).

Setup once per computer (the key never goes into the project folder, scene files, logs or chat):
    python tools/elevenlabs_tts.py setup --ask                                  (hidden prompt, run it yourself in a terminal)
    python tools/elevenlabs_tts.py setup --key-file ~/el_key.txt --remove-file   (reads the key from a file, then deletes it)
    python tools/elevenlabs_tts.py setup --voice "<voice name or ID>"  [--model eleven_multilingual_v2]
      -> ~/.reconstruction_studio/elevenlabs.json   (env vars ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID take precedence)
Other commands:
    python tools/elevenlabs_tts.py status | voices | models
    python tools/elevenlabs_tts.py sample --project projects/X [--chars 400]          -> audio/sample.wav (approved script only)
    python tools/elevenlabs_tts.py sample --project projects/X --text "neutral test sentence"   (voice test before approval)
    python tools/elevenlabs_tts.py speak  --project projects/X [--stability .45 --similarity .8 --style .2 --speed 1.0]
`speak` reads script/script_final.txt (approved wording) or script/synthesis.txt (same words with phonetic respellings),
splits at paragraph/sentence boundaries, stitches requests for continuous delivery and writes audio/voiceover_raw.wav
(48 kHz). Pauses are NOT touched here: tools/pauses.py runs next (after asking the user), then tools/transcribe.py.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

import requests

API = "https://api.elevenlabs.io"
CFG = os.path.join(os.path.expanduser("~"), ".reconstruction_studio", "elevenlabs.json")
DEFAULT_SETTINGS = {"stability": 0.45, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True, "speed": 1.0}


# ----------------------------------------------------------------------------- config
def load_cfg():
    cfg = {}
    if os.path.exists(CFG):
        cfg = json.load(open(CFG, encoding="utf-8"))
    if os.environ.get("ELEVENLABS_API_KEY"):
        cfg["api_key"] = os.environ["ELEVENLABS_API_KEY"]
    if os.environ.get("ELEVENLABS_VOICE_ID"):
        cfg["voice_id"] = os.environ["ELEVENLABS_VOICE_ID"]
    return cfg


def save_cfg(cfg):
    os.makedirs(os.path.dirname(CFG), exist_ok=True)
    with open(CFG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)
    try:
        os.chmod(CFG, 0o600)
    except OSError:
        pass


def masked(k):
    return (k[:4] + "…" + k[-4:]) if k and len(k) > 10 else "(none)"


def session(cfg):
    if not cfg.get("api_key"):
        sys.exit("No ElevenLabs API key. Run: elevenlabs_tts.py setup --ask  (hidden prompt), or setup --key-file FILE --remove-file, or set ELEVENLABS_API_KEY")
    s = requests.Session()
    s.headers.update({"xi-api-key": cfg["api_key"], "Content-Type": "application/json", "User-Agent": "ReconstructionStudio/0.1"})
    return s


def call(s, method, path, **kw):
    for attempt in range(5):
        r = s.request(method, API + path, timeout=kw.pop("timeout", 180), **kw)
        if r.status_code == 429 or r.status_code >= 500:
            wait = float(r.headers.get("Retry-After", 2 * (attempt + 1) ** 2))
            print(f"  ElevenLabs {r.status_code}; retrying in {wait:.0f}s", file=sys.stderr)
            time.sleep(min(wait, 60))
            continue
        if r.status_code == 401:
            sys.exit("ElevenLabs rejected the API key (401). Re-enter it with `setup --ask` or `setup --key-file FILE --remove-file`.")
        if r.status_code >= 400:
            sys.exit(f"ElevenLabs error {r.status_code}: {r.text[:500]}")
        return r
    sys.exit("ElevenLabs kept failing after retries")


def list_voices(s):
    out, token = [], None
    while True:
        params = {"page_size": 100}
        if token:
            params["next_page_token"] = token
        r = s.get(API + "/v2/voices", params=params, timeout=60)
        if r.status_code == 404:  # older API surface
            r = call(s, "GET", "/v1/voices")
            return r.json().get("voices", [])
        if r.status_code >= 400:
            r = call(s, "GET", "/v1/voices")
            return r.json().get("voices", [])
        j = r.json()
        out += j.get("voices", [])
        token = j.get("next_page_token")
        if not j.get("has_more") or not token:
            return out


def resolve_voice(s, want):
    if not want:
        return None, None
    voices = list_voices(s)
    for v in voices:
        if v["voice_id"] == want:
            return v["voice_id"], v.get("name")
    hits = [v for v in voices if v.get("name", "").lower() == want.lower()] or \
           [v for v in voices if want.lower() in v.get("name", "").lower()]
    if len(hits) == 1:
        return hits[0]["voice_id"], hits[0]["name"]
    if not hits:
        sys.exit(f"No voice named '{want}' on this account. Run `voices` to see them (a voice from the Voice Library must be added to the account first).")
    sys.exit("Several voices match: " + ", ".join(f"{v['name']} ({v['voice_id']})" for v in hits))


# ----------------------------------------------------------------------------- text
def split_chunks(text, max_chars):
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, cur = [], ""
    for p in paras:
        sentences = re.split(r"(?<=[.!?])\s+", p)
        for snt in sentences:
            add = (snt if not cur else (" " if not cur.endswith("\n") else "") + snt)
            if len(cur) + len(add) > max_chars and cur:
                chunks.append(cur.strip())
                cur = snt
            else:
                cur += add
        cur += "\n\n"
    if cur.strip():
        chunks.append(cur.strip())
    return chunks


def words_from_alignment(al, offset, display_text=None):
    """Group character timings into words. Uses the original-text alignment."""
    chars = al["characters"]
    st = al["character_start_times_seconds"]
    en = al["character_end_times_seconds"]
    words, cur, t0, t1 = [], "", None, None
    for c, a, b in zip(chars, st, en):
        if c.isspace():
            if cur:
                words.append((cur, t0, t1))
            cur, t0 = "", None
            continue
        if t0 is None:
            t0 = a
        cur += c
        t1 = b
    if cur:
        words.append((cur, t0, t1))
    return [{"text": w, "start": round(a + offset, 3), "end": round(b + offset, 3)} for w, a, b in words]


def ffprobe_duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ----------------------------------------------------------------------------- synthesis
def synth(s, cfg, text, prev_ids, prev_text, next_text, fmt, settings, seed):
    body = {"text": text, "model_id": cfg.get("model_id", "eleven_multilingual_v2"), "voice_settings": settings}
    if prev_ids:
        body["previous_request_ids"] = prev_ids[-3:]
    elif prev_text:
        body["previous_text"] = prev_text[-600:]
    if next_text:
        body["next_text"] = next_text[:600]
    if seed is not None:
        body["seed"] = seed
    r = call(s, "POST", f"/v1/text-to-speech/{cfg['voice_id']}/with-timestamps", params={"output_format": fmt}, json=body)
    j = r.json()
    return base64.b64decode(j["audio_base64"]), j.get("alignment") or j.get("normalized_alignment"), r.headers.get("request-id")


def cmd_speak(a, cfg, sample=False):
    s = session(cfg)
    if not cfg.get("voice_id"):
        sys.exit("No voice chosen. Run: elevenlabs_tts.py setup --voice \"<name or id>\"")
    if sample and getattr(a, "text", None):
        text = synth_text = a.text.strip()
    else:
        text = open(a.script, encoding="utf-8").read().strip()
        synth_text = open(a.synthesis_text, encoding="utf-8").read().strip() if a.synthesis_text else text
    if sample:
        cut = synth_text[:a.chars]
        cut = cut[:max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! ")) + 1] or cut
        chunks = [cut]
    else:
        chunks = split_chunks(synth_text, a.max_chars)
    settings = dict(DEFAULT_SETTINGS)
    settings.update(cfg.get("voice_settings", {}))
    for k, v in (("stability", a.stability), ("similarity_boost", a.similarity), ("style", a.style), ("speed", a.speed)):
        if v is not None:
            settings[k] = v
    fmt = a.format
    tmp = tempfile.mkdtemp()
    parts, aligns, ids, all_words = [], [], [], []
    offset = 0.0
    for i, ch in enumerate(chunks):
        print(f"chunk {i + 1}/{len(chunks)}: {len(ch)} chars")
        audio, al, rid = synth(s, cfg, ch, ids, chunks[i - 1] if i else None, chunks[i + 1] if i + 1 < len(chunks) else None,
                               fmt, settings, a.seed)
        ext = "mp3" if fmt.startswith("mp3") else ("wav" if fmt.startswith("wav") else "pcm")
        p = os.path.join(tmp, f"part{i:03d}.{ext}")
        open(p, "wb").write(audio)
        if ext == "pcm":
            rate = fmt.split("_")[1]
            wav = p[:-4] + ".wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", rate, "-ac", "1", "-i", p, wav], check=True)
            p = wav
        dur = ffprobe_duration(p)
        parts.append(p)
        if rid:
            ids.append(rid)
        if al:
            aligns.append({"chunk": i, "offset": offset, "request_id": rid, "alignment": al})
            all_words += words_from_alignment(al, offset)
        offset += dur
    # concatenate exactly (no gaps added; ElevenLabs chunks already end on sentence boundaries)
    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", a.out], check=True)
    total = ffprobe_duration(a.out)
    if sample:
        print(f"sample written: {a.out} ({total:.1f}s)")
        return
    if a.captions_dir:
        os.makedirs(a.captions_dir, exist_ok=True)
        json.dump({"voice_id": cfg["voice_id"], "model_id": cfg.get("model_id"), "chunks": aligns}, open(os.path.join(a.captions_dir, "elevenlabs_alignment.json"), "w", encoding="utf-8"))
    vs = os.path.join(os.path.dirname(os.path.abspath(a.out)), "voice_settings.md")
    with open(vs, "w", encoding="utf-8") as f:
        f.write(f"# Voice settings\n\n- engine: ElevenLabs\n- voice: {cfg.get('voice_name', '')} ({cfg['voice_id']})\n- model: {cfg.get('model_id', 'eleven_multilingual_v2')}\n"
                f"- settings: {json.dumps(settings)}\n- chunks: {len(chunks)}; characters billed (approx.): {sum(len(c) for c in chunks)}\n- raw file: {a.out} ({total:.2f} s)\n- generated: {time.strftime('%Y-%m-%d %H:%M')}\n")
    print(f"voiceover (raw): {a.out}  {total:.2f}s  — next: tools/pauses.py (ask the user first), then tools/transcribe.py")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    st = sp.add_parser("setup")
    st.add_argument("--ask", action="store_true", help="prompt for the key with hidden input (run it yourself in a terminal)")
    st.add_argument("--key-file", help="read the key from this text file (first line)")
    st.add_argument("--remove-file", action="store_true", help="delete --key-file after the key is saved")
    st.add_argument("--key-stdin", action="store_true", help="read the key from standard input")
    st.add_argument("--voice"); st.add_argument("--model")
    st.add_argument("--stability", type=float); st.add_argument("--similarity", type=float); st.add_argument("--style", type=float); st.add_argument("--speed", type=float)
    sp.add_parser("voices"); sp.add_parser("models"); sp.add_parser("status")
    for name in ("speak", "sample"):
        p = sp.add_parser(name)
        p.add_argument("--project"); p.add_argument("script", nargs="?"); p.add_argument("-o", "--out")
        p.add_argument("--synthesis-text", help="same words with phonetic respellings, used only for synthesis")
        p.add_argument("--captions-dir", default=None); p.add_argument("--max-chars", type=int, default=2400)
        p.add_argument("--chars", type=int, default=400, help="sample length")
        p.add_argument("--text", help="sample only: neutral test text instead of the script (allowed before the script is approved)")
        p.add_argument("--format", default="mp3_44100_128", help="mp3_44100_128 (all plans), mp3_44100_192 (Creator+), pcm_44100 (Pro+)")
        p.add_argument("--stability", type=float); p.add_argument("--similarity", type=float); p.add_argument("--style", type=float)
        p.add_argument("--speed", type=float); p.add_argument("--seed", type=int)
    a = ap.parse_args()
    if a.cmd in ("speak", "sample") and a.project:
        P = a.project; syn = os.path.join(P, "script", "synthesis.txt"); fin = os.path.join(P, "script", "script_final.txt")
        a.script = a.script or fin
        if not a.synthesis_text and os.path.exists(syn): a.synthesis_text = syn
        a.out = a.out or os.path.join(P, "audio", "sample.wav" if a.cmd == "sample" else "voiceover_raw.wav")
        a.captions_dir = a.captions_dir or os.path.join(P, "timeline")
    if a.cmd in ("speak", "sample") and (not a.script or not a.out) and not (a.cmd == "sample" and a.text and a.out): sys.exit("give --project projects/X (or a script path and -o OUT)")
    if a.cmd in ("speak", "sample") and a.project and not (a.cmd == "sample" and a.text):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from common import require_approval; require_approval(a.project)
    cfg = load_cfg()
    if a.cmd == "setup":
        key = None
        if a.key_file:
            with open(os.path.expanduser(a.key_file), encoding="utf-8-sig") as f:
                key = (f.readline() or "").strip()
        elif a.key_stdin:
            key = sys.stdin.readline().strip()
        elif a.ask or (not a.voice and not a.model and sys.stdin.isatty()):
            import getpass
            key = getpass.getpass("ElevenLabs API key (input hidden): ").strip()
        if key:
            k = key.strip()
            if not k.startswith("sk_"):
                sys.exit("That looks like an ElevenLabs API key ID, not the secret key. Secret keys start with 'sk_' and are shown once "
                         "when the key is created (ElevenLabs > Developers > API Keys > Create key).")
            cfg["api_key"] = k
        if a.model:
            cfg["model_id"] = a.model
        vs = cfg.setdefault("voice_settings", {})
        for k, v in (("stability", a.stability), ("similarity_boost", a.similarity), ("style", a.style), ("speed", a.speed)):
            if v is not None:
                vs[k] = v
        if a.voice:
            vid, vname = resolve_voice(session(cfg), a.voice)
            cfg["voice_id"], cfg["voice_name"] = vid, vname
        save_cfg(cfg)
        if a.key_file and a.remove_file and key:
            try:
                os.remove(os.path.expanduser(a.key_file)); print(f"removed {a.key_file}")
            except OSError as e:
                print(f"could not remove {a.key_file}: {e} — delete it yourself")
        print(f"saved {CFG}: key {masked(cfg.get('api_key'))}, voice {cfg.get('voice_name')} ({cfg.get('voice_id')}), model {cfg.get('model_id', 'eleven_multilingual_v2')}")
    elif a.cmd == "status":
        print(f"config {CFG}: key {masked(cfg.get('api_key'))}, voice {cfg.get('voice_name')} ({cfg.get('voice_id')}), model {cfg.get('model_id', 'eleven_multilingual_v2')}, settings {cfg.get('voice_settings', {})}")
        if cfg.get("api_key"):
            r = call(session(cfg), "GET", "/v1/user/subscription")
            j = r.json()
            print(f"tier {j.get('tier')}, characters used {j.get('character_count')} / {j.get('character_limit')}")
    elif a.cmd == "voices":
        for v in list_voices(session(cfg)):
            print(f"{v.get('name')}\t{v['voice_id']}\t{v.get('category')}\t{(v.get('labels') or {})}")
    elif a.cmd == "models":
        for m in call(session(cfg), "GET", "/v1/models").json():
            if m.get("can_do_text_to_speech"):
                print(f"{m['model_id']}\t{m.get('name')}\tmax chars {m.get('maximum_text_length_per_request')}")
    elif a.cmd == "sample":
        cmd_speak(a, cfg, sample=True)
    else:
        cmd_speak(a, cfg)


if __name__ == "__main__":
    main()
