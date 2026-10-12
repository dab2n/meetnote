/* 시선 기록 — 웹캠으로 눈을 보고 '화면 어디를 보는지' 를 찍는다 (WebGazer).
   UT 태스크에 gaze:true 가 있으면 시작 전에 짧게 눈맞춤(보정)을 하고, 태스크가 도는 동안 20Hz 로 좌표를 남긴다.
   결과 보기(ut.html)에서 열지도·시선 경로·카드별 머문 시간으로 펼쳐 본다.

   ponytail: 웹캠 추정이라 오차가 ±100px 안팎이다. 카드 단위로 '어디를 읽었나' 를 보는 용도지 정밀 측정이 아니다.
   첫 실행 때 얼굴 모델을 인터넷에서 받는다(tfhub). 한 번 받으면 브라우저가 들고 있다. */
(function () {
  const G = window.GAZE = {};
  const RATE = 50;                      /* 20Hz — 2분이면 2,400점, 저장에 부담 없다 */
  let pts = null, t0 = 0, last = 0, loaded = false, running = false, armed = false;

  G.can = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  function css() {
    if (document.getElementById('gazecss')) return;
    const s = document.createElement('style');
    s.id = 'gazecss';
    s.textContent = `
      .gcal{position:fixed;inset:0;z-index:95;background:rgba(252,252,254,.97);
        display:grid;place-items:center;font:inherit}
      .gcal>p{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);
        display:grid;gap:8px;justify-items:center;text-align:center;font-size:17px;font-weight:600;color:#222a2a}
      .gcal>p i{font-style:normal;font-size:13px;font-weight:400;color:#757575}
      .gcal>p b{font-size:12px;font-weight:600;letter-spacing:.12em;color:#a3a3a3}
      .gskip{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);
        height:34px;padding:0 16px;border-radius:99px;background:rgba(255,255,255,.9);
        box-shadow:0 0 0 1px rgba(40,39,51,.1);font-size:12.5px;color:#757575;cursor:pointer}
      .gskip:hover{color:#222a2a;background:#fff}
      .gdot{position:absolute;z-index:97;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;
        background:#4b87e9;box-shadow:0 0 0 6px rgba(75,135,233,.18);cursor:pointer;
        display:grid;place-items:center;color:#fff;font-size:11px;font-weight:700;
        transition:transform .15s,opacity .3s}
      .gdot:hover{transform:scale(1.12)}
      .gdot.done{background:#cfd6e2;box-shadow:none;opacity:.5;pointer-events:none}
      /* 미리보기는 눈으로 보라고 띄우는 것뿐 — 어떤 버튼도 가로막지 않는다 */
      #webgazerVideoContainer{position:fixed!important;right:12px!important;bottom:12px!important;
        left:auto!important;top:auto!important;z-index:96;opacity:.85;border-radius:10px;overflow:hidden;
        pointer-events:none!important;transform-origin:100% 100%;transform:scale(.55)}
      /* 보정 중에는 위 가운데로 — 모서리 점을 가리지 않게 */
      body.gcal #webgazerVideoContainer{right:auto!important;left:50%!important;top:10px!important;bottom:auto!important;
        transform-origin:0 0;transform:scale(.5) translateX(-100%)}
      body.gazing #webgazerVideoContainer{opacity:.3}
      #webgazerFaceFeedbackBox{border-color:#4b87e9!important}`;
    document.head.append(s);
  }

  const load = () => loaded ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/webgazer.js';
    s.onload = () => { loaded = true; res(); };
    s.onerror = () => rej(new Error('webgazer 를 불러오지 못했습니다'));
    document.head.append(s);
  });

  /* 다섯 자리를 세 번씩 눌러 눈과 화면을 맞춘다 (누를 때 그 점을 보고 있어야 한다) */
  function calibrate() {
    return new Promise(res => {
      const d = document.createElement('div');
      d.className = 'gcal';
      d.innerHTML = `<p><b>시선 보정</b>점을 보면서 세 번씩 눌러 주세요<i>다섯 자리를 다 누르면 태스크가 시작됩니다</i></p>
        <button class="gskip">시선 기록 없이 진행</button>`;
      document.body.classList.add('gcal');
      const done = () => { document.body.classList.remove('gcal'); d.remove(); };
      d.querySelector('.gskip').onclick = () => { done(); res('skip'); };
      const spots = [[.08, .12], [.92, .12], [.5, .5], [.08, .88], [.92, .88]];
      let left = spots.length;
      spots.forEach(([fx, fy]) => {
        const b = document.createElement('button');
        b.className = 'gdot'; b.textContent = '3';
        b.style.left = fx * 100 + '%'; b.style.top = fy * 100 + '%';
        let n = 3;
        b.onclick = () => {
          b.textContent = --n || '';
          if (n) return;
          b.classList.add('done');
          if (--left === 0) { done(); res(); }
        };
        d.append(b);
      });
      document.body.append(d);
    });
  }

  /* 태스크 시작 전에 부른다 — 카메라를 켜고 보정까지 마친다 */
  G.ready = async function () {
    await load();
    await webgazer.setRegression('ridge').setTracker('TFFacemesh')
      .showVideoPreview(true).showPredictionPoints(false).begin();
    webgazer.showFaceOverlay(true);
    const how = await calibrate();
    webgazer.showFaceOverlay(false);
    if (how === 'skip') { G.off(); return false; }       /* 건너뛰면 카메라도 끈다 */
    armed = true;
    document.body.classList.add('gazing');
    return true;
  };

  /* 기록 시작 — 돌려주는 배열에 [경과ms, x, y] 가 쌓인다 */
  G.start = function () {
    if (!armed || !window.webgazer) return null;
    pts = []; t0 = performance.now(); last = 0; running = true;
    webgazer.setGazeListener((data) => {
      if (!running || !data) return;
      const ms = Math.round(performance.now() - t0);
      if (ms - last < RATE) return;
      last = ms;
      pts.push([ms, Math.round(data.x), Math.round(data.y)]);
    });
    return pts;
  };

  G.stop = function () {
    running = false;
    const out = pts && pts.length ? { w: innerWidth, h: innerHeight, pts } : null;
    pts = null;
    document.body.classList.remove('gazing', 'gcal');
    try { webgazer.clearGazeListener(); webgazer.pause(); } catch {}
    return out;
  };

  css();                       /* 보정 화면 모양은 미리 깔아 둔다 (카메라와 무관) */

  G.off = function () {
    running = false; pts = null; armed = false;
    document.body.classList.remove('gazing', 'gcal');
    try { webgazer.end(); } catch {}
  };
})();
