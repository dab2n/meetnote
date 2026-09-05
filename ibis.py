"""전사문 -> IBIS 정리 맵(docs/data/<id>.ibis.json). 뷰어가 그대로 읽는 형식.

핵심은 프롬프트가 아니라 그 뒤의 검증이다. 모델이 만든 시각·부모·id를 전사문에
스냅하고, 풀리지 않는 참조는 버린다. 뷰어에서 깨진 맵이 뜨는 것보다 노드 몇 개가
빠지는 편이 낫다.
"""
import json, re, sys
from pathlib import Path

MODEL = "claude-opus-5"
KINDS = ["issue", "position", "pro", "con", "concern", "condition", "open"]
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
        "highlights": {
            "type": "array",
            "description": "웃음·감탄이 터진 순간. 3~6개. 없으면 빈 배열.",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string",
                              "description": "무슨 말이 나와서 웃었는지 상황으로 쓴 한 줄. 반드시 '~한 순간'으로 끝낸다. 사람 이름은 쓰지 않는다."},
                    "quote": {"type": "string", "description": "그 순간 실제로 나온 짧은 문장 하나"},
                    "t": {"type": "string"}, "t1": {"type": "string"},
                },
                "required": ["title", "quote", "t", "t1"],
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
    "required": ["title", "headline", "sections", "highlights", "carry"],
    "additionalProperties": False,
}

SPEC = (Path(__file__).parent / "docs/SPEC.md").read_text(encoding="utf-8")  # 웹 뷰어와 같은 파일을 본다

SYSTEM = """너는 회의 기록을 IBIS(Issue-Based Information System) 구조로 정리한다.
전사문을 읽고, 무엇이 쟁점이었고 누가 어떤 주장을 했고 무엇이 부딪혔고 어떻게 닫혔는지를 그린다.

아래 표준을 그대로 지킨다. 이 표준은 기계로 검사되고, 어긴 항목은 되돌아온다.

""" + SPEC + """

모든 출력은 한국어."""

REVIEW = """너는 방금 만들어진 IBIS 정리 맵을 원문과 대조해 고친다.
초안은 한 번 읽고 쓴 것이라 아래에서 틀린다. 원문을 다시 훑으며 하나씩 확인해라.

0. 종류와 문구. con으로 적힌 것이 정말 "그대로는 못 쓴다"는 반대인지, 걸리는 점을 말한 concern인지 확인해라.
   title이 명사 나열이거나 발언 인용이면 표준 2절의 형태로 고쳐라.
1. 결론 오탐 — 가장 자주 틀린다. decision으로 적힌 것을 원문에서 찾아 실제로 합의하고 넘어갔는지 확인해라.
   "해봐야지 / 감이 안 와"로 넘어갔거나 아무도 답하지 않았으면 open이다. 조건이 붙었으면 conditional이다.
2. 섹션 — 잡담만 있는 섹션은 지워라. 같은 주제가 쪼개져 있으면 합쳐라. 길게 다퉜는데 빠진 쟁점이 있으면 추가해라.
3. parent — 각 노드가 실제로 무엇에 반응한 것인지 확인해라. 다른 섹션을 가리키면 옮기거나 지워라.
4. conflicts — 표준 4절의 세 조건을 원문에서 확인해라. 하나라도 아니면 지워라.
   대안만 여럿 나오고 못 골랐으면 지우고 resolution을 open으로 내려라. 하나도 안 남는 것이 정상이다.
5. who·at — 그 말을 한 사람이 맞는지, 구간이 맞는지 원문에서 확인해라.

고칠 곳이 없으면 그대로 두어라. 지어내서 채우지 마라. 전체 맵을 같은 형식으로 다시 출력한다."""

REPAIR = """방금 만든 맵이 표준 검사에서 아래 항목을 어겼다.
**어긴 항목만** 고치고 나머지는 그대로 둔다. 고칠 때도 원문에 없는 내용을 만들지 않는다.
전체 맵을 같은 형식으로 다시 출력한다.

위반 목록:
"""


# ---------- 전사문 ----------

# 화자 줄. 서비스마다 다르게 뱉는다 — "시헌 00:00", "발화자 1  (00:00)", "참석자 3 [1:02:03]"
HEAD = re.compile(r"^(.{1,20}?)\s*[(\[]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[)\]]?$")


def read_text(p: Path) -> str:
    """클로바노트·일부 도구는 UTF-16으로 떨어뜨린다. BOM을 보고 골라 읽는다."""
    b = p.read_bytes()
    if b[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return b.decode("utf-16", errors="replace")
    return b.decode("utf-8-sig" if b[:3] == b"\xef\xbb\xbf" else "utf-8", errors="replace")


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


def generate(segs: list[dict], hint: str = "", review: bool = True, log=print, tries: int = 2) -> dict:
    """초안 → 원문 대조 → 표준 검사 → 어긴 항목만 수리. 검사를 통과할 때까지 최대 tries번."""
    body = as_prompt(segs)
    head = (f"<meeting>{hint}</meeting>\n" if hint else "") + f"<transcript>\n{body}\n</transcript>\n\n"
    log("  초안 만드는 중…")
    m = _ask(SYSTEM, head + "이 회의를 IBIS 구조로 정리해라. 결론이 안 난 주제는 억지로 닫지 마라.")

    if review:
        log(f"  원문과 대조하는 중… (초안 논의 {len(m.get('sections', []))}개)")
        m = _ask(SYSTEM + "\n\n" + REVIEW,
                 head + "<draft>\n" + json.dumps(m, ensure_ascii=False) + "\n</draft>\n\n"
                 "위 초안을 원문과 대조해 고쳐라.")

    for i in range(tries):
        bad = audit(m, segs)
        if not bad:
            log("  표준 검사 통과")
            break
        log(f"  표준 검사 {len(bad)}건 위반 → 그 항목만 고치는 중… ({i + 1}/{tries})")
        m = _ask(SYSTEM + "\n\n" + REPAIR + "\n".join("- " + x for x in bad),
                 head + "<map>\n" + json.dumps(m, ensure_ascii=False) + "\n</map>")
    return m


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
        "highlights": [h for h in raw.get("highlights", []) if h.get("title") and h.get("quote")],
        "carry": raw.get("carry", []),
    }, warn


# ---------- 표준 검사 ----------
# SPEC.md 를 기계로 검사한다. 프롬프트가 지키라고 한 것을 여기서 실제로 확인한다.
# 사람이 판단해야 하는 것(팽팽했는가, 정말 합의였는가)은 검사하지 않고 프롬프트·대조 패스에 맡긴다.

END = {                                   # 종류별 종결 형태 (SPEC 2절)
    "issue": (r"(인가|것인가|는가|은가|운가|을까|ㄹ까|까)[?]?$", "물음 형태로"),
    "position": (r"(다|자)$", "‘~한다 / ~하자’로"),
    "pro": (r"다$", "‘~다’로 끝나는 서술형으로"),
    "con": (r"다$", "‘~면 ~할 수 없다’처럼 서술형으로"),
    "concern": (r"다$", "‘~가 걸린다 / ~가 우려된다’로"),
    "condition": (r"다$", "‘~해야 ~할 수 있다’로"),
    "open": (r"다$", "‘~는 정하지 못했다’로"),
    "decision": (r"다$", "‘~하기로 한다’로"),
    "conditional": (r"다$", "‘~하되 ~를 조건으로 한다’로"),
}


def audit(m: dict, segs: list[dict] | None = None) -> list[str]:
    """표준 위반 목록. 비어 있으면 통과."""
    v, secs_ = [], m.get("sections", [])
    body = " ".join(" ".join(s["l"]) for s in segs) if segs else ""
    people = {s["s"] for s in segs} if segs else set()

    if not 6 <= len(secs_) <= 16:
        v.append(f"[구조] 섹션이 {len(secs_)}개다. 6~16개여야 한다")
    if len(m.get("headline", "")) < 20:
        v.append("[구조] headline이 비었거나 너무 짧다")

    dec = 0
    for sec in secs_:
        tag = f"논의 {sec.get('no')} ({sec.get('title', '')[:16]})"
        nodes = sec.get("nodes", [])
        ids = {n["id"] for n in nodes}
        kinds = [n["kind"] for n in nodes]
        if kinds.count("issue") != 1:
            v.append(f"{tag} 쟁점(issue)이 {kinds.count('issue')}개다. 정확히 하나여야 한다")
        if "position" not in kinds:
            v.append(f"{tag} 주장(position)이 하나도 없다")
        if not 4 <= len(nodes) <= 9:
            v.append(f"{tag} 노드가 {len(nodes)}개다. 4~9개여야 한다")

        for n in nodes + [dict(sec.get("resolution", {}), id=f"{sec.get('no')}-res")]:
            k, t = n.get("kind"), (n.get("title") or "").strip()
            if not k or not t:
                continue
            where = f"{tag} {n['id']}"
            if not 12 <= len(t) <= 60:
                v.append(f"{where} 제목이 {len(t)}자다. 12~60자여야 한다 — “{t[:26]}”")
            pat, how = END.get(k, (None, None))
            if pat and not re.search(pat, t):
                v.append(f"{where} {k} 제목을 {how} 써야 한다 — “{t[:30]}”")
            if body and len(t) > 14 and t.rstrip(".") in body:
                v.append(f"{where} 제목이 발언 그대로다. 정리한 문장으로 바꿔야 한다 — “{t[:30]}”")
            if n.get("parent") and n["parent"] not in ids:
                v.append(f"{where} parent가 이 섹션에 없다")

        r = sec.get("resolution") or {}
        if r.get("kind") == "decision":
            dec += 1
        if not r.get("from"):
            v.append(f"{tag} 결론에 수렴한 노드(from)가 비었다")

        for pair in sec.get("conflicts", []):
            a, b = [next((n for n in nodes if n["id"] == x), None) for x in pair]
            if not a or not b:
                v.append(f"{tag} 대립이 이 섹션에 없는 노드를 가리킨다")
                continue
            if a.get("who") == b.get("who"):
                v.append(f"{tag} 대립인데 말한 사람이 같다({a.get('who')}). 대립이 아니다")
            if not (a["kind"] == b["kind"] == "position"):
                v.append(f"{tag} 대립은 주장끼리만 맺는다 ({a['kind']} ↔ {b['kind']})")

    if secs_ and dec > len(secs_) * 2 / 3:
        v.append(f"[결론] 확정이 {dec}/{len(secs_)}개다. 3분의 2를 넘으면 대개 오탐이다")

    hs = m.get("highlights", [])
    if hs and not 3 <= len(hs) <= 6:
        v.append(f"[하이라이트] {len(hs)}개다. 3~6개여야 한다")
    for i, h in enumerate(hs):
        t = (h.get("title") or "").strip()
        if not t.endswith("순간"):
            v.append(f"[하이라이트 {i + 1}] 제목이 ‘~한 순간’으로 끝나야 한다 — “{t[:30]}”")
        if any(p in t for p in people):
            v.append(f"[하이라이트 {i + 1}] 제목에 사람 이름이 들어갔다 — “{t[:30]}”")
        if not (h.get("quote") or "").strip():
            v.append(f"[하이라이트 {i + 1}] quote가 비었다")
    return v


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
    warn += ["[표준] " + x for x in audit(m, segs)]      # 수리 뒤에도 남은 것
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
    ap.add_argument("transcript", type=Path, help="'이름 00:00' 형식의 전사 txt (--audit 이면 검사할 맵)")
    ap.add_argument("--audit", action="store_true", help="이미 있는 맵을 표준(SPEC.md)으로 검사만 한다")
    ap.add_argument("--id", help="회의 id (기본: 파일명)")
    ap.add_argument("--date", default="", help="2026.06.15")
    ap.add_argument("--audio", default="", help="docs 기준 음성 경로 (예: audio/2026-06-15.m4a)")
    ap.add_argument("--hint", default="", help="프로젝트·참석자 등 한 줄 배경")
    ap.add_argument("--docs", type=Path, default=Path(__file__).parent / "docs/data")
    ap.add_argument("--no-review", action="store_true", help="원문 대조 패스를 건너뛴다 (빠르고 싸지만 결론 오탐이 는다)")
    a = ap.parse_args()

    if a.audit:
        m = json.loads(a.transcript.read_text(encoding="utf-8"))
        tp = a.transcript.parent / (m["meeting"]["transcript"].split("/")[-1])
        segs = json.loads(tp.read_text(encoding="utf-8"))["segments"] if tp.exists() else None
        bad = audit(m, segs)
        print(f"{a.transcript.name} · 논의 {len(m['sections'])}개 · 위반 {len(bad)}건")
        for x in bad:
            print("  ✗", x)
        sys.exit(1 if bad else 0)

    mid = a.id or re.sub(r"\.(transcript|txt|json)$", "", a.transcript.stem)
    try:
        out, warn = write(read_text(a.transcript), a.docs, mid,
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
