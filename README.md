# meetnote

회의 오디오를 **위계와 핵심** 중심 문서로 정리하고, FigJam 도식으로 뽑는 도구.

최종 목표: 크롬 익스텐션으로 회의 녹음 → 정지 → export 대상(FigJam/PPT/Word) 선택 → 데스크탑 앱이 실행.
```
크롬 익스텐션(탭 오디오 녹음) ─▶ 로컬 서버 :8787 ─▶ whisper 전사 ─▶ Claude 구조화 요약
                                                                   ├▶ FigJam 도식(mermaid)
                                                                   ├▶ summary.pptx
                                                                   └▶ summary.docx  → 데스크탑에서 자동 실행
```

## 전사·요약은 뭘 쓰나

| 단계 | 무엇 | API 키 |
|---|---|---|
| 전사 | macOS 26 온디바이스 `SpeechAnalyzer` (한국어) | **불필요** |
| 요약 | Claude `claude-opus-5` (위계·핵심 JSON 스키마 강제) | `ANTHROPIC_API_KEY` **필요** |

전사는 기기 안에서 돌아서 공짜고 오디오가 밖으로 안 나간다. 길이 제한도 없다.
앱 번들이 없으면 OpenAI Whisper로 넘어가지만(`pip install openai` + `OPENAI_API_KEY`),
평소엔 쓸 일이 없다.

## 설치

```bash
pip install -r requirements.txt
export OPENAI_API_KEY=...      # 전사(whisper)
export ANTHROPIC_API_KEY=...   # 요약(claude-opus-5)
brew install ffmpeg
```

## 1) 쓰는 법

처음 한 번만 빌드한다.

```bash
cd ~/projects/meetnote && ./pin.sh
```

그러면 **바탕화면에 `meetnote` 아이콘**이 생긴다. 이후로는 터미널이 필요 없다.

- **바탕화면 아이콘 더블클릭** → 서버까지 알아서 켜지고 패널이 화면 우상단에 뜬다
- Dock에 끌어다 놓으면 Dock에서도 켤 수 있다
- 패널의 **✕** → 패널만 닫힌다. 아이콘을 다시 누르면 그 자리에 돌아온다

쓰는 순서는 이렇다.

1. **녹음 시작** (또는 **회의 파일**로 이미 있는 mp3·txt 넣기)
2. 회의 끝나면 **정지**
3. **FigJam / PPT / Word** 중 선택 → 어디에 만들지 확인 → **정리 시작**
4. 진행률(전사 → 요약 → 문서)을 보다가, 끝나면 결과물이 자동으로 열린다
5. 지난 회의는 **지난 회의 기록**에서 다시 연다

## 2) 크롬 툴바에서 켜고 끄기

`chrome://extensions` → **개발자 모드** 켜기 → **압축해제된 확장 프로그램을 로드** → `extension/` 선택.
툴바 퍼즐 아이콘 → meetnote 옆 **핀**을 눌러 툴바에 고정한다.
웹스토어를 안 거쳐서 크롬이 "출처를 확인할 수 없습니다" 경고를 띄우는데, 정상이다.

- **툴바 아이콘 클릭** → 패널이 뜬다 (이미 떠 있으면 그대로)
- **패널의 ✕** → 패널만 닫힌다. 서버는 남아 있어서 아이콘으로 다시 부를 수 있다

확장은 네이티브 앱을 직접 못 켠다. 그래서 이미 떠 있는 로컬 서버에게
`POST /show`로 부탁하고, 서버가 앱을 띄운다. 네이티브 메시징 호스트를 크롬 프로필에
설치하는 것보다 훨씬 싸다. 서버가 꺼져 있으면 켜는 법을 안내하는 탭이 열린다.

> 탭 오디오 녹음(`tabCapture`)은 뺐다. 패널이 시스템 오디오를 통째로 잡으니 탭 소리도
> 그대로 들어오고, `tabCapture`는 툴바 아이콘 **실물 클릭**으로 activeTab이 부여돼야만
> 열려서 패널에서 켤 수도 없었다. 확장은 이제 스위치 하나짜리다.

## 3) 패널

```bash
./pin.sh
```

264px 폭 글라스 패널이 화면 오른쪽 위에 붙어서, 어떤 앱·어떤 데스크탑 위에도 항상 떠 있다.
서버가 안 떠 있으면 같이 띄운다.

- **녹음 시작** — 시스템 오디오(상대방 목소리) + 마이크(내 목소리)를 한 파일로 섞어 녹음
- **진행률** — 전사 → 요약 → 문서 만들기 3단계를 링과 %로 표시
- **대상 확인** — FigJam/PPT/Word를 고르면 어느 경로에 만들지 먼저 보여준다.
  FigJam은 붙여넣을 보드 URL을 같이 받아 결과와 함께 열어준다 (다음에 기억한다)
- **🗂 지난 회의 기록** — 전사문·요약·산출물을 클릭해서 바로 연다
- **회의 파일** — mp3 · m4a · wav · txt · md 를 고른다. 창에 끌어다 놓아도 된다
- 정지하면 FigJam / PPT / Word 중에 고르고, 끝나면 데스크탑에서 자동으로 열린다
- 우상단 점은 로컬 서버 생사. 창 높이는 내용에 맞춰 늘었다 줄었다 한다
- **✕** — 패널을 닫는다. 툴바 아이콘으로 다시 띄운다
- **헤더(⠿ meetnote 줄)를 끌면** 원하는 자리로 옮겨진다. 옮긴 자리는 기억하고,
  창 높이가 바뀌어도 그 자리에서 아래로만 자란다. **헤더를 더블클릭하면 기본 위치(우상단)로 복귀**

### 권한

첫 녹음 때 두 가지를 묻는다.

| 권한 | 없으면 | 주는 곳 |
|---|---|---|
| 마이크 | 내 목소리가 안 들어감 | 첫 실행 시 프롬프트 → 허용 |
| 화면 기록 | 상대방 목소리가 안 들어감 (macOS는 시스템 오디오를 여기 묶어놨다) | **수동 추가** (아래) |

화면 기록은 애드혹 서명 앱이라 macOS가 프롬프트를 띄우지 않는다. 직접 추가해야 한다.

1. 시스템 설정 → 개인정보 보호 및 보안 → **화면 및 시스템 오디오 기록**
2. 목록 아래 **+** → `~/projects/meetnote/meetnote.app` 선택 (또는 파인더에서 끌어다 놓기)
3. 스위치 켜기 → `./pin.sh` 로 다시 띄우기

패널의 **권한 열기 →** 가 이 설정 창을 바로 연다.
권한이 없어도 녹음은 되고, 뭐가 빠졌는지 패널이 알려준다.

> `pin.swift`를 고쳐 다시 빌드하면 애드혹 서명 해시가 바뀌어 이 권한이 풀린다. 그때는 다시 켜주면 된다.

로그인할 때 자동으로 띄우려면:

```bash
sed "s|__DIR__|$PWD|" com.meetnote.pin.plist > ~/Library/LaunchAgents/com.meetnote.pin.plist
launchctl load ~/Library/LaunchAgents/com.meetnote.pin.plist
```

**왜 익스텐션이 아니라 네이티브 창인가**
크롬 Document PiP는 위치를 지정할 수 없고(`moveTo`가 무시된다), 크롬을 재시작하면
우하단으로 돌아가며, 탭이 닫히면 같이 죽는다. 그리고 `chrome.tabCapture`는 툴바
아이콘을 **실제로 클릭**해서 `activeTab`이 부여돼야만 열려서, 패널에서 원격으로 켤 수 없다.
그래서 녹음까지 네이티브로 옮겼고, 덕분에 Zoom 데스크탑 앱처럼 브라우저 밖 회의도 녹음된다.
익스텐션은 "이 탭만" 녹음하고 싶을 때 쓰는 별도 경로로 남겨뒀다.

## 4) CLI로 쓰기 (mp3 테스트)

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
| `pin.swift` / `pin.sh` | 우상단 고정 항상-위 패널 + 녹음 (AppKit · ScreenCaptureKit · AVAudioEngine) |
| `panel.html` | 그 패널이 띄우는 UI (`/panel`로 서빙) |
| `extension/` | 크롬 MV3 익스텐션 — 툴바 아이콘으로 패널을 띄우는 스위치 |

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
- [x] 7-1. 우상단 고정 네이티브 패널 + 시스템오디오·마이크 녹음 (macOS)
- [ ] 8. 실시간 요약 (녹음 중 중간 전사)
- [ ] 9. 2시간 초과 오디오 분할 전사
