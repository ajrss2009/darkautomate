#!/usr/bin/env python3
"""Transcreve um áudio com faster-whisper e grava palavras com tempo.
Uso: python whisper_words.py AUDIO OUT.json [--model small] [--device auto] [--language pt]
Requer: pip install faster-whisper"""
import argparse, json, sys

# PyAV 19 removeu o kwarg metadata_errors que o faster-whisper ainda passa.
# Compatibiliza antes de importar o faster_whisper.
try:
    import av as _av
    _av_open = _av.open
    def _av_open_compat(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return _av_open(*args, **kwargs)
    _av.open = _av_open_compat
except Exception:
    pass

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio"); ap.add_argument("out")
    ap.add_argument("--model", default="small"); ap.add_argument("--device", default="auto"); ap.add_argument("--language", default=None)
    a = ap.parse_args()
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        print(f"faster-whisper não instalado: {e}", file=sys.stderr); return 3
    # "auto" escolhia CUDA quando o driver existia mas sem cuBLAS (erro cublas64_12.dll);
    # CPU com int8 é estável e suficiente para narrações curtas.
    device = "cpu" if a.device in ("", "auto") else a.device
    compute = "int8" if device == "cpu" else "default"
    model = WhisperModel(a.model, device=device, compute_type=compute)
    lang = (a.language or "").split("-")[0] or None
    segs, info = model.transcribe(a.audio, word_timestamps=True, language=lang, vad_filter=True)
    words, text = [], []
    for s in segs:
        text.append(s.text.strip())
        for w in (s.words or []):
            words.append({"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
    json.dump({"language": info.language, "text": " ".join(text), "words": words, "source": "faster-whisper"}, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0

if __name__ == "__main__":
    sys.exit(main())
