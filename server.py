"""익스텐션이 오디오를 던지면 파이프라인을 돌리고 결과물을 데스크탑에서 연다.

    python server.py        # http://127.0.0.1:8787
"""
import json, subprocess, sys, threading, traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import meetnote

PORT = 8787
OUT = Path(__file__).parent / "out"
MAX_BYTES = 500 * 1024 * 1024  # 익스텐션이 보낸다고 무한정 받아주진 않는다


TEXT_EXTS = {".txt", ".md"}


def process(src: Path, target: str):
    try:
        if src.suffix.lower() in TEXT_EXTS:
            # 이미 전사된 회의록. 전사 단계를 건너뛴다.
            text = src.read_text(errors="replace")
            print(f"[{src.parent.name}] 전사문 {len(text)}자 수신", flush=True)
        else:
            print(f"[{src.parent.name}] 전사 중...", flush=True)
            text = meetnote.transcribe(src)
        (src.parent / "transcript.txt").write_text(text)
        if not text.strip():
            raise ValueError("전사 결과가 비어 있습니다")
        print(f"[{src.parent.name}] 요약 중...", flush=True)
        s = meetnote.summarize(text)
        dest = meetnote.export(s, src.parent, target)
        print(f"[{src.parent.name}] 완료 -> {dest}", flush=True)
        subprocess.run(["open", dest])
    except Exception:
        traceback.print_exc()
        print(f"[{src.parent.name}] 실패. out/ 안의 중간 결과를 확인하세요.", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, body):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self._json(200, {"ok": True})
        if path == "/panel":  # 네이티브 고정 패널(pin)이 띄우는 UI
            raw = (Path(__file__).parent / "panel.html").read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            return self.wfile.write(raw)
        self._json(404, {"error": "?"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/upload":
            return self._json(404, {"error": "/upload 만 받습니다"})
        q = parse_qs(u.query)
        target = (q.get("target") or ["figjam"])[0]
        if target not in ("figjam", "word", "ppt"):
            return self._json(400, {"error": f"모르는 target: {target}"})
        ext = (q.get("ext") or ["webm"])[0].lower()
        if not ext.isalnum() or len(ext) > 5:
            return self._json(400, {"error": "이상한 확장자"})

        size = int(self.headers.get("Content-Length") or 0)
        if not size:
            return self._json(400, {"error": "빈 요청"})
        if size > MAX_BYTES:
            return self._json(413, {"error": f"파일이 너무 큼 ({size/1e6:.0f}MB)"})

        d = OUT / datetime.now().strftime("%Y%m%d-%H%M%S")
        d.mkdir(parents=True, exist_ok=True)
        src = d / f"input.{ext}"
        src.write_bytes(self.rfile.read(size))
        print(f"수신: {src.name} ({size/1e6:.1f}MB) -> {target}", flush=True)

        # 전사+요약은 몇 분 걸린다. 익스텐션을 붙잡아두지 않고 백그라운드로 넘긴다.
        threading.Thread(target=process, args=(src, target), daemon=True).start()
        self._json(202, {"ok": True, "dir": str(d)})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
        import os
        if not os.getenv(key):
            print(f"경고: {key} 가 없습니다. 전사/요약 단계에서 실패합니다.", file=sys.stderr)
    print(f"meetnote 서버: http://127.0.0.1:{PORT}  (Ctrl+C 종료)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
