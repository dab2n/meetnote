/* 사용성 테스트(UT) — 모바일 앱(IRIS)의 태스크·기록 구조를 웹에 그대로 옮긴 것.
   기록은 이 브라우저의 localStorage 에만 남고, ut.html(결과 보기)에서 확인한다.
   웹에는 전원 버튼이 없어서, 시나리오를 읽고 '시작하기'(또는 Enter)로 태스크를 시작한다.
   ponytail: 서버 없이 localStorage — 다른 기기에서 본 결과는 JSON 내보내기/가져오기로 합친다. */
(function () {
  const UT = window.UT = {};

  /* 태스크 2~5 는 start 가 없다 — 앞 태스크에서 마지막으로 머문 화면에서 이어서 시작 */
  const TASKS = UT.TASKS = [
    {
      id: 1, title: "'여름 프로젝트' 팀스페이스로 가기",
      scenario: "웹에서 '여름 프로젝트'의\n팀스페이스로 이동해주세요.",
      start: { hash: '#/p/research', reset: true },   /* 다른 프로젝트에서 시작 — 여름 프로젝트로 옮겨 가는 것이 과제다 */
      path: ['home_my', 'home_team'],
      reach: { home_team: '여름 프로젝트 팀스페이스 도달' },
      success: ['home_team'],
      rule: '팀스페이스(홈_팀) 도달 시 자동 성공',
    },
    {
      id: 2, title: 'Team UX의 내일까지 할 일 확인하기',
      scenario: 'Team UX가 내일까지\n해야 할 일을 확인해주세요.',
      path: ['home_team', 'home_my'],
      reach: { 'team-ux': 'Team UX 할 일 열기' },
      success: ['team-ux'],
      rule: 'Team UX 할 일 묶음을 열면 자동 성공 (무엇인지 답하는 것은 진행자 확인)',
    },
    {
      id: 3, title: '2주차 회의의 회의록 찾기',
      scenario: '당신은 2주차 회의에\n참여하지 못했습니다.\n회의록을 찾아주세요.',
      target: '새로운 노트 (3)',                 /* 표시 이름 '2주차 중간 회의' */
      path: ['home_team', 'home_my', 'list_new', 'list_agenda', 'meeting_sum'],
      reach: { meeting_sum: '2주차 중간 회의 회의록 도달' },
      success: ['meeting_sum'],
      rule: "'2주차 중간 회의' 회의록 도달 시 자동 성공",
    },
    {
      id: 4, title: '조작 방식을 논의한 카드 찾기',
      scenario: "회의록의 플로우 맵에서\n'웨어러블을 무엇으로 조작할 것인가'를\n논의한 카드를 찾아주세요.",
      path: ['meeting_sum', 'meeting_map', 'meeting_src'],
      reach: { meeting_map: '플로우 맵 도달', zoom3: '논의 3 확대해 카드 확인' },
      success: ['zoom3'],
      rule: '플로우 맵에서 논의 3(웨어러블을 무엇으로 조작할 것인가)을 확대해 카드를 열면 자동 성공',
    },
    {
      id: 5, title: '조작 방식의 결론과 근거 원문 찾기',
      scenario: "'웨어러블을 무엇으로 조작할 것인가'에 대해\n어떤 결론이 도출되었는지 확인하고,\n근거가 되는 실제 원문을 찾아주세요.",
      path: ['meeting_map', 'meeting_src', 'meeting_sum'],
      reach: { ev3: '논의 3 카드에서 원문으로' },
      success: ['ev3'],
      gaze: true,                                /* 카드를 어떻게 읽는지 — 웹캠으로 시선을 함께 기록한다 */
      rule: '논의 3 카드를 눌러 근거 원문이 짚히면 자동 성공 (결론을 말로 답하는 것은 진행자 확인)',
    },
  ];

  UT.SCREEN_NAME = {
    home_my: '홈_나', home_team: '홈_팀', list_new: '회의록_최신순', list_agenda: '회의록_안건별',
    meeting_sum: '회의 요약', meeting_src: '회의 원문', meeting_map: '플로우 맵', ask: 'AI 물어보기',
    '시나리오 화면': '시나리오 화면(시작 전)',
  };

  /* ---------- 저장소 (모바일과 같은 모양) ---------- */
  const KEY = 'mn-ut-v1', BAK = 'mn-ut-v1.bak';
  /* 본 기록이 비어 있으면 사본으로 되살린다 — 새로고침·실수로 날아가지 않게 */
  const load = UT.load = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(BAK)) || { sessions: [], current: null }; }
    catch { return { sessions: [], current: null }; }
  };
  const save = UT.save = db => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const backup = UT.backup = () => { try { const t = localStorage.getItem(KEY); if (t) localStorage.setItem(BAK, t); } catch {} };
  /* 새로고침으로 끊긴 회차는 '끊김'으로 닫아 둔다 — 지우지 않고 그대로 남긴다 */
  function closeDangling() {
    const db = load(); let n = 0;
    db.sessions.forEach(s => s.runs.forEach(r => {
      if (!r.startedAt || r.endedAt) return;
      const last = r.events.length ? r.events[r.events.length - 1].ms : 0;
      r.durationMs = r.durationMs != null ? r.durationMs : last;
      r.endedAt = r.startedAt + r.durationMs;
      r.endReason = (r.endReason ? r.endReason + ' · ' : '') + '새로고침으로 끊김';
      n++;
    }));
    if (n) { save(db); backup(); }
  }
  const newId = () => Math.random().toString(36).slice(2, 9);
  const today = () => new Date().toISOString().slice(0, 10);

  /* 테스트 판 — 파일럿 · v1 · v1.1 … 결과 보기에서 이 이름으로 묶인다.
     참가자는 이것을 보지도 적지도 않는다 — 진행자가 링크에 박는다(?ut&ver=v1.1). */
  UT.ver = () => { try { return localStorage.getItem('mn-ut-ver') || '파일럿'; } catch { return '파일럿'; } };
  UT.setVer = v => { try { localStorage.setItem('mn-ut-ver', (v || '').trim() || '파일럿'); } catch {} };

  UT.newSession = ({ name, age, job, ver }) => {
    const db = load();
    /* 등록 전에 둘러본 자유 기록이 있으면 그 사람 것으로 이어 붙인다 (새 칸을 만들지 않는다) */
    const cur = db.sessions.find(x => x.id === db.current);
    if (ver) UT.setVer(ver);
    if (cur && cur.auto && !cur.runs.some(r => r.task)) {
      Object.assign(cur, { name, age, job, ver: UT.ver(), auto: false }); save(db);
      return cur;
    }
    const s = { id: newId(), name, age, job, ver: UT.ver(), date: today(), startedAt: Date.now(), runs: [] };
    db.sessions.push(s); db.current = s.id; save(db); backup();
    return s;
  };
  const currentSession = db => {
    let s = db.sessions.find(x => x.id === db.current);
    if (!s) {
      s = { id: newId(), name: `무기명 ${db.sessions.length + 1}`, age: '', job: '', ver: UT.ver(), date: today(), startedAt: Date.now(), runs: [], auto: true };
      db.sessions.push(s); db.current = s.id;
    }
    return s;
  };
  UT.currentId = () => load().current;
  UT.finished = () => {
    const db = load(), s = db.sessions.find(x => x.id === db.current);
    const last = (s ? s.runs.filter(r => r.task === TASKS[TASKS.length - 1].id) : []).pop();
    return !!last && !!last.startedAt && (last.verdict === 'success' || !!last.endedAt);
  };

  /* 태스크 한 번(run)의 기록기. 고르는 순간 기록이 생기고(시작 전 행동도 남는다),
     참여자가 '시작하기'를 누른 때부터 시간을 잰다. */
  function startRun(taskId) {
    const db = load(), s = currentSession(db);
    const run = { id: newId(), task: taskId, selectedAt: Date.now(), startedAt: null, endedAt: null, successMs: null, verdict: null, milestones: [], events: [], note: '' };
    s.runs.push(run); save(db);
    const task = TASKS.find(t => t.id === taskId) || { path: [], reach: {}, success: [] };   /* taskId 0 = 자유 기록 */
    let t0 = null;
    const edit = fn => { const d = load(); const ss = d.sessions.find(x => x.id === s.id); const r = ss && ss.runs.find(x => x.id === run.id); if (r) { fn(r); save(d); } };
    const ms = () => (t0 == null ? 0 : Math.round(performance.now() - t0));
    /* 닿은 순간 — 몇 초에, 무엇을 눌러(또는 어디에 머물러) 닿았는지, 그때 커서가 어디였는지까지 남긴다 */
    const hit = (r, key, why) => {
      const m = task.reach && task.reach[key];
      if (m && !r.milestones.some(x => x.label === m)) r.milestones.push({ ms: ms(), label: m });
      if ((task.success || []).includes(key) && r.successMs == null) {
        r.successMs = ms(); r.successAt = Date.now(); r.verdict = 'success';
        r.successBy = why || m || key;
        r.successXY = PTR.slice();
      }
    };
    return {
      task,
      begin() { t0 = performance.now(); edit(r => { r.startedAt = Date.now(); }); },
      nav(screen, ctx, first) {
        const off = !first && task.path.length > 0 && !task.path.includes(screen);
        edit(r => {
          const last = [...r.events].reverse().find(e => e.type === 'nav');
          if (last && last.screen === screen && last.ctx === (ctx || '')) return;  /* 같은 화면 중복 기록 안 함 */
          r.events.push({ ms: ms(), type: 'nav', screen, ctx: ctx || '', off, first });
          if (first) return;                    /* 이어서 시작한 화면은 도달으로 치지 않는다 */
          const nfc = x => String(x).normalize('NFC');      /* 맥 파일명은 NFD 로 온다 */
          const nm = UT.SCREEN_NAME[screen] || screen;
          if (task.target && ctx && nfc(ctx) !== nfc(task.target)) { hit(r, screen + ':other', nm + ' 도달'); return; }
          hit(r, screen, nm + ' 도달' + (ctx ? ` · ${ctx}` : ''));
        });
      },
      act(type, label, screen) { edit(r => { r.events.push({ ms: ms(), type: 'act', screen, label }); hit(r, type, label); }); },
      hover(label, screen) { edit(r => { r.events.push({ ms: ms(), type: 'hover', screen, label }); }); },
      tap(label, screen, dead, pre) { edit(r => r.events.push({ ms: ms(), type: 'tap', screen: pre ? '시나리오 화면' : screen, label, dead: dead && !pre, pre })); },
      end(reason, extra) { edit(r => { r.endedAt = Date.now(); r.durationMs = t0 == null ? null : ms(); r.endReason = t0 == null ? `${reason} · 시작 전` : reason; if (extra) Object.assign(r, extra); }); },
    };
  }

  /* ---------- 진행 화면 ----------
     들머리는 화면 위쪽 작은 막대(.uttop)다 — '시작하기'와 '기록 보기' 두 버튼만 두고,
     들어오자마자 태스크를 띄우지 않는다. 태스크를 고르면 같은 자리에 지금 태스크가 뜬다.
     참여자 등록 · 태스크 고르기 · 시나리오는 전체를 덮는 한 겹(진행 레이어)에서 일어난다.
     레이어를 다시 부르는 길: 막대의 '태스크 바꾸기', Alt+Shift+T, Esc(진행 중이면 종료하고 연다) */
  /* 한 번 ?ut 로 들어오면 그 뒤로는 주소에 없어도 계속 테스트 모드 — 어느 페이지로 가도 위 막대가 남는다.
     끄려면 ?ut=off */
  const q = new URLSearchParams(location.search).get('ut');
  try {
    if (q === 'off') localStorage.removeItem('mn-ut-on');
    else if (q !== null) localStorage.setItem('mn-ut-on', '1');
  } catch {}
  try { const v = new URLSearchParams(location.search).get('ver'); if (v) UT.setVer(v); } catch {}
  /* 화상통화로 진행할 때는 시선을 끈다(?gaze=off) — 얼굴 추적이 통화의 화면공유·소리를 밀어낸다.
     한 번 끄면 그 브라우저에서 계속 꺼진 채로, ?gaze=on 으로 되살린다 */
  try {
    const g = new URLSearchParams(location.search).get('gaze');
    if (g === 'off') localStorage.setItem('mn-ut-gaze', 'off');
    else if (g) localStorage.removeItem('mn-ut-gaze');
  } catch {}
  UT.gaze = (() => { try { return localStorage.getItem('mn-ut-gaze') !== 'off'; } catch { return true; } })();
  UT.on = q !== null ? q !== 'off' : (() => { try { return localStorage.getItem('mn-ut-on') === '1'; } catch { return false; } })();
  let run = null, free = null, task = null, app = null, PTR = [0, 0];
  /* 태스크 밖에서도 계속 남긴다 — 고른 태스크가 없으면 '자유 기록'(task 0)으로 간다 */
  function rec() {
    if (run) return run;
    if (!free && app) { free = startRun(0); free.begin(); free.nav(app.screen(), app.ctx(), true); }
    return free;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => String(n).padStart(2, '0');

  UT.mount = a => {
    app = a;
    closeDangling();
    document.body.classList.add('ut');
    const tag = document.createElement('div');
    tag.className = 'uttop'; tag.id = 'uttop';
    tag.onclick = e => {
      if (e.target.closest('[data-go]')) { const c = load().sessions.find(x => x.id === load().current); return c && !c.auto ? list() : roster(); }
      if (e.target.closest('[data-rec]')) location.href = 'ut.html' + (UT.currentId() ? '?s=' + UT.currentId() : '');
      if (e.target.closest('[data-switch]')) openLayer();
    };
    document.body.append(tag);
    top();
    addEventListener('click', logTap, true);
    addEventListener('pointermove', logHover, true);
    addEventListener('keydown', e => {
      if (/INPUT|TEXTAREA/.test(e.target.tagName || '')) return;
      if (e.key === 'Enter' && document.querySelector('.utcover.ready')) begin();
      else if (e.key === 'Escape' && (run || document.querySelector('.utcover'))) { endRun('진행자 종료 (Esc)'); openLayer(); }
      else if (e.altKey && e.shiftKey && (e.key === 'T' || e.key === 't')) openLayer();
    });
    /* 들어오자마자 태스크를 띄우지 않는다 — 상단 막대의 두 버튼이 들머리다 */
  };

  /* 지금 하는 태스크를 화면 위에 살짝 — 진행자가 눈으로 확인하는 용도 */
  function top() {
    const t = document.getElementById('uttop'); if (!t) return;
    const on = !!(task && run);
    t.classList.toggle('idle', !on);
    t.innerHTML = on
      ? `<i>TASK ${num(task.id)}</i><span>${esc(task.title)}</span><button data-switch title="Alt+Shift+T">태스크 바꾸기</button>`
      : `<i>UT</i><span>사용성 테스트</span><button class="on" data-go>시작하기</button><button data-rec>기록 보기</button>`;
  }

  /* 진행 레이어 — mode: 'roster'(참여자) | 'list'(태스크 고르기) | 'scenario'(시나리오) */
  function layer(mode, body, cls) {
    const old = document.querySelector('.utcover'); if (old) old.remove();
    const d = document.createElement('div');
    d.className = 'utcover' + (cls ? ' ' + cls : '');
    d.dataset.mode = mode;
    d.innerHTML = `<div class="utc">${body}</div>`;
    document.body.append(d);
    return d;
  }
  function closeLayer(d) { d.classList.add('out'); setTimeout(() => d.remove(), 800); }

  function openLayer() {
    endRun('진행자 종료');
    if (!UT.currentId()) return roster();
    list();
  }
  function roster() {
    const d = layer('roster', `<span>MEETNOTE · 사용성 테스트</span><h3>참여자 정보</h3>
      <form id="utform"><input name="name" placeholder="이름" required><input name="age" type="number" placeholder="나이" required>
        <input name="job" placeholder="직업" required>
        <button type="submit">테스트 시작</button></form>
      <a href="ut.html">지난 결과 보기</a>`);
    const f = d.querySelector('form');
    setTimeout(() => f.name.focus(), 300);
    f.onsubmit = e => {
      e.preventDefault();
      const v = new FormData(f);
      UT.newSession({ name: (v.get('name') || '').trim(), age: v.get('age'), job: (v.get('job') || '').trim() });
      free = null;
      list();
    };
  }
  function list() {
    const db = load(), s = db.sessions.find(x => x.id === db.current) || { runs: [] };
    const stOf = t => {
      const r = s.runs.filter(x => x.task === t.id).pop();
      if (!r) return '';
      return r.verdict === 'success' ? '성공' : r.verdict === 'fail' ? '실패' : r.startedAt ? '기록됨' : '';
    };
    const d = layer('list', `<span>진행할 태스크를 고르세요</span>
      <div class="utlist">${TASKS.map(t => `<button data-t="${t.id}"><i>${num(t.id)}</i><span>${esc(t.title)}</span><em>${stOf(t)}</em></button>`).join('')}</div>
      <div class="utrow"><span>참여자 ${esc((s.name || '무기명'))}</span>
        <button class="gh" data-new>새 참여자</button><button class="gh" data-fin>테스트 종료 · 결과 보기</button></div>`);
    d.onclick = e => {
      const b = e.target.closest('[data-t]');
      if (b) return pick(TASKS.find(t => t.id === +b.dataset.t), d);
      if (e.target.closest('[data-new]')) { const db2 = load(); db2.current = null; save(db2); free = null; roster(); }
      if (e.target.closest('[data-fin]')) location.href = 'ut.html?s=' + UT.currentId();
    };
  }

  async function pick(t, from) {
    if (!t) return;
    endRun('다음 태스크 선택');
    task = t;
    if (from) from.remove();                     /* 고르기 → 시나리오, 막은 그대로 덮은 채로 */
    if (t.gaze && UT.gaze && window.GAZE && GAZE.can) {   /* 시선을 기록하는 태스크는 눈맞춤부터 */
      try { await GAZE.ready(); } catch (e) { console.warn('[ut] 시선 기록을 켜지 못했습니다', e); }
    }
    const d = layer('scenario', `<span>TASK ${num(t.id)}</span><p>${esc(t.scenario)}</p>
      <button id="utgo">시작하기</button><i>시작하려면 버튼을 누르거나 Enter 를 누르세요</i>`, from ? 'stay' : '');
    d.querySelector('#utgo').onclick = begin;
    setTimeout(() => {                           /* 막에 가려진 사이에 시작 화면으로 되돌린다 */
      if (t.start) {
        if (t.start.reset) reset();
        location.hash = t.start.hash;
      }
      run = startRun(t.id);
      d.classList.add('ready');
    }, from ? 300 : 800);
  }
  /* 태스크 1 은 처음부터 — 프로젝트·탭 선택과 남아 있던 의견을 지운다 */
  function reset() {
    try { Object.keys(localStorage).filter(k => /^mn\.(local|group|by|project)/.test(k)).forEach(k => localStorage.removeItem(k)); } catch {}
    if (app && app.reload) app.reload();
  }
  function begin() {
    const d = document.querySelector('.utcover'); if (!d || !d.classList.contains('ready')) return;
    closeLayer(d);
    if (!run) run = startRun(task.id);
    if (task.gaze && window.GAZE) GAZE.start();
    run.begin();
    run.nav(app.screen(), app.ctx(), true);
    top();
  }
  function endRun(why) {
    if (run) {
      const g = window.GAZE ? GAZE.stop() : null;              /* 시선 기록을 그 회차에 붙인다 */
      run.end(why, g ? { gaze: g, rects: (app.rects && app.rects()) || null } : null);
      run = null;
      backup();
    }
    top();
  }

  function logTap(e) {
    const el = e.target;
    if (el.closest('.utcover') || el.closest('.uttop')) return;
    const r = rec(); if (!r) return;
    const hit = el.closest('a,button,input,label,summary,[role="button"],[data-k],[data-o],[data-n],[data-sec]');
    const label = (el.closest('[aria-label]') && el.closest('[aria-label]').getAttribute('aria-label'))
      || ((hit || el).innerText || '').split('\n').map(x => x.trim()).filter(Boolean).join(' · ').slice(0, 40)
      || el.tagName.toLowerCase();
    r.tap(label, app.screen(), !hit, !!document.querySelector('.utcover'));
  }

  /* 한 곳에 1.2초 넘게 커서를 두면 '여기를 들여다봤다' 로 남긴다 — 눌러서 고르지 않고 눈으로 찾은 순간 */
  let hvEl = null, hvT = 0;
  function logHover(e) {
    PTR = [Math.round(e.clientX), Math.round(e.clientY)];
    const el = e.target.closest ? e.target.closest('[data-k],[data-o],[data-no],[data-w],.row,.node,.seg') : null;
    if (el === hvEl) return;
    clearTimeout(hvT); hvEl = el;
    const r = run; if (!el || !r) return;
    hvT = setTimeout(() => {
      const label = ((el.innerText || '').split('\n').map(x => x.trim()).filter(Boolean).join(' · ') || el.tagName).slice(0, 40);
      r.hover(label, app.screen());
    }, 1200);
  }

  /* 앱이 부르는 두 곳 */
  UT.nav = (screen, ctx) => { const r = rec(); if (r) r.nav(screen, ctx); };
  UT.act = (type, label) => { const r = rec(); if (r) { r.act(type, label, app.screen()); top(); } };
})();
