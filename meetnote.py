"""mp3 -> 전사 -> 위계 요약 -> FigJam 도식(mermaid). CLI 한 방."""
import argparse, json, os, subprocess, sys, tempfile
from pathlib import Path

MODEL = "claude-opus-5"

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "회의 제목"},
        "topics": {
            "type": "array",
            "description": "회의에서 다뤄진 메인 주제들. 실제 논의된 시간 순서대로.",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "주제 한 줄 (12자 내외)"},
                    "summary": {"type": "string", "description": "이 주제의 핵심 결론 1~2문장"},
                    "points": {
                        "type": "array",
                        "description": "이 주제에서 나온 개별 의견/결정/질문/할일",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "한 줄 (25자 내외)"},
                                "kind": {"type": "string", "enum": ["opinion", "decision", "question", "action"]},
                                "speaker": {"type": "string", "description": "화자, 모르면 빈 문자열"},
                            },
                            "required": ["text", "kind", "speaker"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["title", "summary", "points"],
                "additionalProperties": False,
            },
        },
        "decisions": {"type": "array", "items": {"type": "string"}, "description": "회의 전체의 확정 결정사항"},
        "action_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "task": {"type": "string"},
                    "owner": {"type": "string"},
                    "due": {"type": "string"},
                },
                "required": ["task", "owner", "due"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "topics", "decisions", "action_items"],
    "additionalProperties": False,
}

SYSTEM = """너는 회의록 편집자다. 전사문을 받아 위계와 핵심 중심으로 구조화한다.

원칙:
- 위계: 메인 주제(topics) > 그 안의 개별 발언(points). 잡담/중복/말버릇은 버린다.
- 핵심: 각 주제의 summary는 "무엇이 논의되어 어떻게 결론났는지"만 쓴다. 발언 나열 금지.
- topics는 실제 논의 흐름 순서. 주제가 되돌아왔으면 하나로 합친다.
- points의 kind는 정확히 분류한다: decision(확정), action(누가 할 일), question(미해결), opinion(그 외 주장).
- 전사문에 없는 내용은 절대 만들지 않는다. 화자를 모르면 speaker는 빈 문자열.
- 모든 출력은 한국어."""

KIND_STYLE = {  # mermaid 노드 모양 + 클래스
    "decision": ("{{", "}}", "dec"),
    "action": ("[/", "/]", "act"),
    "question": ("{", "}", "que"),
    "opinion": ("(", ")", "opi"),
}


def shrink(src: Path) -> Path:
    """Whisper 25MB 제한 대비: 16kHz 모노 32kbps로 재인코딩. 2시간 회의도 한 파일에 들어감."""
    # ponytail: 2시간 초과분은 잘림 없이 그냥 실패함. 그때 ffmpeg -f segment로 쪼개고 전사문 이어붙이면 됨.
    out = Path(tempfile.mkdtemp()) / "audio.mp3"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src),
         "-ac", "1", "-ar", "16000", "-b:a", "32k", str(out)],
        check=True,
    )
    return out


def transcribe(src: Path) -> str:
    from openai import OpenAI
    small = shrink(src)
    if small.stat().st_size > 25 * 1024 * 1024:
        sys.exit(f"오디오가 너무 김 ({small.stat().st_size/1e6:.0f}MB > 25MB). 분할 전사가 필요함.")
    with open(small, "rb") as f:
        return OpenAI().audio.transcriptions.create(model="whisper-1", file=f, language="ko").text


def summarize(transcript: str) -> dict:
    import anthropic
    with anthropic.Anthropic().messages.stream(
        model=MODEL,
        max_tokens=32000,
        system=SYSTEM,
        thinking={"type": "adaptive"},
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": f"<transcript>\n{transcript}\n</transcript>"}],
    ) as stream:
        msg = stream.get_final_message()
    return json.loads(next(b.text for b in msg.content if b.type == "text"))


def esc(s: str) -> str:
    return s.replace('"', "#quot;").replace("\n", " ").strip()


def to_mermaid(s: dict) -> str:
    """메인 주제는 세로 흐름 화살표, 개별 의견은 주제에서 갈라지는 가지."""
    lines = ["flowchart TD", f'  START(["{esc(s["title"])}"])']
    prev = "START"
    for i, t in enumerate(s["topics"]):
        tid = f"T{i}"
        lines.append(f'  {tid}["<b>{esc(t["title"])}</b><br/>{esc(t["summary"])}"]')
        lines.append(f"  {prev} ==> {tid}")
        for j, p in enumerate(t["points"]):
            o, c, cls = KIND_STYLE[p["kind"]]
            label = esc(p["text"]) + (f' <i>({esc(p["speaker"])})</i>' if p.get("speaker") else "")
            pid = f"{tid}p{j}"
            lines.append(f'  {pid}{o}"{label}"{c}:::{cls}')
            lines.append(f"  {tid} -.-> {pid}")
        prev = tid
    lines += [
        "  classDef dec fill:#d4f4dd,stroke:#2b8a3e",
        "  classDef act fill:#ffe8cc,stroke:#e8590c",
        "  classDef que fill:#ffe3e3,stroke:#c92a2a",
        "  classDef opi fill:#e7f5ff,stroke:#1971c2",
    ]
    return "\n".join(lines)


def to_markdown(s: dict) -> str:
    icon = {"decision": "✅", "action": "🔨", "question": "❓", "opinion": "💬"}
    md = [f"# {s['title']}\n"]
    for i, t in enumerate(s["topics"], 1):
        md.append(f"## {i}. {t['title']}\n\n{t['summary']}\n")
        for p in t["points"]:
            who = f" — {p['speaker']}" if p.get("speaker") else ""
            md.append(f"- {icon[p['kind']]} {p['text']}{who}")
        md.append("")
    if s["decisions"]:
        md.append("## 결정사항\n")
        md += [f"- {d}" for d in s["decisions"]] + [""]
    if s["action_items"]:
        md.append("## 액션 아이템\n\n| 할 일 | 담당 | 기한 |\n|---|---|---|")
        md += [f"| {a['task']} | {a['owner'] or '-'} | {a['due'] or '-'} |" for a in s["action_items"]]
    return "\n".join(md) + "\n"


def main():
    ap = argparse.ArgumentParser(description="회의 mp3 -> 위계 요약 + FigJam 도식")
    ap.add_argument("audio", type=Path, help="mp3/m4a/wav 등 ffmpeg가 읽는 오디오")
    ap.add_argument("-o", "--out", type=Path, default=Path("out"))
    ap.add_argument("--transcript", type=Path, help="전사 건너뛰고 이 텍스트 파일 사용")
    a = ap.parse_args()

    a.out.mkdir(parents=True, exist_ok=True)
    if a.transcript:
        text = a.transcript.read_text()
    else:
        print("전사 중...", file=sys.stderr)
        text = transcribe(a.audio)
        (a.out / "transcript.txt").write_text(text)

    print("요약 중...", file=sys.stderr)
    s = summarize(text)
    (a.out / "summary.json").write_text(json.dumps(s, ensure_ascii=False, indent=2))
    (a.out / "summary.md").write_text(to_markdown(s))
    (a.out / "diagram.mmd").write_text(to_mermaid(s))
    print(f"완료 -> {a.out}/ (transcript.txt, summary.json, summary.md, diagram.mmd)")


if __name__ == "__main__":
    main()
