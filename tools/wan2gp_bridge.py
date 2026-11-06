#!/usr/bin/env python3
"""Ponte FilmForge <-> Wan2GP (API Python `shared.api`).

Executar com o Python do ambiente do Wan2GP, com cwd = pasta do Wan2GP:
    python wan2gp_bridge.py --root C:\\Wan2GP [--cli-arg ...]

Protocolo: uma requisição JSON por linha em stdin; respostas em stdout, linhas "@@FORGE@@ {json}".
Operações: {"id","op":"generate","model_type","settings",["output_dir"]} | {"op":"models"} | {"op":"defaults","model_type"} | {"op":"cancel"} | {"op":"quit"}
O modelo permanece carregado entre requisições (processo persistente).
"""
import argparse, json, os, queue, sys, threading, time, traceback
from pathlib import Path

TAG = "@@FORGE@@ "
def reply(obj):
    sys.stdout.write(TAG + json.dumps(obj, default=str, ensure_ascii=False) + "\n"); sys.stdout.flush()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--cli-arg", action="append", default=[])
    a = ap.parse_args()
    root = Path(a.root).resolve()
    sys.path.insert(0, str(root)); os.chdir(root)
    try:
        from shared.api import init
        out_dir = root / "outputs"
        session = init(root=root, output_dir=out_dir, cli_args=a.cli_arg, console_output=False)
    except Exception as e:
        reply({"id": None, "ready": False, "error": f"falha ao iniciar Wan2GP em {root}: {e}"}); return 2
    reply({"id": None, "ready": True})

    inbox: "queue.Queue[dict]" = queue.Queue()
    cancel = threading.Event()
    def reader():
        for line in sys.stdin:
            line = line.strip()
            if not line: continue
            try: msg = json.loads(line)
            except Exception: continue
            if msg.get("op") == "cancel": cancel.set()
            else: inbox.put(msg)
        inbox.put({"op": "quit"})
    threading.Thread(target=reader, daemon=True).start()

    while True:
        msg = inbox.get(); rid = msg.get("id"); op = msg.get("op")
        if op == "quit": return 0
        try:
            if op == "models":
                defs = session.list_model_defs()
                reply({"id": rid, "ok": True, "models": defs})
            elif op == "defaults":
                reply({"id": rid, "ok": True, "defaults": session.get_default_settings(msg["model_type"])})
            elif op == "generate":
                cancel.clear()
                mt = msg["model_type"]
                try: defaults = dict(session.get_default_settings(mt))
                except Exception: defaults = {}
                user = dict(msg.get("settings") or {})
                unknown = [k for k in user if defaults and k not in defaults]
                settings = {**defaults, **user, "model_type": mt}
                job = session.submit_task(settings)
                while True:
                    if cancel.is_set():
                        try: job.cancel()
                        except Exception: pass
                        cancel.clear()
                    try:
                        result = job.result(timeout=0.5)
                        break
                    except TimeoutError:
                        continue
                    except Exception as e:  # versões que levantam outro tipo de timeout
                        if type(e).__name__ in ("TimeoutError", "Timeout"): continue
                        raise
                files = [str(f) for f in (getattr(result, "generated_files", None) or [])]
                errs = [getattr(e, "message", str(e)) for e in (getattr(result, "errors", None) or [])]
                ok = bool(getattr(result, "success", bool(files) and not errs))
                reply({"id": rid, "ok": ok, "files": files, "errors": errs, "unknownKeys": unknown,
                       "cancelled": bool(getattr(result, "cancelled", False))})
            else:
                reply({"id": rid, "ok": False, "errors": [f"op desconhecida: {op}"]})
        except Exception as e:
            reply({"id": rid, "ok": False, "errors": [f"{type(e).__name__}: {e}"], "trace": traceback.format_exc()[-1500:]})

if __name__ == "__main__":
    sys.exit(main())
