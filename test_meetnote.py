"""도식/마크다운 변환 자체 점검. API 호출 없음.  실행: python test_meetnote.py"""
from meetnote import to_mermaid, to_markdown

S = {
    "title": '킥오프 "1차"',
    "topics": [
        {"title": "일정", "summary": "3월 말 출시로 합의", "points": [
            {"text": "2주 당기자", "kind": "opinion", "speaker": "김"},
            {"text": "3월 31일 출시 확정", "kind": "decision", "speaker": ""},
        ]},
        {"title": "예산", "summary": "미정, 다음 주 재논의", "points": [
            {"text": "서버비 얼마?", "kind": "question", "speaker": "박"},
            {"text": "견적 취합", "kind": "action", "speaker": "이"},
        ]},
    ],
    "decisions": ["3월 31일 출시"],
    "action_items": [{"task": "견적 취합", "owner": "이", "due": "3/10"}],
}

m = to_mermaid(S)
assert "START ==> T0" in m and "T0 ==> T1" in m, "메인 주제 흐름 화살표 누락"
assert "T0 -.-> T0p0" in m, "의견 가지 화살표 누락"
assert '{{"3월 31일 출시 확정"}}:::dec' in m, "decision 도형/색 누락"
assert '[/"견적 취합 <i>(이)</i>"/]:::act' in m, "action 도형 누락"
assert '{"서버비 얼마? <i>(박)</i>"}:::que' in m, "question 도형 누락"
assert 'START(["킥오프 #quot;1차#quot;"])' in m, "라벨 따옴표 미이스케이프"

md = to_markdown(S)
assert "## 1. 일정" in md and "## 2. 예산" in md, "주제 위계 누락"
assert "- ✅ 3월 31일 출시 확정" in md and "— 김" in md
assert "| 견적 취합 | 이 | 3/10 |" in md, "액션 아이템 표 누락"

print("ok")


def test_staged_경로_가드():
    """패널이 넘긴 경로. out/ 밖이면 무조건 막아야 한다."""
    import server
    real = server.OUT / "테스트" / "input.m4a"
    real.parent.mkdir(parents=True, exist_ok=True)
    real.write_bytes(b"x")
    try:
        assert server.staged(str(real)) == real.resolve()
        assert server.staged("/etc/passwd") is None
        assert server.staged(str(server.OUT / ".." / "meetnote.py")) is None   # 탈출 시도
        assert server.staged(str(server.OUT / "없는파일.m4a")) is None
        assert server.staged("") is None
    finally:
        real.unlink(); real.parent.rmdir()

# ---------- ibis: 모델 출력 검증 (API 호출 없음) ----------
import ibis

T = "\n".join(f"{'김' if (i // 20) % 2 else '이'} {i//60}:{i%60:02d}\n{i}번째 발언입니다." for i in range(0, 300, 20))
SEGS = ibis.parse(T)
assert len(SEGS) == 15, len(SEGS)

RAW = {
    "title": "테스트 회의", "headline": "한 줄",
    "sections": [
        {"title": "쟁점 있는 주제", "part": "UX", "t": "0:00", "t1": "2:00", "nodes": [
            {"id": "i", "kind": "issue", "parent": "", "title": "무엇을 정할 것인가",
             "who": "이", "t": "0:07", "at": ["0:03", "1:00"], "note": "n"},
            {"id": "p1", "kind": "position", "parent": "i", "title": "A안", "who": "김",
             "t": "1:00", "at": ["1:00", "1:40"], "note": "n"},
            {"id": "c1", "kind": "con", "parent": "없는id", "title": "A안 우려", "who": "이",
             "t": "1:40", "at": ["1:40", "2:00"], "note": "n"},
            {"id": "x", "kind": "몰라", "parent": "i", "title": "버려질 노드", "who": "김",
             "t": "1:00", "at": ["1:00", "1:20"], "note": "n"},
        ], "conflicts": [["p1", "없는id"], ["i", "p1"]],
         "resolution": {"kind": "decision", "title": "A안으로", "who": "김", "t": "2:00",
                        "at": ["2:00", "2:20"], "from": ["p1", "없는id"]}},
        {"title": "쟁점 없는 주제", "part": "ID", "t": "3:00", "t1": "4:00", "nodes": [
            {"id": "z", "kind": "position", "parent": "", "title": "고아", "who": "김",
             "t": "3:00", "at": ["3:00", "3:20"], "note": "n"}], "conflicts": [],
         "resolution": {"kind": "open", "title": "미정", "who": "김", "t": "3:20",
                        "at": ["3:20", "4:00"], "from": []}},
    ],
    "carry": [],
}

m, warn = ibis.verify(RAW, SEGS, {"id": "t1", "date": "2026.06.15"})
sec = m["sections"][0]
starts = {s["t"] for s in SEGS}
assert len(m["sections"]) == 1, "쟁점 없는 섹션은 버려야 한다"
assert [n["id"] for n in sec["nodes"]] == ["i", "p1", "c1"], "알 수 없는 kind는 버려야 한다"
assert sec["nodes"][2]["parent"] == "i", "없는 부모는 쟁점으로 되돌려야 한다"
assert sec["conflicts"] == [["i", "p1"]], "풀리지 않는 대립은 버려야 한다"
assert sec["resolution"]["from"] == ["p1"], "없는 id는 from에서 빼야 한다"
assert sec["no"] == 1 and sec["t"] == "0:00"
for n in sec["nodes"] + [sec["resolution"]]:
    assert ibis.secs(n["t"]) in starts, f"{n['id']} 시각이 실제 발언에 스냅되지 않음"
    a0, a1 = (ibis.secs(x) for x in n["at"])
    assert a0 in starts and a1 > a0, f"{n['id']} 구간이 잘못됨"
assert len(warn) >= 3, warn
print("ibis 검증 OK ·", len(warn), "건 경고")
