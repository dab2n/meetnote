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
