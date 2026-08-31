// 회의 탭에 주입되어, 모든 앱 위에 뜨는 Document PiP 창에 컨트롤러를 그린다.
// PiP 문서는 페이지 소유지만 DOM을 만든 게 이 스크립트라, 여기 붙인 핸들러는
// 콘텐츠 스크립트 컨텍스트에서 돌고 chrome.* 를 그대로 쓸 수 있다.
(async () => {
  if (window.__meetnotePip) {
    try { window.__meetnotePip.focus(); } catch {}
    return;
  }
  if (!window.documentPictureInPicture) {
    alert("이 크롬은 Document Picture-in-Picture를 지원하지 않습니다 (크롬 116+ 필요).");
    return;
  }

  const SERVER = "http://127.0.0.1:8787";

  // 크롬은 PiP 창 높이를 자기 마음대로 줄인다(190 요청 -> 134). 그 안에 들어가는 레이아웃이어야 한다.
  // 배경이 비치지 않는 독립 창이라 유리 질감은 자체 그라디언트를 blur해서 만든다.
  const CSS = `
    * { box-sizing:border-box; }
    :root { color-scheme: dark; }
    body {
      margin:0; padding:11px 12px; overflow:hidden; color:#fff;
      font:12px/1.4 -apple-system, "SF Pro Text", system-ui, sans-serif;
      -webkit-font-smoothing:antialiased;
      transition:background .55s ease;
      /* ::before + z-index:-1은 body 자기 배경 뒤로 숨는다. 배경에 직접 깐다. */
      background:
        radial-gradient(64% 74% at 18% 2%,   #4ade9a 0%, rgba(74,222,154,0) 64%),
        radial-gradient(70% 80% at 96% 18%,  #17a06a 0%, rgba(23,160,106,0) 62%),
        radial-gradient(88% 92% at 58% 108%, #0a5f47 0%, rgba(10,95,71,0) 70%),
        #0c2a20;
    }
    body.rec {
      background:
        radial-gradient(64% 74% at 16% 0%,   #ff8a70 0%, rgba(255,138,112,0) 64%),
        radial-gradient(70% 80% at 98% 20%,  #e63946 0%, rgba(230,57,70,0) 60%),
        radial-gradient(88% 92% at 54% 110%, #6d1b26 0%, rgba(109,27,38,0) 70%),
        #2b0f12;
    }
    body.done {
      background:
        radial-gradient(64% 74% at 14% 0%,   #8fcbff 0%, rgba(143,203,255,0) 64%),
        radial-gradient(70% 80% at 98% 18%,  #4b7bec 0%, rgba(75,123,236,0) 60%),
        radial-gradient(90% 94% at 62% 110%, #ffb37a 0%, rgba(255,179,122,0) 68%),
        #14203a;
    }

    header { display:flex; justify-content:space-between; align-items:center; margin-bottom:9px; }
    h1 { margin:0; font-size:9px; font-weight:600; letter-spacing:.13em; text-transform:uppercase; opacity:.62; }
    #timer { font:590 14px/1 "SF Pro Text", -apple-system, system-ui, sans-serif;
             font-variant-numeric:tabular-nums; letter-spacing:.02em; opacity:.95; }

    /* 유리: 반투명 + 뒤 그라디언트 blur + 위쪽 1px 하이라이트 */
    .glass {
      background:rgba(255,255,255,.13);
      backdrop-filter:blur(22px) saturate(180%);
      -webkit-backdrop-filter:blur(22px) saturate(180%);
      border:.5px solid rgba(255,255,255,.30);
      box-shadow:inset 0 .5px 0 rgba(255,255,255,.42), 0 5px 18px rgba(0,0,0,.30);
    }
    button {
      width:100%; border-radius:999px; color:#fff; font:inherit; cursor:pointer;
      padding:9px 12px; font-weight:530; letter-spacing:-.01em;
      transition:background .18s ease, transform .12s ease;
    }
    button:hover { background:rgba(255,255,255,.22); }
    button:active { transform:scale(.97); }

    #rec { display:flex; align-items:center; gap:9px; justify-content:flex-start;
           background:rgba(255,255,255,.11); margin-bottom:6px; }
    #rec .dot { width:22px; height:22px; border-radius:999px; flex:0 0 22px;
                background:#ff4d4d; box-shadow:0 0 0 .5px rgba(255,255,255,.5), 0 2px 8px rgba(255,0,0,.45); }
    #add { display:flex; align-items:center; gap:9px; justify-content:flex-start;
           background:rgba(255,255,255,.08); font-size:11px; }
    #add .plus { width:22px; height:22px; border-radius:999px; flex:0 0 22px;
                 display:grid; place-items:center; font-size:15px; font-weight:400; line-height:1;
                 background:#30d158; color:#04240f;
                 box-shadow:0 0 0 .5px rgba(255,255,255,.45), 0 2px 8px rgba(48,209,88,.45); }
    #stop { background:rgba(255,255,255,.16); }

    #wave { display:flex; align-items:center; justify-content:center; gap:4px;
            height:30px; margin:2px 0 8px; }
    #wave i { width:4px; height:4px; border-radius:999px; background:rgba(255,255,255,.9);
              box-shadow:0 0 8px rgba(255,255,255,.45); transition:height .14s ease-out; }

    .row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-bottom:6px; }
    .row button { padding:8px 2px; border-radius:15px; font-size:10px; line-height:1.3; font-weight:500; }
    .row .ico { display:block; font-size:14px; margin-bottom:2px; }

    .hint { margin:0 0 7px; font-size:10.5px; opacity:.62; letter-spacing:.01em; }
    .link { border:0; background:0; box-shadow:none; backdrop-filter:none; opacity:.6;
            font-size:10.5px; padding:3px; }
    .link:hover { background:rgba(255,255,255,.10); opacity:.9; }
    .err { color:#ffd0cb; font-size:10.5px; white-space:pre-wrap; margin:0 0 6px;
           max-height:56px; overflow:auto; }
    .hidden { display:none; }
    body.drag::after {
      content:"놓으면 추가됩니다"; position:fixed; inset:6px; border-radius:16px;
      border:1.5px dashed rgba(255,255,255,.7); background:rgba(0,0,0,.34);
      display:grid; place-items:center; font-size:11px; letter-spacing:.01em;
    }
  `;

  const HTML = `
    <header><h1>meetnote</h1><span id="timer"></span></header>
    <div id="idle">
      <button id="rec" class="glass"><span class="dot"></span>이 탭 녹음</button>
      <button id="add" class="glass"><span class="plus">+</span>회의 내용 추가</button>
      <input type="file" id="file" accept=".txt,.md,.mp3,.m4a,.wav,.webm,audio/*" hidden>
    </div>
    <div id="recording" class="hidden">
      <div id="wave"><i></i><i></i><i></i><i></i><i></i></div>
      <button id="stop" class="glass">■&nbsp; 정지</button>
    </div>
    <div id="ready" class="hidden">
      <p class="hint">어디로 정리할까요?</p>
      <div class="row">
        <button class="glass" data-t="figjam"><span class="ico">🗺️</span>FigJam</button>
        <button class="glass" data-t="ppt"><span class="ico">📊</span>PPT</button>
        <button class="glass" data-t="word"><span class="ico">📄</span>Word</button>
      </div>
      <button class="link" data-r="1">↩︎ 다시</button>
    </div>
    <div id="sending" class="hidden"><p class="hint">보내는 중…</p></div>
    <div id="sent" class="hidden">
      <p class="hint">✅ 처리 중입니다.<br>끝나면 데스크탑에서 자동으로 열립니다.</p>
      <button class="link" data-r="1">↩︎ 처음으로</button>
    </div>
    <div id="error" class="hidden">
      <p class="err" id="errmsg"></p><button class="link" data-r="1">↩︎ 처음으로</button>
    </div>
  `;

  const PANELS = ["idle", "recording", "ready", "sending", "sent", "error"];
  const BG = { recording: "rec", ready: "done", sending: "done", sent: "done" };
  const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ to: "bg", cmd, ...extra });
  const setState = (state, extra = {}) => chrome.storage.session.set({ state, ...extra });

  // 콘텐츠 스크립트의 fetch는 페이지 출처로 나간다. 서버가 CORS를 열어둬서 그대로 통한다.
  async function uploadFile(f, target) {
    const ext = (f.name.split(".").pop() || "mp3").toLowerCase();
    await setState("sending");
    try {
      const r = await fetch(`${SERVER}/upload?target=${target}&ext=${ext}`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f,
      });
      if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
      await setState("sent");
    } catch (e) {
      await setState("error", { error: `${e.message}\n로컬 서버가 떠 있나요?\npython server.py` });
    }
  }

  function build(w) {
    const d = w.document;
    d.head.appendChild(d.createElement("style")).textContent = CSS;
    d.body.innerHTML = HTML;
    const $ = (id) => d.getElementById(id);
    let tick = null;
    let pendingFile = null; // 파일을 고른 뒤 export 대상을 고를 때까지 들고 있는다
    const bars = [...d.querySelectorAll("#wave i")];
    const SHAPE = [0.55, 0.85, 1, 0.8, 0.5];
    const paintLevel = (l = 0) =>
      bars.forEach((b, i) => (b.style.height = `${Math.round(4 + (l || 0) * 0.24 * SHAPE[i])}px`));

    async function render() {
      const { state = "idle", startedAt, error } =
        await chrome.storage.session.get(["state", "startedAt", "error"]);
      PANELS.forEach((p) => $(p).classList.toggle("hidden", p !== state));
      d.body.className = BG[state] || "";
      clearInterval(tick);
      $("timer").textContent = "";
      if (state === "recording") {
        const paint = () => {
          const s = Math.floor((Date.now() - startedAt) / 1000);
          $("timer").textContent =
            `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
        };
        paint();
        tick = setInterval(paint, 500);
      }
      if (state === "error") $("errmsg").textContent = error || "알 수 없는 오류";
      if (state === "idle") pendingFile = null;
    }

    $("rec").onclick = () => send("start");
    $("stop").onclick = () => send("stop");
    $("add").onclick = () => $("file").click();
    $("file").onchange = (e) => {
      pendingFile = e.target.files[0];
      if (pendingFile) setState("ready");
    };
    d.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => {
      // 녹음분이면 offscreen이, 파일이면 여기서 직접 올린다
      pendingFile ? uploadFile(pendingFile, b.dataset.t) : send("export", { target: b.dataset.t });
    }));
    d.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { pendingFile = null; send("reset"); }));

    // 창에 파일을 떨궈도 추가된다
    d.body.addEventListener("dragover", (e) => { e.preventDefault(); d.body.classList.add("drag"); });
    d.body.addEventListener("dragleave", () => d.body.classList.remove("drag"));
    d.body.addEventListener("drop", (e) => {
      e.preventDefault();
      d.body.classList.remove("drag");
      const f = e.dataTransfer.files[0];
      if (f) { pendingFile = f; setState("ready"); }
    });

    // 레벨은 200ms마다 바뀐다. 그때마다 전체를 다시 그리면 타이머까지 재설정된다.
    chrome.storage.session.onChanged.addListener((ch) => {
      if (ch.level && !ch.state) return paintLevel(ch.level.newValue);
      if (ch.level) paintLevel(ch.level.newValue);
      render();
    });
    w.addEventListener("pagehide", () => { clearInterval(tick); window.__meetnotePip = null; });
    render();
  }

  async function openPip() {
    const w = await documentPictureInPicture.requestWindow({ width: 240, height: 150 });
    window.__meetnotePip = w;
    build(w);
    document.getElementById("__meetnote-launch")?.remove();
  }

  try {
    await openPip();
  } catch {
    // requestWindow는 "이 페이지에서의" 사용자 클릭을 요구한다.
    // 익스텐션 아이콘 클릭은 그 활성화를 물려주지 못하므로, 페이지에 버튼 하나를 놓는다.
    if (document.getElementById("__meetnote-launch")) return;
    const b = document.createElement("button");
    b.id = "__meetnote-launch";
    b.textContent = "🖥 meetnote 띄우기";
    b.style.cssText =
      "position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:11px 16px;" +
      "border:.5px solid rgba(255,255,255,.3);border-radius:999px;color:#fff;cursor:pointer;" +
      "background:rgba(20,30,25,.72);backdrop-filter:blur(20px) saturate(180%);" +
      "font:13px -apple-system,system-ui,sans-serif;box-shadow:0 6px 22px #0006";
    b.onclick = () => openPip().catch((e) => alert(`띄우기 실패: ${e.message}`));
    document.body.appendChild(b);
  }
})();
