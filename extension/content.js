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

  // 크롬은 PiP 창 높이를 자기 마음대로 줄인다(190 요청 -> 134). 그 안에 들어가는 레이아웃이어야 한다.
  const CSS = `
    :root { color-scheme: light dark; }
    body { margin:0; padding:10px; overflow:auto;
           font:12px/1.4 -apple-system,system-ui,sans-serif; background:#fff; color:#111; }
    @media (prefers-color-scheme: dark) { body { background:#1c1c1e; color:#eee; } }
    header { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:7px; }
    h1 { margin:0; font-size:10px; letter-spacing:.06em; text-transform:uppercase; opacity:.45; }
    #timer { font:600 15px/1 -apple-system,system-ui,sans-serif; font-variant-numeric:tabular-nums; }
    button { width:100%; padding:8px; border:1px solid #8884; border-radius:7px;
             background:#f1f1f3; color:inherit; font:inherit; cursor:pointer; }
    @media (prefers-color-scheme: dark) { button { background:#2d2d30; } }
    button:hover { filter:brightness(.95); }
    #rec { background:#e03131; color:#fff; border-color:#c92a2a; }
    #stop { background:#212529; color:#fff; border-color:#000; }
    .row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-bottom:5px; }
    .row button { padding:7px 2px; font-size:10px; line-height:1.35; }
    .hint { margin:0 0 5px; font-size:11px; opacity:.55; }
    .link { border:0; background:0; opacity:.55; font-size:11px; padding:3px; }
    .err { color:#e03131; font-size:11px; white-space:pre-wrap; margin:0 0 5px; }
    .hidden { display:none; }
  `;

  const HTML = `
    <header><h1>meetnote</h1><span id="timer"></span></header>
    <div id="idle"><button id="rec">● 이 탭 녹음</button></div>
    <div id="recording" class="hidden"><button id="stop">■ 정지</button></div>
    <div id="ready" class="hidden">
      <p class="hint">어디로 정리할까요?</p>
      <div class="row">
        <button data-t="figjam">🗺️<br>FigJam</button>
        <button data-t="ppt">📊<br>PPT</button>
        <button data-t="word">📄<br>Word</button>
      </div>
      <button class="link" data-r="1">↩︎ 다시 녹음</button>
    </div>
    <div id="sending" class="hidden"><p class="hint">보내는 중…</p></div>
    <div id="sent" class="hidden">
      <p class="hint">✅ 처리 중. 끝나면 자동으로 열립니다.</p>
      <button class="link" data-r="1">↩︎ 처음으로</button>
    </div>
    <div id="error" class="hidden">
      <p class="err" id="errmsg"></p><button class="link" data-r="1">↩︎ 처음으로</button>
    </div>
  `;

  const PANELS = ["idle", "recording", "ready", "sending", "sent", "error"];
  const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ to: "bg", cmd, ...extra });

  function build(w) {
    const d = w.document;
    d.head.appendChild(d.createElement("style")).textContent = CSS;
    d.body.innerHTML = HTML;
    const $ = (id) => d.getElementById(id);
    let tick = null;

    async function render() {
      const { state = "idle", startedAt, error } =
        await chrome.storage.session.get(["state", "startedAt", "error"]);
      PANELS.forEach((p) => $(p).classList.toggle("hidden", p !== state));
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
    }

    $("rec").onclick = () => send("start");
    $("stop").onclick = () => send("stop");
    d.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => send("export", { target: b.dataset.t })));
    d.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => send("reset")));

    chrome.storage.session.onChanged.addListener(render);
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
      "position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 14px;" +
      "border:0;border-radius:9px;background:#212529;color:#fff;cursor:pointer;" +
      "font:13px -apple-system,system-ui,sans-serif;box-shadow:0 4px 14px #0004";
    b.onclick = () => openPip().catch((e) => alert(`띄우기 실패: ${e.message}`));
    document.body.appendChild(b);
  }
})();
