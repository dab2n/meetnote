/* 회의 중인 웹페이지 위에 뜨는 패널.
 *
 *   접힘 : 녹음 중인지 · 얼마나 지났는지 · 지금 소리가 들어오는지
 *   펼침 : 지금까지 다룬 큰 주제의 흐름을 노드로
 *
 * 여기서는 큰 흐름만 그린다. 쟁점·주장·반론까지 들어간 정식 회의록은
 * 회의가 끝난 뒤 전사문을 로컬 서버로 넘겨서 만든다.
 *
 * 한계 두 가지를 먼저 적어 둔다.
 *  - 인식은 브라우저 음성 인식(Web Speech)이라 이 컴퓨터의 마이크만 듣는다.
 *    상대방 목소리는 스피커로 나와 마이크에 잡히는 만큼만 들어온다.
 *  - 크롬의 Web Speech는 인식을 위해 음성을 구글 서버로 보낸다.
 */
(() => {
  const ID = "meetnote-floating-panel";
  const old = document.getElementById(ID);
  if (old) { old.remove(); return; }               // 툴바 아이콘 = 열고 닫는 스위치

  const SERVER = "http://127.0.0.1:8787";
  const host = document.createElement("div");
  host.id = ID;
  const sh = host.attachShadow({ mode: "open" });
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("panel.css");
  sh.append(link);
  document.documentElement.append(host);

  const root = document.createElement("div");
  root.className = "mn idle";
  root.innerHTML = `
    <div class="bar" part="bar">
      <span class="dot"></span>
      <span class="tm">0:00</span>
      <span class="lv"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="st">준비됨</span>
      <span class="sp"></span>
      <button class="go">● 녹음</button>
      <button class="fold" title="펼치기">⌄</button>
    </div>
    <div class="body">
      <div class="head"><b>논의 흐름</b><span class="cnt"></span></div>
      <div class="flow"><div class="empty">녹음을 시작하면 다루는 주제가 바뀔 때마다 여기에 쌓입니다.</div></div>
      <div class="live">듣고 있는 말이 여기에 뜹니다.</div>
      <div class="acts">
        <button class="save" disabled>전사문 저장</button>
        <button class="send pri" disabled>회의록 만들기</button>
      </div>
      <div class="msg"></div>
    </div>`;
  sh.append(root);

  const $ = s => root.querySelector(s);
  const bars = [...root.querySelectorAll(".lv i")];
  const mmss = t => `${(t / 60) | 0}:${String((t | 0) % 60).padStart(2, "0")}`;

  /* ---------- 접기 ---------- */
  let open = false;
  const fold = () => {
    open = !open;
    root.classList.toggle("open", open);
    $(".fold").textContent = open ? "⌃" : "⌄";
    $(".fold").title = open ? "접기" : "펼치기";
  };
  $(".fold").onclick = fold;

  /* ---------- 끌어서 옮기기 ---------- */
  (() => {
    let drag = null;
    $(".bar").addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      const r = root.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
      $(".bar").setPointerCapture(e.pointerId);
    });
    $(".bar").addEventListener("pointermove", e => {
      if (!drag) return;
      const l = Math.max(6, Math.min(innerWidth - 330, drag.l + e.clientX - drag.x));
      const t = Math.max(6, Math.min(innerHeight - 60, drag.t + e.clientY - drag.y));
      root.style.left = l + "px"; root.style.top = t + "px";
      root.style.right = "auto"; root.style.bottom = "auto";
    });
    ["pointerup", "pointercancel"].forEach(ev => $(".bar").addEventListener(ev, () => (drag = null)));
  })();

  /* ---------- 주제 나누기 ----------
     새 주제는 "앞 주제에 없던 말이 몰릴 때" 열린다. 요약이 아니라
     그 구간에서 실제로 많이 나온 단어를 이름으로 쓴다. 지어내지 않기 위해서다. */
  const STOP = new Set(`그래서 그러니까 그런데 저는 우리 이제 진짜 약간 뭔가 그냥 이런 저런 그거 이거
    부분 생각 얘기 말씀 정도 경우 지금 다음 조금 여기 저기 사람 문제 필요 가지 대해 위해 통해 라서
    같아요 있어요 합니다 습니다 거는 건데 근데 아니 그건 그게 이게 저게 하나 사실 어떻게 뭐지`
    .split(/\s+/).filter(Boolean));
  const tok = s => (s.match(/[가-힣]{2,}|[A-Za-z]{3,}/g) || [])
    .map(w => w.replace(/(입니다|습니다|에서|으로|하고|한테|까지|부터|이랑|는데|라고|해서|이고|에게|하는|이런|그런|같은|것도|것을|이라|라는)$/, ""))
    .filter(w => w.length > 1 && !STOP.has(w));

  const topics = [];
  function label(tp) {
    const top = [...tp.words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
    return top.length ? top.join(" · ") : "…";
  }
  function feed(text, t) {
    const ws = tok(text);
    if (!ws.length) return;
    const cur = topics[topics.length - 1];
    let fresh = !cur;
    if (cur) {
      const hit = ws.filter(w => cur.words.has(w)).length;
      const novel = 1 - hit / ws.length;
      // 주제가 충분히 굴러갔고, 새 어휘가 몰리면 다음 주제로 넘어간 것으로 본다
      fresh = cur.n >= 4 && t - cur.t > 50 && ws.length >= 4 && novel > .78;
    }
    const tp = fresh ? (topics.push({ t, words: new Map(), n: 0 }), topics[topics.length - 1]) : cur;
    ws.forEach(w => {
      // "컬러는"과 "컬러가"를 따로 세지 않는다. 두 글자 이상 남을 때만 조사를 뗀다
      // ("회의" → "회"처럼 뭉개지는 것을 막는다).
      const stem = w.replace(/(은|는|이|가|을|를|의|도|만|과|와|랑)$/, "");
      const k = stem.length >= 2 ? stem : w;
      tp.words.set(k, (tp.words.get(k) || 0) + 1);
    });
    tp.n++;
    tp.label = label(tp);
    drawFlow();
  }
  function drawFlow() {
    const w = $(".flow");
    if (!topics.length) return;
    w.innerHTML = topics.map((tp, i) =>
      `<div class="tp${i === topics.length - 1 ? " now" : ""}">
         <b>${tp.label.replace(/[<>&]/g, "")}</b><i>${mmss(tp.t)}부터 · 발언 ${tp.n}</i>
       </div>`).join("");
    $(".cnt").textContent = `주제 ${topics.length}개`;
    w.scrollTop = w.scrollHeight;
  }

  /* ---------- 녹음 · 인식 ---------- */
  let rec = null, stream = null, ac = null, t0 = 0, tick = null, sr = null, want = false;
  const said = [];                       // {t, text} — 확정된 발언만
  const chunks = [];

  const setStatus = (s, warn) => { $(".st").textContent = s; $(".msg").className = "msg" + (warn ? " warn" : ""); };
  const say = (m, warn) => { $(".msg").textContent = m || ""; $(".msg").className = "msg" + (warn ? " warn" : ""); };

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch (e) {
      say("마이크를 열지 못했습니다. 주소창 왼쪽 자물쇠에서 이 사이트의 마이크 권한을 허용해 주세요.", true);
      if (!open) fold();
      return;
    }
    want = true; t0 = Date.now();
    root.className = "mn rec" + (open ? " open" : "");
    $(".go").textContent = "■ 정지";
    setStatus("듣는 중");
    say("");
    $(".live").textContent = "…";

    rec = new MediaRecorder(stream);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.start(4000);

    meter();
    listen();
    tick = setInterval(() => { $(".tm").textContent = mmss((Date.now() - t0) / 1000); }, 500);
  }

  function meter() {
    ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    (function loop() {
      if (!want) return;
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i += 4) peak = Math.max(peak, Math.abs(buf[i] - 128));
      const v = Math.min(1, peak / 46);
      bars.forEach((b, i) => {
        const s = [.55, .8, 1, .8, .55][i];
        b.style.height = (2 + v * s * 11).toFixed(1) + "px";
      });
      requestAnimationFrame(loop);
    })();
  }

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { say("이 브라우저는 실시간 인식을 지원하지 않습니다. 녹음은 그대로 됩니다.", true); return; }
    sr = new SR();
    sr.lang = "ko-KR";
    sr.continuous = true;
    sr.interimResults = true;
    sr.onresult = e => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript.trim();
        if (!txt) continue;
        if (e.results[i].isFinal) {
          const t = (Date.now() - t0) / 1000;
          said.push({ t, text: txt });
          feed(txt, t);
        } else live += txt + " ";
      }
      const el = $(".live");
      el.textContent = live.trim() || (said.length ? said[said.length - 1].text : "…");
      el.classList.toggle("on", !!live.trim());
    };
    sr.onerror = e => {
      if (e.error === "not-allowed") say("음성 인식 권한이 막혀 있습니다. 녹음은 계속됩니다.", true);
      if (e.error === "network") say("인식 서버에 닿지 못했습니다. 녹음은 계속됩니다.", true);
    };
    sr.onend = () => { if (want) { try { sr.start(); } catch {} } };  // 조용하면 알아서 끊긴다
    try { sr.start(); } catch {}
  }

  function stop() {
    want = false;
    clearInterval(tick);
    if (sr) { sr.onend = null; try { sr.stop(); } catch {} }
    if (rec && rec.state !== "inactive") rec.stop();
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (ac) ac.close();
    root.className = "mn" + (open ? " open" : "");
    $(".go").textContent = "● 녹음";
    setStatus(said.length ? `${said.length}개 발언 · 주제 ${topics.length}개` : "인식된 말이 없습니다");
    bars.forEach(b => (b.style.height = "2px"));
    $(".save").disabled = $(".send").disabled = !said.length;
    if (!said.length) say("마이크에 소리가 들어오지 않았습니다. 상대 목소리는 스피커로 나와야 잡힙니다.", true);
    else if (!open) fold();
  }

  $(".go").onclick = () => (want ? stop() : start());

  /* ---------- 넘기기 ----------
     뷰어와 ibis.py가 읽는 형식 그대로 만든다: "화자 0:00" 줄 + 발언 줄.
     브라우저 인식은 화자를 나누지 못해서 이름은 하나로 둔다. */
  function transcript() {
    let out = "", last = -99;
    said.forEach(s => {
      if (s.t - last >= 20) { out += `\n\n화자 ${mmss(s.t)}\n`; last = s.t; }
      else out += " ";
      out += s.text;
    });
    return out.trim() + "\n";
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");

  $(".save").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([transcript()], { type: "text/plain;charset=utf-8" }));
    a.download = `meetnote-${stamp()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say("저장했습니다. meetnote 뷰어에 그대로 넣으면 원문이 열립니다.");
  };

  $(".send").onclick = async () => {
    say("데스크탑으로 넘기는 중…");
    try {
      const r = await fetch(`${SERVER}/upload?target=word&ext=txt`, {
        method: "POST", body: new Blob([transcript()], { type: "text/plain" }),
      });
      if (!r.ok) throw new Error(r.status);
      say("넘겼습니다. 정리가 끝나면 회의록 뷰어에 이 회의가 올라옵니다.");
    } catch {
      say("로컬 서버(127.0.0.1:8787)가 꺼져 있습니다. ./pin.sh 로 켜거나 전사문을 저장해 두세요.", true);
    }
  };

  // 나중에 GUI를 다듬을 때 콘솔에서 바로 만져 보라고 열어 둔다
  host.mn = { root, topics, said, feed, transcript, fold, start, stop };

  addEventListener("beforeunload", () => { if (want) stop(); });
})();
