"""익스텐션이 오디오를 던지면 파이프라인을 돌리고 결과물을 데스크탑에서 연다.

    python server.py        # http://127.0.0.1:8787
"""
import json, subprocess, sys, threading, traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import ibis
import meetnote

PORT = 8787
OUT = Path(__file__).parent / "out"
CONF = Path(__file__).parent / ".meetnote.json"
APP = Path(__file__).parent / "meetnote.app"
DOCS = (Path(__file__).parent / "docs").resolve()
MAX_BYTES = 500 * 1024 * 1024  # 익스텐션이 보낸다고 무한정 받아주진 않는다


TEXT_EXTS = {".txt", ".md"}


def staged(path: str):
    """CORS를 열어둔 로컬 서버다. out/ 안의 실제 파일만 통과시킨다."""
    src = Path(path or ".").resolve()
    return src if OUT.resolve() in src.parents and src.is_file() else None


# 진행 상황. 패널이 1초마다 긁어간다. 프로세스 하나뿐이라 dict면 충분하다.
# ponytail: 재시작하면 날아간다. 이력이 필요하면 각 디렉터리에 job.json으로 떨구면 된다.
JOBS = {}
STAGES = [("전사", 0, 55), ("요약", 55, 78), ("회의 전개 정리", 78, 92), ("문서 만들기", 92, 100)]


def report(key, stage, frac=0.0, **extra):
    lo, hi = next((a, b) for n, a, b in STAGES if n == stage)
    JOBS.setdefault(key, {}).update(
        stage=stage, pct=int(lo + (hi - lo) * min(max(frac, 0), 1)), **extra)


def process(src: Path, target: str, board: str = ""):
    key = src.parent.name
    JOBS[key] = {"stage": "전사", "pct": 0, "target": target, "done": False, "error": ""}
    try:
        if src.suffix.lower() in TEXT_EXTS:
            # 이미 전사된 회의록. 전사 단계를 건너뛴다.
            text = src.read_text(errors="replace")
            report(key, "전사", 1)
        else:
            print(f"[{key}] 전사 중...", flush=True)
            text = meetnote.transcribe(src, on_progress=lambda f: report(key, "전사", f))
        (src.parent / "transcript.txt").write_text(text)
        if not text.strip():
            raise ValueError("전사 결과가 비어 있습니다 (무음이거나 마이크 권한이 없었을 수 있습니다)")

        print(f"[{key}] 요약 중...", flush=True)
        report(key, "요약", 0.15)
        s = meetnote.summarize(text)
        report(key, "요약", 1, title=s.get("title", ""))

        report(key, "회의 전개 정리", 0.1)
        publish(key, src, text)

        report(key, "문서 만들기", 0.2)
        dest = meetnote.export(s, src.parent, target)
        JOBS[key].update(pct=100, stage="완료", done=True, dest=dest)
        print(f"[{key}] 완료 -> {dest}", flush=True)
        subprocess.run(["open", dest])
        if target == "figjam" and board:
            subprocess.run(["open", board])   # 붙여넣을 보드도 같이 연다
    except Exception as e:
        traceback.print_exc()
        msg = f"{type(e).__name__}: {e}"
        if "authentication" in msg.lower() or "api_key" in msg.lower():
            msg = "요약하려면 ANTHROPIC_API_KEY가 필요합니다.\n키를 넣고 서버를 다시 켜세요.\n(전사문은 이미 저장돼 있습니다)"
        JOBS.setdefault(key, {}).update(error=msg, done=True, stage="실패")
        print(f"[{key}] 실패. out/ 안의 중간 결과를 확인하세요.", flush=True)


def publish(key: str, src: Path, text: str):
    """뷰어(docs/)에 이 회의를 올린다. 전사문에 시각이 없으면 건너뛴다."""
    if len(ibis.parse(text)) < 5:
        print(f"[{key}] 전개 정리 건너뜀 — 전사문에 ‘이름 00:00’ 시각이 없습니다", flush=True)
        return
    audio = ""
    if src.suffix.lower() not in TEXT_EXTS:      # 뷰어가 스트리밍할 수 있는 크기로
        dst = DOCS / "audio" / f"{key}.m4a"
        dst.parent.mkdir(parents=True, exist_ok=True)
        r = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src),
                            "-c:a", "aac", "-b:a", "32k", "-ac", "1", "-ar", "22050",
                            "-movflags", "+faststart", str(dst)])
        audio = f"audio/{key}.m4a" if r.returncode == 0 else ""
    out, warn = ibis.write(text, DOCS / "data", key,
                           date=datetime.now().strftime("%Y.%m.%d"), audio=audio)
    for w in warn:
        print(f"[{key}] ! {w}", flush=True)
    print(f"[{key}] 전개 정리 -> {out}", flush=True)


def records(limit=12):
    """지난 회의들. 전사문·요약이 남아 있는 디렉터리만 보여준다."""
    out = []
    for d in sorted((p for p in OUT.glob("*") if p.is_dir()), key=lambda p: p.name, reverse=True):
        js = d / "summary.json"
        title = ""
        if js.exists():
            try:
                title = json.loads(js.read_text()).get("title", "")
            except Exception:
                pass
        out.append({
            "key": d.name,
            "dir": str(d),
            "title": title or (JOBS.get(d.name, {}).get("title") or "제목 없음"),
            "files": sorted(f.name for f in d.iterdir() if f.is_file()),
        })
        if len(out) >= limit:
            break
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # 오디오 스트리밍(Range)에는 keep-alive가 필요하다

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
        if path == "/jobs":
            return self._json(200, JOBS)
        if path == "/records":
            return self._json(200, {"records": records()})
        if path == "/conf":
            return self._json(200, json.loads(CONF.read_text()) if CONF.exists() else {})
        if path == "/" or path.startswith("/notes"):
            return self.serve_docs(path)
        if path == "/panel":  # 네이티브 고정 패널(pin)이 띄우는 UI
            raw = (Path(__file__).parent / "panel.html").read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            return self.wfile.write(raw)
        self._json(404, {"error": "?"})

    MIME = {".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
            ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".js": "text/javascript", ".css": "text/css"}

    def serve_docs(self, path):
        """docs/ 를 그대로 서빙한다. 오디오 탐색을 위해 Range만 최소로 받아준다."""
        rel = path[len("/notes"):] if path.startswith("/notes") else path
        f = (DOCS / rel.lstrip("/")).resolve()
        if f.is_dir():
            f = f / "index.html"
        if DOCS not in f.parents or not f.is_file():
            return self._json(404, {"error": "없는 파일"})
        size = f.stat().st_size
        start, end = 0, size - 1
        rng = self.headers.get("Range", "")
        if rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            start = int(a or 0)
            end = int(b) if b else size - 1
            end = min(end, size - 1)
        partial = rng.startswith("bytes=")
        self.send_response(206 if partial else 200)
        self._cors()
        self.send_header("Content-Type", self.MIME.get(f.suffix, "application/octet-stream"))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with f.open("rb") as fh:
            fh.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = fh.read(min(1 << 16, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/show":     # 크롬 확장 툴바 아이콘이 부른다
            up = subprocess.run(["pgrep", "-x", "pin"], capture_output=True).returncode == 0
            if not up:
                subprocess.Popen(["open", "-n", str(APP)])
            return self._json(200, {"ok": True, "already": up})
        if u.path == "/notes":    # 패널의 "회의록 열기" — 브라우저로 연다
            subprocess.run(["open", f"http://127.0.0.1:{PORT}/notes/"])
            return self._json(200, {"ok": True})
        if u.path == "/local":
            return self.do_LOCAL()
        if u.path == "/conf":     # 마지막에 쓴 FigJam 보드 URL 같은 것
            size = int(self.headers.get("Content-Length") or 0)
            CONF.write_text(json.dumps(json.loads(self.rfile.read(size) or b"{}"),
                                       ensure_ascii=False))
            return self._json(200, {"ok": True})
        if u.path == "/open":     # 기록에서 파일 열기
            size = int(self.headers.get("Content-Length") or 0)
            src = staged(json.loads(self.rfile.read(size) or b"{}").get("path", ""))
            if not src:
                return self._json(400, {"error": "out/ 안의 파일만 엽니다"})
            subprocess.run(["open", str(src)])
            return self._json(200, {"ok": True})
        if u.path != "/upload":
            return self._json(404, {"error": "/upload, /local 만 받습니다"})
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
        threading.Thread(target=process, args=(src, target,
                                               (q.get("board") or [""])[0]), daemon=True).start()
        self._json(202, {"ok": True, "dir": str(d), "key": d.name})

    def do_LOCAL(self):
        """고정 패널이 이미 out/ 안에 넣어둔 파일을 경로로만 넘긴다. 녹음 파일을 두 번 나르지 않는다."""
        size = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(size) or b"{}")
        target = body.get("target", "figjam")
        board = body.get("board", "")
        if target not in ("figjam", "word", "ppt"):
            return self._json(400, {"error": f"모르는 target: {target}"})
        src = staged(body.get("path", ""))
        if not src:
            return self._json(400, {"error": "out/ 안의 파일만 받습니다"})
        print(f"수신(로컬): {src.name} ({src.stat().st_size/1e6:.1f}MB) -> {target}", flush=True)
        threading.Thread(target=process, args=(src, target, board), daemon=True).start()
        self._json(202, {"ok": True, "dir": str(src.parent), "key": src.parent.name})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    import os
    if not os.getenv("ANTHROPIC_API_KEY"):
        # 전사는 온디바이스라 키가 필요 없다. 요약만 막힌다.
        print("경고: ANTHROPIC_API_KEY 가 없습니다. 전사까지는 되고 요약에서 멈춥니다.", file=sys.stderr)
    print(f"meetnote 서버: http://127.0.0.1:{PORT}  (Ctrl+C 종료)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
