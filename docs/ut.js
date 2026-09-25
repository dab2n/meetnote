/* 사용성 테스트(UT) — 모바일 앱(IRIS)의 태스크·기록 구조를 웹에 그대로 옮긴 것.
   기록은 이 브라우저의 localStorage 에만 남고, ut.html(결과 보기)에서 확인한다.
   웹에는 전원 버튼이 없어서, 시나리오를 읽고 '시작하기'(또는 Enter)로 태스크를 시작한다.
   ponytail: 서버 없이 localStorage — 다른 기기에서 본 결과는 JSON 내보내기/가져오기로 합친다. */
(function () {
  const UT = window.UT = {};

  /* 태스크 2~4 는 start 가 없다 — 앞 태스크에서 마지막으로 머문 화면에서 이어서 시작 */
  const TASKS = UT.TASKS = [
    {
      id: 1, title: "참여하지 못한 '2주차 중간 회의'의 쟁점 1 결론 찾기",
      scenario: "당신은 팀의 가장 최근 회의에\n참여하지 못했습니다.\n이 회의의 쟁점 1 결론을 찾아\n그 내용을 확인해주세요.",
      start: { hash: '#/p/newton', reset: true },
      target: '새로운 노트 (3)',                 /* 가장 최근 회의 */
      path: ['home_my', 'list_new', 'list_agenda', 'meeting_sum'],
      reach: { meeting_sum: '회의 요약(쟁점 1 결론) 도달', 'talk-open': '쟁점 1 오간 이야기 펼침' },
      success: ['meeting_sum'],
      rule: '가장 최근 회의의 요약 화면 도달 시 자동 성공',
    },
    {
      id: 2, title: 'Team UX의 내일까지 할 일 찾기',
      scenario: '홈에서 Team UX가 해야 할 업무를 찾아주세요.',
      path: ['home_my', 'home_team', 'list_new'],
      reach: { home_team: '팀 홈 도달', 'team-ux': 'Team UX 할 일 확인', 'ask-answer': 'AI가 답변' },
      success: ['home_team'],
      rule: '팀 홈(Team UX 할 일) 도달 시 자동 성공',
    },
    {
      id: 3, title: '미결 안건에 새로운 의견 추가',
      scenario: '회의에서 결론을 내리지 못한 안건에 대해\n좋은 아이디어가 떠올랐습니다.\n해당 안건을 찾아, 팀원들이 볼 수 있도록\n의견을 남겨 주세요.',
      path: ['home_my', 'home_team', 'meeting_sum'],
      reach: { home_team: '팀 홈 도달', 'comment-open': '의견창 열기' },
      success: ['comment'],
      rule: '미해결 안건에 의견 등록 시 자동 성공',
    },
    {
      id: 4, title: '이번 주 금요일까지의 내 할 일 확인',
      scenario: '이번 주에 해야 할 업무를 확인하려고 합니다.\n이번 주 금요일까지 본인이 완료해야 할 일을\n모두 찾아 말씀해 주세요.',
      path: [],                                  /* AI 에게 묻는 것이 의도 — 화면을 옮겨 다니면 이탈 */
      reach: { 'ask-open': 'AI 호출(물어보기 · ⌘K)', ask: 'AI에게 질문', 'ask-answer': 'AI가 답변', home_my: '나의 할 일 화면' },
      success: ['ask-answer'],
      rule: 'AI가 답하면 자동 성공 (말로 설명은 진행자 확인)',
    },
  ];

  UT.SCREEN_NAME = {
    home_my: '홈_나', home_team: '홈_팀', list_new: '회의록_최신순', list_agenda: '회의록_안건별',
    meeting_sum: '회의 요약', meeting_src: '회의 원문', meeting_map: '관계 맵', ask: 'AI 물어보기',
    '시나리오 화면': '시나리오 화면(시작 전)',
  };

  /* ---------- 저장소 (모바일과 같은 모양) ---------- */
  const KEY = 'mn-ut-v1';
  const load = UT.load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { sessions: [], current: null }; } catch { return { sessions: [], current: null }; } };
  const save = UT.save = db => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const newId = () => Math.random().toString(36).slice(2, 9);
  const today = () => new Date().toISOString().slice(0, 10);

  UT.newSession = ({ name, age, job }) => {
    const db = load();
    const s = { id: newId(), name, age, job, date: today(), startedAt: Date.now(), runs: [] };
    db.sessions.push(s); db.current = s.id; save(db);
    return s;
  };
  const currentSession = db => {
    let s = db.sessions.find(x => x.id === db.current);
    if (!s) {
      s = { id: newId(), name: `무기명 ${db.sessions.length + 1}`, age: '', job: '', date: today(), startedAt: Date.now(), runs: [] };
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
    const task = TASKS.find(t => t.id === taskId);
    let t0 = null;
    const edit = fn => { const d = load(); const ss = d.sessions.find(x => x.id === s.id); const r = ss && ss.runs.find(x => x.id === run.id); if (r) { fn(r); save(d); } };
    const ms = () => (t0 == null ? 0 : Math.round(performance.now() - t0));
    const hit = (r, key) => {
      const m = task.reach && task.reach[key];
      if (m && !r.milestones.some(x => x.label === m)) r.milestones.push({ ms: ms(), label: m });
      if ((task.success || []).includes(key) && r.successMs == null) { r.successMs = ms(); r.verdict = 'success'; }
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
          if (task.target && ctx && nfc(ctx) !== nfc(task.target)) { hit(r, screen + ':other'); return; }
          hit(r, screen);
        });
      },
      act(type, label, screen) { edit(r => { r.events.push({ ms: ms(), type: 'act', screen, label }); hit(r, type); }); },
      tap(label, screen, dead, pre) { edit(r => r.events.push({ ms: ms(), type: 'tap', screen: pre ? '시나리오 화면' : screen, label, dead: dead && !pre, pre })); },
      end(reason) { edit(r => { r.endedAt = Date.now(); r.durationMs = t0 == null ? null : ms(); r.endReason = t0 == null ? `${reason} · 시작 전` : reason; }); },
    };
  }

  /* ---------- 진행 화면 (왼쪽 태스크 목록 + 시나리오 막) ---------- */
  UT.on = new URLSearchParams(location.search).has('ut');
  let run = null, task = null, app = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  UT.mount = a => {
    app = a;
    document.body.classList.add('ut');
    const bar = document.createElement('aside');
    bar.className = 'utbar'; bar.id = 'utbar';
    document.body.append(bar);
    drawBar();
    addEventListener('click', logTap, true);
    addEventListener('keydown', e => {
      if (e.key === 'Escape' && run) { endRun('진행자 종료 (Esc)'); drawBar(); }
      if (e.key === 'Enter' && document.querySelector('.utcover.ready') && !/INPUT|TEXTAREA/.test((e.target.tagName || ''))) begin();
    });
  };

  function drawBar() {
    const bar = document.getElementById('utbar'); if (!bar) return;
    if (!UT.currentId()) {                      /* 참여자 정보부터 */
      bar.innerHTML = `<p class="utlb">MEETNOTE / USABILITY TEST</p>
        <form id="utform"><p class="uth">참여자 정보</p>
          <input name="name" placeholder="이름" required autofocus><input name="age" type="number" placeholder="나이" required>
          <input name="job" placeholder="직업" required><button type="submit">테스트 시작</button></form>
        <a class="utsub" href="ut.html">지난 결과 보기</a>`;
      bar.querySelector('form').onsubmit = e => {
        e.preventDefault();
        const f = new FormData(e.target);
        UT.newSession({ name: (f.get('name') || '').trim(), age: f.get('age'), job: (f.get('job') || '').trim() });
        drawBar();
      };
      return;
    }
    const done = UT.finished();
    bar.innerHTML = `<p class="utlb">MEETNOTE / USABILITY TEST</p>
      ${TASKS.map(t => `<button class="uttask ${task && task.id === t.id ? 'on' : ''}" data-t="${t.id}"><i>${String(t.id).padStart(2, '0')}</i><span>${esc(t.title)}</span></button>`).join('')}
      <button class="${done ? 'utdone' : 'utend'}" id="utfin">${done ? '결과 확인하기' : '테스트 종료'}</button>`;
    bar.querySelectorAll('[data-t]').forEach(b => b.onclick = () => pick(TASKS.find(t => t.id === +b.dataset.t)));
    bar.querySelector('#utfin').onclick = () => { endRun('테스트 종료'); location.href = 'ut.html?s=' + UT.currentId(); };
  }

  function pick(t) {
    endRun('다음 태스크 선택');
    task = t; drawBar();
    cover(t);
    setTimeout(() => {                          /* 막에 가려진 사이에 시작 화면으로 되돌린다 */
      if (t.start) {
        if (t.start.reset) reset();
        location.hash = t.start.hash;
      }
      run = startRun(t.id);
      const c = document.querySelector('.utcover'); if (c) c.classList.add('ready');
    }, 800);
  }
  /* 태스크 1 은 처음부터 — 프로젝트·탭 선택과 남아 있던 의견을 지운다 */
  function reset() {
    try {
      Object.keys(localStorage).filter(k => /^mn\.(local|group|by|project)/.test(k)).forEach(k => localStorage.removeItem(k));
    } catch {}
    if (app && app.reload) app.reload();
  }
  function cover(t) {
    const old = document.querySelector('.utcover'); if (old) old.remove();
    const d = document.createElement('div');
    d.className = 'utcover';
    d.innerHTML = `<div class="utc"><span>TASK ${String(t.id).padStart(2, '0')}</span><p>${esc(t.scenario)}</p>
      <button id="utgo">시작하기</button><i>시작하려면 버튼을 누르거나 Enter 를 누르세요</i></div>`;
    document.body.append(d);
    d.querySelector('#utgo').onclick = begin;
  }
  function begin() {
    const d = document.querySelector('.utcover'); if (!d || !d.classList.contains('ready')) return;
    d.classList.add('out'); setTimeout(() => d.remove(), 800);
    if (!run) run = startRun(task.id);
    run.begin();
    run.nav(app.screen(), app.ctx(), true);
  }
  function endRun(why) { if (run) { run.end(why); run = null; } }

  function logTap(e) {
    if (!run) return;
    const el = e.target;
    if (el.closest('.utbar') || el.closest('.utcover')) return;
    const hit = el.closest('a,button,input,label,summary,[role="button"],[data-k],[data-o],[data-n],[data-sec]');
    const label = (el.closest('[aria-label]') && el.closest('[aria-label]').getAttribute('aria-label'))
      || ((hit || el).innerText || '').split('\n').map(x => x.trim()).filter(Boolean).join(' · ').slice(0, 40)
      || el.tagName.toLowerCase();
    run.tap(label, app.screen(), !hit, !!document.querySelector('.utcover'));
  }

  /* 앱이 부르는 두 곳 */
  UT.nav = (screen, ctx) => { if (run) run.nav(screen, ctx); };
  UT.act = (type, label) => { if (run) { run.act(type, label, app.screen()); drawBar(); } };
})();
