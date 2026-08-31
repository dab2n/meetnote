# meetnote

회의 오디오를 **위계와 핵심** 중심 문서로 정리하고, FigJam 도식으로 뽑는 도구.

최종 목표: 크롬 익스텐션으로 회의 녹음 → 정지 → export 대상(FigJam/PPT/Word) 선택 → 데스크탑 앱이 실행.
지금은 **1단계: 파이프라인**만 있음. mp3 파일로 테스트한다.

```
mp3 ──whisper──▶ 전사문 ──Claude(구조화 JSON)──▶ summary.md
                                              └▶ diagram.mmd ──▶ FigJam
```

## 설치

```bash
pip install -r requirements.txt
export OPENAI_API_KEY=...      # 전사(whisper)
export ANTHROPIC_API_KEY=...   # 요약(claude-opus-5)
brew install ffmpeg
```

## 사용

```bash
python meetnote.py 회의.mp3 -o out/
python meetnote.py x.mp3 --transcript out/transcript.txt   # 전사 재사용(비용 절약)
```

`out/`에 `transcript.txt`, `summary.json`, `summary.md`, `diagram.mmd`가 생긴다.

## 테스트용 샘플 만들기

실제 회의가 없을 때, macOS `say`로 가짜 회의 오디오를 만든다.

```bash
say -v Yuna -o samples/sample.aiff -f samples/sample.txt
ffmpeg -y -i samples/sample.aiff samples/sample.mp3
python meetnote.py samples/sample.mp3
```

변환 로직만 확인: `python test_meetnote.py`

## FigJam으로 내보내기

`out/diagram.mmd`는 mermaid 플로우차트다.

- **메인 주제 흐름** = 굵은 화살표(`==>`)로 이어진 세로 축
- **개별 의견** = 각 주제에서 점선(`-.->`)으로 갈라지는 가지
- 도형/색으로 종류 구분: 결정 육각형(초록) · 할일 평행사변형(주황) · 질문 마름모(빨강) · 의견 둥근(파랑)

Claude Code에서 Figma MCP의 `generate_diagram`에 이 파일 내용을 넘기면 FigJam 보드가 생성된다.
(앱에서 자동으로 호출하는 건 다음 단계.)

## 로드맵

- [x] 1. mp3 → 전사 → 위계 요약 → mermaid 도식
- [ ] 2. FigJam 자동 생성 (Figma MCP 호출을 앱 안으로)
- [ ] 3. 크롬 익스텐션: 탭 오디오 녹음 + 정지 + export 대상 선택
- [ ] 4. 로컬 서버: 익스텐션 → 파이프라인 → 앱 열기
- [ ] 5. PPT / Word export
