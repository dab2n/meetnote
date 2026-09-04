"""전사문 -> IBIS 정리 맵(docs/data/<id>.ibis.json). 뷰어가 그대로 읽는 형식.

핵심은 프롬프트가 아니라 그 뒤의 검증이다. 모델이 만든 시각·부모·id를 전사문에
스냅하고, 풀리지 않는 참조는 버린다. 뷰어에서 깨진 맵이 뜨는 것보다 노드 몇 개가
빠지는 편이 낫다.
"""
import json, re, sys
from pathlib import Path

MODEL = "claude-opus-5"
KINDS = ["issue", "position", "pro", "con", "condition", "open"]
RES_KINDS = ["decision", "conditional", "open"]

NODE = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "description": "섹션 안에서 유일한 짧은 id (예: b-p1)"},
        "kind": {"type": "string", "enum": KINDS},
        "parent": {"type": "string", "description": "이 노드가 반응한 대상 노드의 id. 쟁점(issue)은 빈 문자열."},
        "title": {"type": "string", "description": "명사형으로 정리한 한 줄. 발언 인용이 아니다."},
        "who": {"type": "string", "description": "이 주장을 한 사람 이름"},
        "t": {"type": "string", "description": "이 주장이 나온 시각 mm:ss 또는 h:mm:ss"},
        "at": {
            "type": "array", "description": "원문에서 이 주장이 오간 구간 [시작, 끝]",
            "items": {"type": "string"}, "minItems": 2, "maxItems": 2,
        },
        "note": {"type": "string", "description": "왜 그렇게 말했는지 한 문장. 원문 재인용 금지."},
    },
    "required": ["id", "kind", "parent", "title", "who", "t", "at", "note"],
    "additionalProperties": False,
}

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "회의 제목"},
        "headline": {"type": "string", "description": "이 회의가 무엇을 바꿨는지 한 문장"},
        "sections": {
            "type": "array",
            "description": "메인 논의 주제. 실제 논의된 시간 순서.",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "논의 주제 (명사형, 20자 내외)"},
                    "part": {"type": "string", "description": "UX / ID / BX / TEAM 같은 담당 파트. 모르면 TEAM."},
                    "t": {"type": "string"},
                    "t1": {"type": "string"},
                    "nodes": {"type": "array", "items": NODE},
                    "conflicts": {
                        "type": "array",
                        "description": "서로 배타적이라 하나를 고르면 다른 하나를 버려야 하는 주장 쌍의 id",
                        "items": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                    },
                    "resolution": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": RES_KINDS},
                            "title": {"type": "string"},
                            "who": {"type": "string"},
                            "t": {"type": "string"},
                            "at": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
                            "from": {"type": "array", "description": "이 결론으로 모인 노드 id", "items": {"type": "string"}},
                        },
                        "required": ["kind", "title", "who", "t", "at", "from"],
                        "additionalProperties": False,
                    },
                },
                "required": ["title", "part", "t", "t1", "nodes", "conflicts", "resolution"],
                "additionalProperties": False,
            },
        },
        "carry": {
            "type": "array",
            "description": "결론이 안 난 채 다음 회의로 넘어가는 쟁점",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"}, "part": {"type": "string"}, "note": {"type": "string"},
                },
                "required": ["label", "part", "note"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "headline", "sections", "carry"],
    "additionalProperties": False,
}

SYSTEM = """너는 회의 기록을 IBIS(Issue-Based Information System) 구조로 정리한다.
전사문을 읽고, 무엇이 쟁점이었고 누가 어떤 주장을 했고 무엇이 부딪혔고 어떻게 닫혔는지를 그린다.

## 구조
- section = 하나의 메인 논의 주제. 8~16개. 잡담·일정 확인·인사·안부는 섹션으로 만들지 않는다.
  주제가 뒤에서 다시 돌아왔으면 하나의 섹션으로 합치고 t~t1을 그 범위로 잡는다.
- 섹션 안의 노드는 정확히 이 다섯 가지다.
  - issue    : 그 주제에서 답해야 했던 물음. 섹션마다 반드시 하나. parent는 빈 문자열.
  - position : 그 물음에 대한 답, 즉 주장·제안·방향. parent는 issue.
  - pro      : 어떤 주장을 뒷받침하는 근거나 동의. parent는 그 주장.
  - con      : 어떤 주장에 대한 반론·우려·걸림돌. parent는 그 주장(또는 issue 자체에 대한 외부 반문).
  - condition: 그 주장이 성립하려면 충족돼야 하는 조건. parent는 그 주장.
  - open     : 그 주장 안에서 정하지 못하고 남은 것. parent는 그 주장.
- parent는 반드시 그 노드가 실제로 반응한 대상이다. 시간 순서만 보고 아무 데나 붙이지 않는다.
- 섹션당 노드 4~9개. 모든 발언을 노드로 만들지 않는다. 논의를 움직인 것만 남긴다.

## conflicts
실제로 양립할 수 없어서 하나를 고르면 다른 하나를 버려야 하는 position 쌍만 넣는다.
"A안과 A안을 보완한 안"은 대립이 아니다. 대립이 없는 섹션은 빈 배열로 둔다.

## resolution — 여기서 가장 많이 틀린다
- decision   : 참석자들이 실제로 합의하고 넘어갔을 때만. "그렇게 가자", "무조건 넣어야 돼", 상대가 동의로 받은 경우.
- conditional: 방향은 유지하되 조건·검증이 붙은 경우.
- open       : 정하지 못하고 넘어간 경우.
확신 없이 던진 말과 "해봐야지", "감이 안 와", "고민해 볼게" 로 넘어간 것은 결론이 아니라 open이다.
그 자리에서 아무도 답하지 않은 질문도 open이다. 결론을 만들어내려고 애쓰지 마라.
from에는 그 결론으로 수렴한 노드 id만 넣는다.

## 문구
- title은 전부 명사형으로 정리한 문장이다. 발언을 그대로 옮기지 않는다.
  나쁨: "차라리 그때는 이어폰으로만 하는 게 맞는 건지"
  좋음: "스킬 발동의 프로젝션 표현 미정"
- note는 그렇게 말한 근거를 한 문장으로 쓴다. 원문을 다시 붙여넣지 않는다.
- 전사문에 없는 내용은 만들지 않는다. 전사가 뭉개진 부분은 노드로 만들지 않는다.
- who는 전사문에 나온 화자 이름 그대로.

## 시각
t와 at은 전사문에 실제로 찍힌 타임스탬프에서 고른다. 지어내지 않는다.
at은 그 주장이 오간 구간이다. 뒤 시각은 그 주장이 끝나고 다음 이야기로 넘어간 지점.

모든 출력은 한국어."""


REVIEW = """너는 방금 만들어진 IBIS 정리 맵을 원문과 대조해 고친다.
초안은 한 번 읽고 쓴 것이라 아래 다섯 가지에서 틀린다. 원문을 다시 훑으며 하나씩 확인해라.

1. 결론 오탐 — 가장 자주 틀린다.
   decision으로 적힌 것을 원문에서 찾아, 참석자들이 실제로 합의하고 넘어갔는지 확인해라.
   말한 사람이 확신 없이 던졌거나("~하는 게 맞는 건지", "감이 안 와"),
   상대가 "해봐야지", "고민해 볼게"로 받았거나, 아무도 답하지 않았으면 open이다.
   조건·검증이 붙어 있으면 conditional이다. 반대로 명확히 합의했는데 open으로 적힌 것도 고쳐라.

2. 섹션 — 잡담·안부·일정 확인만 있는 섹션은 지워라. 같은 주제가 두 섹션으로 쪼개져 있으면 합쳐라.
   원문에서 실제로 길게 다퉜는데 빠진 쟁점이 있으면 섹션을 추가해라.

3. parent — 각 노드가 실제로 무엇에 반응한 것인지 원문에서 확인해라.
   시간이 가깝다는 이유로 엉뚱한 주장에 붙어 있으면 옮겨라.

4. conflicts — 정말 하나를 고르면 다른 하나를 버려야 하는 쌍만 남겨라.
   보완 관계이거나 단순히 순서가 다른 것은 지워라.

5. 문구·화자·시각 — title이 발언을 그대로 옮긴 것이면 명사형으로 고쳐라.
   who가 그 말을 한 사람이 맞는지, at 구간이 그 주장이 오간 곳이 맞는지 원문에서 확인해라.

고칠 곳이 없으면 그대로 두어라. 지어내서 채우지 마라. 전체 맵을 같은 형식으로 다시 출력한다."""


# ---------- 전사문 ----------

HEAD = re.compile(r"^(\S{1,10})\s+((?:\d{1,2}:)?\d{1,2}:\d{2})\s*$")


def secs(s: str) -> int:
    return sum(int(v) * m for v, m in zip(reversed(str(s).split(":")), (1, 60, 3600)))


def mmss(t: int) -> str:
    h, m, s = t // 3600, t % 3600 // 60, t % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def parse(text: str) -> list[dict]:
    """'이름 00:00' 헤더 + 발언 줄. 같은 사람이 이어 말하면 합친다."""
    segs, cur = [], None
    for raw in text.splitlines():
        line = raw.lstrip("﻿").strip()
        if m := HEAD.match(line):
            cur = {"t": secs(m[2]), "s": m[1], "l": []}
            segs.append(cur)
        elif line and cur:
            cur["l"].append(line)
    out = []
    for s in segs:
        if out and out[-1]["s"] == s["s"] and s["t"] - out[-1]["t"] < 30:
            out[-1]["l"] += s["l"]
        else:
            out.append(s)
    return [s for s in out if s["l"]]


def as_prompt(segs: list[dict]) -> str:
    return "\n\n".join(f"{s['s']} {mmss(s['t'])}\n" + "\n".join(s["l"]) for s in segs)


# ---------- 생성 ----------

def _key() -> str | None:
    """환경변수가 없으면 데스크탑 설정(.meetnote.json)에서 찾는다."""
    import os
    if os.environ.get("ANTHROPIC_API_KEY"):
        return None
    conf = Path(__file__).parent / ".meetnote.json"
    if conf.exists():
        try:
            return json.loads(conf.read_text()).get("api_key") or None
        except Exception:
            pass
    return None


def _ask(system: str, user: str) -> dict:
    import anthropic
    client = anthropic.Anthropic(api_key=_key()) if _key() else anthropic.Anthropic()
    with client.messages.stream(
        model=MODEL,
        max_tokens=32000,
        system=system,
        thinking={"type": "adaptive"},
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": user}],
    ) as stream:
        msg = stream.get_final_message()
    return json.loads(next(b.text for b in msg.content if b.type == "text"))


def generate(segs: list[dict], hint: str = "", review: bool = True, log=print) -> dict:
    """초안 한 번, 원문 대조 한 번. 두 번째 패스에서 결론 오탐이 주로 잡힌다."""
    body = as_prompt(segs)
    head = (f"<meeting>{hint}</meeting>\n" if hint else "") + f"<transcript>\n{body}\n</transcript>\n\n"
    log("  초안 만드는 중…")
    draft = _ask(SYSTEM, head + "이 회의를 IBIS 구조로 정리해라. 결론이 안 난 주제는 억지로 닫지 마라.")
    if not review:
        return draft
    log(f"  원문과 대조하는 중… (초안 논의 {len(draft.get('sections', []))}개)")
    return _ask(SYSTEM + "\n\n" + REVIEW,
                head + "<draft>\n" + json.dumps(draft, ensure_ascii=False) + "\n</draft>\n\n"
                "위 초안을 원문과 대조해 고쳐라.")


# ---------- 검증 ----------

def snap(t, starts: list[int], lo: int = 0) -> int:
    """모델이 준 시각을 실제 발언 시작점으로 당긴다. 하이라이트가 빈 곳을 가리키지 않게."""
    try:
        v = secs(t)
    except Exception:
        return lo
    cands = [x for x in starts if x >= lo] or starts
    return min(cands, key=lambda x: abs(x - v))


def verify(raw: dict, segs: list[dict], meta: dict) -> tuple[dict, list[str]]:
    """모델 출력 -> 뷰어가 읽는 맵. 풀리지 않는 참조는 버리고 무엇을 버렸는지 남긴다."""
    starts = [s["t"] for s in segs]
    end = starts[-1] + 30
    warn, sections = [], []

    for sec in raw.get("sections", []):
        nodes, by_id = [], {}
        for n in sec.get("nodes", []):
            if n["kind"] not in KINDS or not n.get("title"):
                warn.append(f"[{sec['title']}] 알 수 없는 노드 {n.get('id')}")
                continue
            t = snap(n["t"], starts)
            a0 = snap(n["at"][0], starts)
            a1 = snap(n["at"][1], starts, lo=a0 + 1) if len(n["at"]) > 1 else end
            if a1 <= a0:
                a1 = next((x for x in starts if x > a0), end)
            n = dict(n, t=mmss(t), at=[mmss(a0), mmss(a1)])
            nodes.append(n); by_id[n["id"]] = n

        issues = [n for n in nodes if n["kind"] == "issue"]
        if not issues:
            warn.append(f"[{sec.get('title')}] 쟁점이 없어 섹션을 버림")
            continue
        root = issues[0]["id"]
        for n in nodes:                      # 부모가 사라졌으면 쟁점에 붙인다
            if n["kind"] == "issue":
                n["parent"] = ""
            elif n.get("parent") not in by_id or n["parent"] == n["id"]:
                if n.get("parent"):
                    warn.append(f"[{sec['title']}] {n['id']}의 부모 {n['parent']} 없음 → 쟁점에 연결")
                n["parent"] = root

        conflicts = [c for c in sec.get("conflicts", []) if len(c) == 2 and all(x in by_id for x in c) and c[0] != c[1]]
        r = sec.get("resolution") or {}
        if r.get("kind") not in RES_KINDS or not r.get("title"):
            warn.append(f"[{sec['title']}] 결론이 없어 미결로 둠")
            r = {"kind": "open", "title": "결론 없이 넘어간 주제", "who": nodes[-1]["who"],
                 "t": nodes[-1]["t"], "at": nodes[-1]["at"], "from": [nodes[-1]["id"]]}
        else:
            ra0 = snap(r["at"][0], starts)
            ra1 = snap(r["at"][1], starts, lo=ra0 + 1) if len(r["at"]) > 1 else end
            r = dict(r, t=mmss(snap(r["t"], starts)), at=[mmss(ra0), mmss(max(ra1, ra0 + 1))])
            r["from"] = [x for x in r.get("from", []) if x in by_id]
            if not r["from"]:
                r["from"] = [n["id"] for n in nodes if n["kind"] != "issue"] or [root]

        st = snap(sec.get("t", nodes[0]["t"]), starts)
        st1 = max(secs(n["at"][1]) for n in nodes + [r])
        sections.append({"title": sec["title"], "part": sec.get("part") or "TEAM",
                         "t": mmss(st), "t1": mmss(st1), "nodes": nodes,
                         "conflicts": conflicts, "resolution": r})

    sections.sort(key=lambda s: secs(s["t"]))
    for i, s in enumerate(sections, 1):
        s["no"] = i
    if not sections:
        raise ValueError("정리할 논의를 찾지 못했습니다")

    return {
        "id": meta["id"],
        "meeting": {"title": raw.get("title") or meta["id"], "date": meta.get("date", ""),
                    "duration": mmss(end - 30), "audio": meta.get("audio", ""),
                    "transcript": f"data/{meta['id']}.transcript.json"},
        "headline": raw.get("headline", ""),
        "sections": sections,
        "carry": raw.get("carry", []),
    }, warn


# ---------- 쓰기 ----------

def write(text: str, docs_data: Path, mid: str, date: str = "", audio: str = "",
          hint: str = "", review: bool = True, log=print) -> tuple[Path, list[str]]:
    """전사문 하나 -> <id>.transcript.json + <id>.ibis.json + index.json 갱신."""
    segs = parse(text)
    if len(segs) < 5:
        raise ValueError("전사문에서 발언을 읽지 못했습니다 (‘이름 00:00’ 형식이 필요합니다)")
    docs_data.mkdir(parents=True, exist_ok=True)
    (docs_data / f"{mid}.transcript.json").write_text(
        json.dumps({"segments": segs}, ensure_ascii=False), encoding="utf-8")

    m, warn = verify(generate(segs, hint, review, log), segs, {"id": mid, "date": date, "audio": audio})
    out = docs_data / f"{mid}.ibis.json"
    out.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
    reindex(docs_data)
    return out, warn


def reindex(docs_data: Path):
    """뷰어가 회의 목록을 띄울 수 있도록."""
    items = []
    for f in sorted(docs_data.glob("*.ibis.json")):
        try:
            m = json.loads(f.read_text())
        except Exception:
            continue
        items.append({"id": m["id"], "title": m["meeting"]["title"], "date": m["meeting"].get("date", ""),
                      "duration": m["meeting"].get("duration", ""), "sections": len(m["sections"]),
                      "map": f"data/{f.name}"})
    items.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
    (docs_data / "index.json").write_text(json.dumps({"meetings": items}, ensure_ascii=False, indent=2),
                                          encoding="utf-8")


def main():
    import argparse
    ap = argparse.ArgumentParser(description="전사문을 IBIS 정리 맵으로 만든다")
    ap.add_argument("transcript", type=Path, help="'이름 00:00' 형식의 전사 txt")
    ap.add_argument("--id", help="회의 id (기본: 파일명)")
    ap.add_argument("--date", default="", help="2026.06.15")
    ap.add_argument("--audio", default="", help="docs 기준 음성 경로 (예: audio/2026-06-15.m4a)")
    ap.add_argument("--hint", default="", help="프로젝트·참석자 등 한 줄 배경")
    ap.add_argument("--docs", type=Path, default=Path(__file__).parent / "docs/data")
    ap.add_argument("--no-review", action="store_true", help="원문 대조 패스를 건너뛴다 (빠르고 싸지만 결론 오탐이 는다)")
    a = ap.parse_args()

    mid = a.id or re.sub(r"\.(transcript|txt|json)$", "", a.transcript.stem)
    try:
        out, warn = write(a.transcript.read_text(errors="replace"), a.docs, mid,
                          a.date, a.audio, a.hint, review=not a.no_review)
    except Exception as e:
        if "authentication" in str(e).lower() or "api_key" in str(e).lower():
            sys.exit("ANTHROPIC_API_KEY가 필요합니다.\n"
                     "환경변수로 넣거나, 패널의 ⚙︎에서 키를 저장하세요 (.meetnote.json).\n"
                     "(전사 JSON은 이미 저장돼 있습니다)")
        raise
    m = json.loads(out.read_text())
    print(f"{out}  ·  논의 {len(m['sections'])}개")
    for s in m["sections"]:
        print(f"  {s['no']:>2}. [{s['t']}–{s['t1']}] {s['title']}  ({s['resolution']['kind']})")
    for w in warn:
        print(f"  ! {w}", file=sys.stderr)


if __name__ == "__main__":
    main()
