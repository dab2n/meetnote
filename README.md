# meetnote

회의 오디오를 **위계와 핵심** 중심 문서로 정리하고, FigJam 도식으로 뽑는 도구.

최종 목표: 크롬 익스텐션으로 회의 녹음 → 정지 → export 대상(FigJam/PPT/Word) 선택 → 데스크탑 앱이 실행.
```
크롬 익스텐션(탭 오디오 녹음) ─▶ 로컬 서버 :8787 ─▶ whisper 전사 ─▶ Claude 구조화 요약
                                                                   ├▶ FigJam 도식(mermaid)
                                                                   ├▶ summary.pptx
                                                                   └▶ summary.docx  → 데스크탑에서 자동 실행
```

## 설치

```bash
pip install -r requirements.txt
export OPENAI_API_KEY=...      # 전사(whisper)
export ANTHROPIC_API_KEY=...   # 요약(claude-opus-5)
brew install ffmpeg
```

## 1) 크롬 익스텐션으로 쓰기

```bash
python server.py     # 먼저 로컬 서버를 띄운다
```

`chrome://extensions` → 우측 상단 **개발자 모드** 켜기 → **압축해제된 확장 프로그램을 로드** → 이 레포의 `extension/` 폴더 선택.

툴바 퍼즐 아이콘 → meetnote 옆 **핀**을 누르면 툴바에 고정된다.
웹스토어에서 받은 게 아니라 크롬이 "출처를 확인할 수 없습니다" 경고를 띄우는데, 정상이다.

회의 중인 탭(Google Meet, Zoom 웹 등)에서 툴바의 meetnote 아이콘 클릭 →
**🖥 데스크탑에 띄우기**를 누르면 모든 앱 위에 뜨는 작은 창(Document Picture-in-Picture)이 나온다.

1. **● 녹음** — 해당 탭의 오디오를 캡처한다 (스피커로도 계속 들린다)
2. **■ 정지**
3. **FigJam / PPT / Word** 중 선택 → 서버로 전송

**＋ 회의 내용 추가** — 녹음 대신 이미 있는 파일로도 된다.
버튼을 누르거나 창에 파일을 그냥 떨구면 된다.

| 넣는 것 | 처리 |
|---|---|
| `.mp3` `.m4a` `.wav` `.webm` | whisper로 전사한 뒤 요약 |
| `.txt` `.md` | 이미 전사된 회의록으로 보고 전사를 건너뜀 |

크롬을 내려도, 다른 앱을 띄워도 이 창은 위에 남는다. 대신 **녹음 중인 탭은 열어둬야 한다**
(탭이 닫히면 PiP 창도 같이 닫힌다).

> 크롬 보안 정책상 PiP 창은 **그 페이지에서의 실제 클릭**으로만 열 수 있다.
> 익스텐션 아이콘 클릭은 그 권한을 물려주지 못해서, 안 열리면 페이지 우하단에
> `🖥 meetnote 띄우기` 버튼이 대신 나타난다. 그걸 누르면 열린다.

전사·요약은 몇 분 걸리므로 서버가 백그라운드로 돌리고, 끝나면 결과물을 데스크탑에서 자동으로 연다.

## 2) CLI로 쓰기 (mp3 테스트)

```bash
python meetnote.py 회의.mp3 -t word --open
python meetnote.py x.mp3 --transcript out/transcript.txt   # 전사 재사용(비용 절약)
```

`out/`에 `transcript.txt`, `summary.json`, `summary.md` + target별 산출물이 생긴다.

## 파일 구성

| | |
|---|---|
| `meetnote.py` | 전사 · 요약 · export (CLI 겸용) |
| `server.py` | 익스텐션이 던진 오디오를 받아 파이프라인 실행 + 결과물 열기 |
| `extension/` | 크롬 MV3 익스텐션 |
| ↳ `content.js` | 데스크탑 위에 뜨는 PiP 컨트롤러 (파일 추가 · 오디오 레벨) |
| ↳ `offscreen.js` | 실제 녹음 (MediaRecorder) |

녹음은 offscreen 문서가 담당한다. 팝업은 닫히면 죽기 때문에 거기서 녹음을 들고 있을 수 없다.

## 테스트용 샘플 만들기

실제 회의가 없을 때, macOS `say`로 가짜 회의 오디오를 만든다.

```bash
say -v Yuna -o samples/sample.aiff -f samples/sample.txt
ffmpeg -y -i samples/sample.aiff samples/sample.mp3
python meetnote.py samples/sample.mp3
```

예시 결과물은 `samples/summary.md`, `samples/diagram.mmd` 참고.

변환 로직만 확인: `python test_meetnote.py`

## FigJam으로 내보내기

`out/diagram.mmd`는 mermaid 플로우차트다.

- **메인 주제 흐름** = 굵은 화살표(`==>`)로 이어진 세로 축
- **개별 의견** = 각 주제에서 점선(`-.->`)으로 갈라지는 가지
- 도형/색으로 종류 구분: 결정 육각형(초록) · 할일 평행사변형(주황) · 질문 마름모(빨강) · 의견 둥근(파랑)

FigJam 보드를 API로 직접 만드는 방법은 없어서(Figma REST는 파일 내용 쓰기를 지원하지 않음), 현재는 두 경로다.

- **앱**: `mermaid.live` 편집기를 열어준다 → SVG/PNG로 받아 FigJam에 붙여넣기
- **Claude Code**: Figma MCP의 `generate_diagram`에 `diagram.mmd` 내용을 넘기면 FigJam 보드가 바로 생성된다

## 로드맵

- [x] 1. mp3 → 전사 → 위계 요약 → mermaid 도식
- [x] 2. 크롬 익스텐션: 탭 오디오 녹음 + 정지 + export 대상 선택
- [x] 3. 로컬 서버: 익스텐션 → 파이프라인 → 결과물 자동 실행
- [x] 4. PPT / Word export
- [ ] 5. FigJam 보드 직접 생성 (지금은 mermaid.live를 열어 SVG로 받아 붙이는 경로)
- [x] 6. 데스크탑 위에 띄우는 PiP 컨트롤러
- [x] 7. 파일로 회의 추가 (mp3 · txt)
- [ ] 8. 실시간 요약 (녹음 중 중간 전사)
- [ ] 9. 2시간 초과 오디오 분할 전사
