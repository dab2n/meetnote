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
      scenario: "당신은 '2주차 중간 회의'에\n참여하지 못했습니다.\n이 회의의 쟁점 1 결론을 찾아\n그 내용을 확인해주세요.",
      start: { hash: '#/p/newton', reset: true },
      target: '새로운 노트 (3)',                 /* 표시 이름 '2주차 중간 회의' */
      path: ['home_my', 'list_new', 'list_agenda', 'meeting_sum'],
      reach: { meeting_sum: '회의 요약(쟁점 1 결론) 도달', 'talk-open': '쟁점 1 오간 이야기 펼침' },
      success: ['meeting_sum'],
      rule: "'2주차 중간 회의' 요약 화면 도달 시 자동 성공",
    },
    {
      id: 2, title: "'무릎·발목 타깃 근거'의 두 주장과 결론 찾기",
      scenario: "회의록에서 '제품이 무릎과 발목을\n타깃하는 근거'에 대해 나왔던\n두 가지 주장을 찾고,\n결론을 말해주세요.",
      path: ['home_my', 'list_new', 'meeting_sum', 'meeting_map'],
      reach: { meeting_map: '관계 맵 도달', zoom9: '논의 9 확대해 내용 확인' },
      success: ['zoom9'],
      rule: '관계 맵에서 논의 9(무릎·발목 타깃의 근거)를 확대해 내용을 열면 자동 성공 (두 주장·결론 설명은 진행자 확인)',
    },
    {
      id: 3, title: 'Team UX의 내일까지 할 일 찾기',
      scenario: '홈에서 Team UX가 해야 할 업무를 찾아주세요.',
      path: ['home_my', 'home_team', 'list_new'],
      reach: { home_team: '팀 홈 도달', 'team-ux': 'Team UX 할 일 확인' },
      success: ['home_team'],
      rule: '팀 홈(Team UX 할 일) 도달 시 자동 성공',
    },
    {
      id: 4, title: '미결 안건에 새로운 의견 추가',
      scenario: '회의에서 결론을 내리지 못한 안건에 대해\n좋은 아이디어가 떠올랐습니다.\n해당 안건을 찾아, 팀원들이 볼 수 있도록\n의견을 남겨 주세요.',
      path: ['home_my', 'home_team', 'meeting_sum'],
      reach: { home_team: '팀 홈 도달', 'comment-open': '의견창 열기' },
      success: ['comment'],
      rule: '미해결 안건에 의견 등록 시 자동 성공',
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

  /* ---------- 진행 화면 ----------
     화면에 상시로 붙는 것은 없다. 태스크 고르기 · 시나리오 · 참여자 등록은 모두
     전체를 덮는 한 겹(진행 레이어)에서 일어나고, 태스크가 도는 동안에는 서비스만 남는다.
     레이어를 다시 부르는 길: 왼쪽 아래 작은 점, Alt+Shift+T, Esc(진행 중이면 종료하고 연다) */
  UT.on = new URLSearchParams(location.search).has('ut');
  let run = null, task = null, app = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => String(n).padStart(2, '0');

  UT.mount = a => {
    app = a;
    document.body.classList.add('ut');
    const tag = document.createElement('button');
    tag.className = 'uttop'; tag.id = 'uttop'; tag.title = '태스크 바꾸기 (Alt+Shift+T)';
    tag.onclick = () => openLayer();
    document.body.append(tag);
    top();
    addEventListener('click', logTap, true);
    addEventListener('keydown', e => {
      if (/INPUT|TEXTAREA/.test(e.target.tagName || '')) return;
      if (e.key === 'Enter' && document.querySelector('.utcover.ready')) begin();
      else if (e.key === 'Escape' && (run || document.querySelector('.utcover'))) { endRun('진행자 종료 (Esc)'); openLayer(); }
      else if (e.altKey && e.shiftKey && (e.key === 'T' || e.key === 't')) openLayer();
    });
    openLayer();                                 /* 들어오면 참여자 등록 · 태스크 고르기부터 */
  };

  /* 지금 하는 태스크를 화면 위에 살짝 — 진행자가 눈으로 확인하는 용도 */
  function top() {
    const t = document.getElementById('uttop'); if (!t) return;
    t.hidden = !(task && run);
    if (task) t.innerHTML = `<i>TASK ${num(task.id)}</i><span>${esc(task.title)}</span>`;
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
        <input name="job" placeholder="직업" required><button type="submit">테스트 시작</button></form>
      <a href="ut.html">지난 결과 보기</a>`);
    const f = d.querySelector('form');
    setTimeout(() => f.name.focus(), 300);
    f.onsubmit = e => {
      e.preventDefault();
      const v = new FormData(f);
      UT.newSession({ name: (v.get('name') || '').trim(), age: v.get('age'), job: (v.get('job') || '').trim() });
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
      if (e.target.closest('[data-new]')) { const db2 = load(); db2.current = null; save(db2); roster(); }
      if (e.target.closest('[data-fin]')) location.href = 'ut.html?s=' + UT.currentId();
    };
  }

  function pick(t, from) {
    if (!t) return;
    endRun('다음 태스크 선택');
    task = t;
    if (from) from.remove();                     /* 고르기 → 시나리오, 막은 그대로 덮은 채로 */
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
    run.begin();
    run.nav(app.screen(), app.ctx(), true);
    top();
  }
  function endRun(why) { if (run) { run.end(why); run = null; } top(); }

  function logTap(e) {
    if (!run) return;
    const el = e.target;
    if (el.closest('.utcover') || el.closest('.uttop')) return;
    const hit = el.closest('a,button,input,label,summary,[role="button"],[data-k],[data-o],[data-n],[data-sec]');
    const label = (el.closest('[aria-label]') && el.closest('[aria-label]').getAttribute('aria-label'))
      || ((hit || el).innerText || '').split('\n').map(x => x.trim()).filter(Boolean).join(' · ').slice(0, 40)
      || el.tagName.toLowerCase();
    run.tap(label, app.screen(), !hit, !!document.querySelector('.utcover'));
  }

  /* 앱이 부르는 두 곳 */
  UT.nav = (screen, ctx) => { if (run) run.nav(screen, ctx); };
  UT.act = (type, label) => { if (run) { run.act(type, label, app.screen()); top(); } };
})();
