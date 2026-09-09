/* 경비정산 PWA — 상태, 네비게이션, 화면 렌더링 */

const State = {
  boot: null,          // bootstrap 응답
  year: new Date().getFullYear(),
  view: 'dashboard',
  dashMode: 'projected',   // 'projected' = 정기구독 포함, 'actual' = 실사용만
  pastoralView: 'amount',  // 'amount' = 총액(게이지), 'ratio' = 구성비(원그래프)
  showAllSub: false,
  showProjection: false,   // 정기구독 예상 내역 펼침 여부
  budgetYear: null,        // 설정 화면에서 보고 있는 예산 연도
  listFilters: { 항목: '전체', 세부: '전체', 기간: '올해', 상태: '전체', from: '', to: '' },
  upload: null,        // { dataUrl, base64, mimeType, form, analysis }
  settle: { tab: '목회비정산', month: '', week: '', candidates: [], selected: {}, method: '수기입력', capture: null }
};

const VIEW_TITLE = {
  dashboard: '대시보드', list: '지출 목록', upload: '영수증 등록',
  settle: '정산 대사', settings: '설정'
};

const $ = sel => document.querySelector(sel);
const el = id => document.getElementById(id);

/* ---------------- 부팅 ---------------- */

/**
 * 지난번에 받은 데이터를 이 기기에 남겨 둡니다.
 *
 * Apps Script 응답은 서버 처리에만 2~4초가 걸려, 앱을 열 때마다 빈 화면을
 * 그만큼 봐야 했습니다. 저장해 둔 값으로 먼저 그리고 뒤에서 새로 받아 옵니다.
 */
const CACHE_KEY = 'exp.snapshot';
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 14;   // 2주 지난 값은 쓰지 않습니다

function saveSnapshot(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), year: State.year, data }));
  } catch (e) { /* 저장 공간이 없으면 그냥 넘어갑니다 */ }
}

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || !snap.data || Date.now() - snap.at > CACHE_MAX_AGE) return null;
    return snap;
  } catch (e) { return null; }
}

function clearSnapshot() {
  try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
}

async function boot() {
  if (!API.isConfigured()) { showOnboarding(); return; }
  el('onboarding').hidden = true;
  el('app').hidden = false;

  const snap = loadSnapshot();
  if (snap) {
    // 저장해 둔 값으로 즉시 그리고, 최신 값은 뒤에서 받아 옵니다.
    State.boot = snap.data;
    State.year = snap.year || State.boot.meta.year;
    renderYearSelect();
    render();
    setStale(true);
    reload({ silent: true });
    return;
  }
  await reload();
}

/** 갱신 중임을 새로고침 아이콘으로 알립니다. */
function setStale(on) {
  el('refresh-btn').classList.toggle('is-busy', !!on);
}

async function reload(opts = {}) {
  const silent = !!opts.silent;
  if (silent) setStale(true);
  else UI.loading(true, '불러오는 중…');
  try {
    const data = await API.call('bootstrap', { year: State.year });
    State.boot = data;
    State.year = data.meta.year;
    saveSnapshot(data);
    renderYearSelect();
    render();
  } catch (e) {
    if (silent) {
      // 저장해 둔 값이 이미 화면에 있으므로 조용히 알리기만 합니다.
      UI.toast('최신 내용을 받지 못했습니다. 저장된 내용을 보고 계십니다.', 'danger');
    } else {
      UI.toast(e.message, 'danger');
      if (/토큰|URL|연결하지/.test(e.message)) showOnboarding(e.message);
    }
  } finally {
    setStale(false);
    if (!silent) UI.loading(false);
  }
}

function showOnboarding(message) {
  const cfg = API.getConfig();
  el('app').hidden = true;
  el('onboarding').hidden = false;
  el('ob-url').value = cfg.url;
  el('ob-token').value = cfg.token;
  const err = el('ob-error');
  err.hidden = !message;
  if (message) err.textContent = message;
  UI.refreshIcons(el('onboarding'));
}

el('ob-save').onclick = async () => {
  const url = el('ob-url').value.trim();
  const token = el('ob-token').value.trim();
  if (!url || !token) { el('ob-error').hidden = false; el('ob-error').textContent = '두 값을 모두 입력하세요.'; return; }
  API.setConfig(url, token);
  clearSnapshot();
  UI.loading(true, '연결 확인 중…');
  try {
    await API.call('ping');
    el('onboarding').hidden = true;
    el('app').hidden = false;
    await reload();
  } catch (e) {
    el('ob-error').hidden = false;
    el('ob-error').textContent = e.message;
  } finally {
    UI.loading(false);
  }
};

/* ---------------- 네비게이션 ---------------- */

function go(view) {
  State.view = view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  el('topbar-title').textContent = VIEW_TITLE[view];
  el('year-select').hidden = !(view === 'dashboard' || view === 'list');
  window.scrollTo({ top: 0 });
  render();
}

el('tabbar').addEventListener('click', ev => {
  const tab = ev.target.closest('.tab');
  if (!tab) return;
  if (tab.dataset.view === 'upload') resetUpload();
  go(tab.dataset.view);
});

el('refresh-btn').onclick = reload;

document.addEventListener('click', ev => {
  if (ev.target.closest('[data-close-sheet]')) UI.closeSheet();
});

function renderYearSelect() {
  const sel = el('year-select');
  const years = new Set([State.year, new Date().getFullYear()]);
  (State.boot?.expenses || []).forEach(e => {
    const y = Number(String(e.사용일자).slice(0, 4));
    if (y) years.add(y);
  });
  const sorted = [...years].sort((a, b) => b - a);
  sel.innerHTML = sorted.map(y => `<option value="${y}"${y === State.year ? ' selected' : ''}>${y}년</option>`).join('');
  sel.onchange = async () => { State.year = Number(sel.value); await reload(); };
}

function render() {
  const map = {
    dashboard: renderDashboard, list: renderList, upload: renderUpload,
    settle: renderSettle, settings: renderSettings
  };
  const fn = map[State.view];
  if (!fn) return;
  try {
    fn();
  } catch (e) {
    // 화면이 통째로 비어 버리는 것보다, 무엇이 잘못됐는지 보여 주는 편이 낫습니다.
    renderCrash(State.view, e);
  }
}

function renderCrash(view, error) {
  console.error('[' + view + '] 렌더링 실패', error);
  const root = el('view-' + view);
  if (!root) return;
  root.innerHTML = `
    <div class="card tone-danger">
      <div class="card-head"><div class="card-title">${UI.icon('triangle-alert')} 화면을 그리지 못했습니다</div></div>
      <p class="form-note" style="margin-top:0">앱과 서버 버전이 어긋났을 때 주로 생깁니다.
        아래 버튼으로 최신 파일을 다시 받아 보십시오.</p>
      <pre class="crash-detail">${UI.esc(String(error && error.message || error))}</pre>
      <button class="btn btn-primary btn-block" id="crash-reload">${UI.icon('refresh-cw')} 최신 버전으로 새로고침</button>
    </div>`;
  UI.refreshIcons(root);
  root.querySelector('#crash-reload').onclick = hardReload;
}

/** 서비스 워커 캐시를 비우고 다시 받아옵니다. */
async function hardReload() {
  UI.loading(true, '최신 버전을 받는 중…');
  clearSnapshot();
  try {
    if ('serviceWorker' in navigator) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    }
    if (window.caches) {
      for (const k of await caches.keys()) await caches.delete(k);
    }
  } catch (e) { /* 캐시를 못 지워도 새로고침은 시도합니다 */ }
  location.reload();
}

/* ---------------- 화면 B. 대시보드 ---------------- */

function renderDashboard() {
  const d = State.boot?.dashboard;
  const root = el('view-dashboard');
  if (!d) { root.innerHTML = ''; return; }

  const projected = State.dashMode === 'projected';
  const p = d.목회비;
  const used = projected ? p.예상포함 : p.실사용;
  const remain = Math.max(0, p.한도 - used);
  const t = UI.tone(used, p.한도);

  // 세부항목: 건강관리 + 사용액 상위 2개를 기본 노출
  const subs = p.세부항목.map(s => ({ ...s, 표시액: projected ? s.예상포함 : s.실사용 }));
  const health = subs.find(s => s.이름 === '건강관리');
  const others = subs.filter(s => s.이름 !== '건강관리').sort((a, b) => b.표시액 - a.표시액);
  const shown = State.showAllSub ? [health, ...others] : [health, ...others.slice(0, 2)];

  const bdRow = s => {
    const hasLimit = !!s.한도;
    const extra = projected && s.예상포함 > s.실사용
      ? `<div class="projected">실사용 ${UI.num(s.실사용)}</div>` : '';
    return `
      <div class="bd-row">
        ${UI.icon(UI.SUB_ICON[s.이름] || 'circle-ellipsis')}
        <div class="bd-name">${UI.esc(s.이름)}</div>
        <div class="bd-bar">${hasLimit ? UI.gauge(s.실사용, s.한도, projected ? s.예상포함 : 0) : ''}</div>
        <div class="bd-amt">${UI.num(s.표시액)}${hasLimit ? ` <span class="projected">/ ${UI.num(s.한도)}</span>` : ''}${extra}</div>
      </div>`;
  };

  const fuel = d.주유비;
  const fuelTone = UI.tone(fuel.실사용, fuel.한도);
  const b = d.배지;

  const alerts = [];
  if (b.금액불일치) alerts.push(alertRow('triangle-alert', '금액 불일치', b.금액불일치, 'danger', '금액불일치'));
  if (b.미제출) alerts.push(alertRow('circle-alert', '미제출 영수증', b.미제출, 'warn', '미제출'));
  if (b.미정산) alerts.push(alertRow('clock', '정산 대기', b.미정산, '', '미정산'));

  const isRatio = State.pastoralView === 'ratio';

  root.innerHTML = `
    <div class="card ${t ? 'tone-' + t : ''}">
      <div class="card-head">
        <div class="card-title">${UI.icon('heart-handshake')} 목회비</div>
        <div class="segmented" id="pastoral-view">
          <button data-pview="amount" class="${isRatio ? '' : 'is-active'}">총액</button>
          <button data-pview="ratio" class="${isRatio ? 'is-active' : ''}">비율</button>
        </div>
      </div>

      <div class="segmented is-block" id="dash-mode">
        <button data-mode="projected" class="${projected ? 'is-active' : ''}">정기구독 포함</button>
        <button data-mode="actual" class="${projected ? '' : 'is-active'}">실사용만</button>
      </div>

      <div class="amount-row" style="margin-top:14px">
        <div class="amount-main">${UI.won(used)}</div>
        <div class="amount-sub">/ ${UI.won(p.한도)}</div>
      </div>

      ${isRatio ? ratioBody(subs, used) : `
        ${UI.gauge(p.실사용, p.한도, projected ? p.예상포함 : 0)}
        <div class="gauge-meta">
          <span>${UI.pct(used, p.한도)}%</span>
          <span>잔액 ${UI.won(remain)}</span>
        </div>
        ${projected ? projectionDetail(p) : ''}
        <div class="breakdown">
          ${shown.map(bdRow).join('')}
          <button class="link-btn" id="toggle-sub" style="align-self:flex-start;font-size:13px">
            ${State.showAllSub ? '접기' : '더보기'}
          </button>
        </div>`}
    </div>

    <div class="card ${fuelTone ? 'tone-' + fuelTone : ''}">
      <div class="card-head"><div class="card-title">${UI.icon('fuel')} 주유비</div></div>
      <div class="amount-row">
        <div class="amount-main">${UI.won(fuel.실사용)}</div>
        <div class="amount-sub">/ ${UI.won(fuel.한도)}</div>
      </div>
      ${UI.gauge(fuel.실사용, fuel.한도)}
      <div class="gauge-meta">
        <span>${UI.pct(fuel.실사용, fuel.한도)}%</span>
        <span>잔액 ${UI.won(Math.max(0, fuel.한도 - fuel.실사용))}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">${UI.icon('receipt')} 경비</div>
        <span class="badge">한도 없음</span>
      </div>
      <div class="kv"><span class="k">이번 달 누적</span><span class="v">${UI.won(d.경비.이번달누적)}</span></div>
      <div class="kv"><span class="k">${State.year}년 누적</span><span class="v">${UI.won(d.경비.올해누적)}</span></div>
      <div class="kv">
        <span class="k">정산 대기</span>
        <span class="v ${d.경비.정산대기건수 ? 'warn-text' : ''}">
          ${d.경비.정산대기건수}건 (${UI.won(d.경비.정산대기금액)})
          ${d.경비.정산대기건수 ? `<span class="badge warn" style="margin-left:6px">${UI.icon('circle-alert')}확인 필요</span>` : ''}
        </span>
      </div>
    </div>

    ${alerts.length ? `<div class="section-title">확인할 항목</div><div class="list">${alerts.join('')}</div>` : ''}

    <div class="section-title">최근 등록</div>
    <div class="list">
      ${d.최근등록.length
        ? d.최근등록.map(expenseCard).join('')
        : `<div class="empty">${UI.icon('inbox')}아직 등록된 지출이 없습니다.</div>`}
    </div>`;

  UI.refreshIcons(root);

  root.querySelector('#dash-mode').onclick = ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    State.dashMode = btn.dataset.mode;
    renderDashboard();
  };
  root.querySelector('#pastoral-view').onclick = ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    State.pastoralView = btn.dataset.pview;
    renderDashboard();
  };
  const projToggle = root.querySelector('#proj-toggle');
  if (projToggle) projToggle.onclick = () => { State.showProjection = !State.showProjection; renderDashboard(); };

  const toggleSub = root.querySelector('#toggle-sub');
  if (toggleSub) toggleSub.onclick = () => { State.showAllSub = !State.showAllSub; renderDashboard(); };
  root.querySelectorAll('[data-alert]').forEach(btn => {
    btn.onclick = () => {
      State.listFilters = { ...State.listFilters, 상태: btn.dataset.alert, 기간: '전체' };
      go('list');
    };
  });
  bindExpenseCards(root);
}

/** 목회비 세부항목 구성비 — 원그래프와 범례. 금액이 0인 항목은 빼서 읽기 쉽게 둡니다. */
function ratioBody(subs, total) {
  const slices = subs
    .filter(s => s.표시액 > 0)
    .sort((a, b) => b.표시액 - a.표시액)
    .map((s, i) => ({ 이름: s.이름, 금액: s.표시액, 한도: s.한도, 색: `var(--cat-${(i % 7) + 1})` }));

  if (!slices.length) {
    return `<div class="empty" style="padding:26px 10px">${UI.icon('chart-pie')}아직 집계할 목회비 지출이 없습니다.</div>`;
  }

  const sum = slices.reduce((a, s) => a + s.금액, 0);
  const legend = slices.map(s => {
    const over = s.한도 && s.금액 > s.한도;
    return `
      <div class="legend-row${over ? ' is-over' : ''}">
        <span class="dot" style="background:${s.색}"></span>
        <span class="legend-name">${UI.esc(s.이름)}${over ? ' · 한도 초과' : ''}</span>
        <span class="legend-amt">${UI.num(s.금액)}</span>
        <span class="legend-pct">${(s.금액 / sum * 100).toFixed(1)}%</span>
      </div>`;
  }).join('');

  return `
    ${UI.donut(slices)}
    <div class="legend">${legend}</div>
    <p class="form-note" style="margin:12px 0 0">세부항목 합계 ${UI.won(sum)} 기준 구성비입니다.</p>`;
}

/**
 * 정기구독 예상액 내역.
 * "예상 포함" 이 얼마인지만 보여 주면 어느 구독이 얼마나 남았는지 알 수 없어,
 * 구독별로 남은 달과 금액을 펼쳐 볼 수 있게 합니다.
 */
function projectionDetail(p) {
  const items = Object.values(p.구독예상 || {});
  const pending = p.예상포함 - p.실사용;
  if (!items.length || pending <= 0) return '';

  // 연속한 달은 묶어서 짧게 적습니다. [1,2,3,7] → "1~3월, 7월"
  const monthLabel = list => {
    const nums = (list || []).map(m => Number(m.slice(5, 7))).sort((a, b) => a - b);
    if (!nums.length) return '';
    const parts = [];
    let start = nums[0], prev = nums[0];
    for (let i = 1; i <= nums.length; i++) {
      if (nums[i] === prev + 1) { prev = nums[i]; continue; }
      parts.push(start === prev ? `${start}월` : `${start}~${prev}월`);
      start = prev = nums[i];
    }
    return parts.join(', ');
  };

  const rows = items
    .sort((a, b) => b.금액 - a.금액)
    .map(s => `
      <div class="proj-row">
        ${UI.icon(UI.SUB_ICON[s.목회비세부항목] || 'repeat')}
        <div class="proj-body">
          <div class="proj-name">${UI.esc(s.구독명)}</div>
          <div class="proj-months">${UI.esc(monthLabel(s.예상월목록))} · ${s.개월수}개월 × ${UI.num(s.월예상금액)}원${
            s.실제등록월.length ? ` <span class="proj-done">(${UI.esc(monthLabel(s.실제등록월))} 영수증 등록됨)</span>` : ''}</div>
        </div>
        <div class="proj-amt">${UI.num(s.금액)}</div>
      </div>`).join('');

  return `
    <div class="projection">
      <button class="proj-toggle" id="proj-toggle" aria-expanded="${State.showProjection}">
        ${UI.icon(State.showProjection ? 'chevron-down' : 'chevron-right')}
        <span>정기구독 예상액</span>
        <span class="proj-total">${UI.won(pending)}</span>
      </button>
      ${State.showProjection ? `<div class="proj-list">${rows}
        <p class="form-note" style="margin:10px 0 0">영수증을 등록하고 그 구독에 연결하면 해당 달은 실제 금액으로 바뀝니다.</p>
      </div>` : ''}
    </div>`;
}

function alertRow(iconName, label, count, variant, filter) {
  return `<button class="alert-row ${variant}" data-alert="${filter}">
    ${UI.icon(iconName)}<span class="grow">${label}</span>
    <span class="count">${count}건</span>${UI.icon('chevron-right')}
  </button>`;
}

/* ---------------- 지출 카드 ---------------- */

function expenseCard(e) {
  const iconName = e.항목 === '목회비'
    ? (UI.SUB_ICON[e.목회비세부항목] || UI.CATEGORY_ICON['목회비'])
    : UI.CATEGORY_ICON[e.항목] || 'receipt';
  const desc = e.인원_내용 || (e.항목 === '주유비' ? '주유' : '(내용 없음)');
  return `
    <button class="item-card" data-expense="${UI.esc(e.지출ID)}">
      <div class="item-icon">${UI.icon(iconName)}</div>
      <div class="item-body">
        <div class="item-top">
          <span>${UI.dateLabel(e.사용일자)}</span>
          <span>·</span>
          <span>${UI.esc(e.항목)}${e.목회비세부항목 ? ' · ' + UI.esc(e.목회비세부항목) : ''}</span>
        </div>
        <div class="item-desc">${UI.esc(desc)}</div>
        <div class="item-amt">${UI.won(e.금액)}</div>
        <div class="item-badges">${UI.statusBadges(e)}</div>
      </div>
    </button>`;
}

function bindExpenseCards(root) {
  root.querySelectorAll('[data-expense]').forEach(btn => {
    btn.onclick = () => openExpenseDetail(btn.dataset.expense);
  });
}

/* ---------------- 화면 C. 지출 목록 ---------------- */

function filteredExpenses() {
  const f = State.listFilters;
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  return (State.boot?.expenses || []).filter(e => {
    if (f.항목 !== '전체' && e.항목 !== f.항목) return false;
    if (f.항목 === '목회비' && f.세부 !== '전체' && e.목회비세부항목 !== f.세부) return false;

    const ym = String(e.사용일자).slice(0, 7);
    if (f.기간 === '이번 달' && ym !== thisMonth) return false;
    if (f.기간 === '지난 달' && ym !== lastMonth) return false;
    if (f.기간 === '올해' && String(e.사용일자).slice(0, 4) !== String(State.year)) return false;
    if (f.기간 === '사용자 지정') {
      if (f.from && e.사용일자 < f.from) return false;
      if (f.to && e.사용일자 > f.to) return false;
    }

    if (f.상태 !== '전체') {
      if (['미제출', '제출완료'].includes(f.상태)) { if (e.영수증제출상태 !== f.상태) return false; }
      else if (e.정산상태 !== f.상태) return false;
    }
    return true;
  }).sort((a, b) => (a.사용일자 === b.사용일자 ? (a.지출ID < b.지출ID ? 1 : -1) : (a.사용일자 < b.사용일자 ? 1 : -1)));
}

function renderList() {
  const root = el('view-list');
  const f = State.listFilters;
  const meta = State.boot?.meta;
  if (!meta) { root.innerHTML = ''; return; }

  const rows = filteredExpenses();
  const total = rows.reduce((a, e) => a + e.금액, 0);

  const chips = (name, values, current) => `
    <div class="chip-group">
      ${values.map(v => `<button class="chip ${v === current ? 'is-active' : ''}" data-filter="${name}" data-value="${UI.esc(v)}">${UI.esc(v)}</button>`).join('')}
    </div>`;

  root.innerHTML = `
    <div class="card">
      <div class="field"><span>항목</span>${chips('항목', ['전체', ...meta.categories], f.항목)}</div>
      ${f.항목 === '목회비'
        ? `<div class="field"><span>목회비 세부항목</span>
             <select data-filter-select="세부">
               ${['전체', ...meta.subcategories].map(s => `<option${s === f.세부 ? ' selected' : ''}>${UI.esc(s)}</option>`).join('')}
             </select></div>` : ''}
      <div class="field"><span>기간</span>${chips('기간', ['이번 달', '지난 달', '올해', '전체', '사용자 지정'], f.기간)}</div>
      ${f.기간 === '사용자 지정'
        ? `<div class="row">
             <label class="field"><span>시작</span><input type="date" data-filter-date="from" value="${f.from}"></label>
             <label class="field"><span>종료</span><input type="date" data-filter-date="to" value="${f.to}"></label>
           </div>` : ''}
      <div class="field" style="margin-bottom:0"><span>상태</span>
        ${chips('상태', ['전체', '미제출', '제출완료', '미정산', '정산완료', '금액불일치'], f.상태)}
      </div>
    </div>

    <div class="total-row"><span>${rows.length}건</span><span>${UI.won(total)}</span></div>

    <div class="list">
      ${rows.length ? rows.map(expenseCard).join('')
        : `<div class="empty">${UI.icon('search-x')}조건에 맞는 지출이 없습니다.</div>`}
    </div>`;

  UI.refreshIcons(root);

  root.querySelectorAll('[data-filter]').forEach(btn => {
    btn.onclick = () => {
      State.listFilters[btn.dataset.filter] = btn.dataset.value;
      if (btn.dataset.filter === '항목' && btn.dataset.value !== '목회비') State.listFilters.세부 = '전체';
      renderList();
    };
  });
  root.querySelectorAll('[data-filter-select]').forEach(sel => {
    sel.onchange = () => { State.listFilters[sel.dataset.filterSelect] = sel.value; renderList(); };
  });
  root.querySelectorAll('[data-filter-date]').forEach(inp => {
    inp.onchange = () => { State.listFilters[inp.dataset.filterDate] = inp.value; renderList(); };
  });
  bindExpenseCards(root);
}

/* ---------------- 지출 상세 (바텀시트) ---------------- */

async function openExpenseDetail(id) {
  const e = (State.boot?.expenses || []).find(x => x.지출ID === id);
  if (!e) return;
  const meta = State.boot.meta;

  const body = UI.openSheet(`
    <h2 class="sheet-title">${UI.esc(e.지출ID)}</h2>
    <div id="detail-image"></div>
    <div class="spacer"></div>
    <label class="field"><span>항목</span>
      <select id="d-cat">${meta.categories.map(c => `<option${c === e.항목 ? ' selected' : ''}>${c}</option>`).join('')}</select>
    </label>
    <label class="field" id="d-subwrap"><span>목회비 세부항목</span>
      <select id="d-sub">${meta.subcategories.map(s => `<option${s === e.목회비세부항목 ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </label>
    <label class="field"><span>사용일자</span><input type="date" id="d-date" value="${UI.esc(e.사용일자)}"></label>
    <label class="field"><span>금액</span><input type="number" id="d-amt" inputmode="numeric" value="${e.금액}"></label>
    <label class="field" id="d-descwrap"><span>인원/내용</span><input type="text" id="d-desc" value="${UI.esc(e.인원_내용)}"></label>
    <label class="field" id="d-subwrap2"><span>정기구독 연결
        <span class="hint">연결하면 그 달 예상액이 실제 금액으로 바뀝니다.</span></span>
      <select id="d-sublink">
        <option value="">연결 안 함</option>
        ${(State.boot.subscriptions || []).map(su => `<option value="${UI.esc(su.구독ID)}"${su.구독ID === e.연결구독ID ? ' selected' : ''}>${UI.esc(su.구독명)}${su.활성상태 === '해지' ? ' · 해지' : ''}</option>`).join('')}
      </select>
    </label>
    <label class="field"><span>비고</span><textarea id="d-note">${UI.esc(e.비고)}</textarea></label>
    <label class="field"><span>영수증 제출상태</span>
      <select id="d-submitted">
        <option${e.영수증제출상태 === '미제출' ? ' selected' : ''}>미제출</option>
        <option${e.영수증제출상태 === '제출완료' ? ' selected' : ''}>제출완료</option>
      </select>
      ${e.제출일 ? `<span class="hint">제출일 ${UI.dateLabel(e.제출일)}</span>` : ''}
    </label>
    <div class="kv"><span class="k">정산상태</span><span class="v">${UI.esc(e.정산상태)}${e.정산기록ID ? ' · ' + UI.esc(e.정산기록ID) : ''}</span></div>
    <div class="spacer"></div>
    <p class="form-error" id="d-error" hidden></p>
    <div class="row">
      <button class="btn btn-danger" id="d-delete">${UI.icon('trash-2')} 삭제</button>
      <button class="btn btn-primary" id="d-save">저장</button>
    </div>`);

  const syncVisibility = () => {
    const cat = body.querySelector('#d-cat').value;
    body.querySelector('#d-subwrap').hidden = cat !== '목회비';
    body.querySelector('#d-subwrap2').hidden = cat !== '목회비';
    body.querySelector('#d-descwrap').hidden = cat === '주유비';
  };
  body.querySelector('#d-cat').onchange = syncVisibility;
  body.querySelector('#d-sublink').onchange = ev => {
    const sub = (State.boot.subscriptions || []).find(x => x.구독ID === ev.target.value);
    if (sub) body.querySelector('#d-sub').value = sub.목회비세부항목;
  };
  syncVisibility();
  UI.refreshIcons(body);

  // 영수증 이미지는 Drive 비공개 파일이라 서버를 거쳐 가져옵니다.
  if (e.영수증이미지URL) {
    const frame = body.querySelector('#detail-image');
    frame.innerHTML = `<p class="form-note">영수증 불러오는 중…</p>`;
    API.call('receiptImage', { url: e.영수증이미지URL })
      .then(img => {
        frame.innerHTML = img
          ? `<div class="receipt-frame"><img src="data:${img.mimeType};base64,${img.data}" alt="영수증"></div>
             <p class="form-note" style="margin-top:8px"><a href="${UI.esc(e.영수증이미지URL)}" target="_blank" rel="noopener">Drive 에서 열기</a></p>`
          : `<p class="form-note">영수증 이미지를 찾지 못했습니다.</p>`;
      })
      .catch(() => { frame.innerHTML = `<p class="form-note">영수증을 불러오지 못했습니다.</p>`; });
  }

  body.querySelector('#d-save').onclick = async () => {
    const err = body.querySelector('#d-error');
    err.hidden = true;
    const payload = {
      지출ID: e.지출ID,
      항목: body.querySelector('#d-cat').value,
      목회비세부항목: body.querySelector('#d-sub').value,
      사용일자: body.querySelector('#d-date').value,
      금액: Number(body.querySelector('#d-amt').value),
      인원_내용: body.querySelector('#d-desc').value,
      비고: body.querySelector('#d-note').value,
      영수증제출상태: body.querySelector('#d-submitted').value,
      연결구독ID: body.querySelector('#d-cat').value === '목회비'
        ? body.querySelector('#d-sublink').value : ''
    };
    UI.loading(true, '저장 중…');
    try {
      await API.call('updateExpense', payload);
      UI.closeSheet();
      UI.toast('수정했습니다.');
      await reload();
    } catch (ex) {
      err.hidden = false; err.textContent = ex.message;
    } finally { UI.loading(false); }
  };

  body.querySelector('#d-delete').onclick = async () => {
    const warn = e.정산기록ID
      ? `이 지출은 정산기록 ${e.정산기록ID} 에 연결되어 있습니다.\n삭제하면 해당 정산의 합계와 차액이 다시 계산됩니다.`
      : '이 지출을 삭제합니다. 되돌릴 수 없습니다.';
    if (!await UI.confirmSheet('지출 삭제', warn, '삭제', true)) { openExpenseDetail(id); return; }
    UI.loading(true, '삭제 중…');
    try {
      await API.call('deleteExpense', { 지출ID: e.지출ID, force: true });
      UI.closeSheet();
      UI.toast('삭제했습니다.');
      await reload();
    } catch (ex) {
      UI.toast(ex.message, 'danger');
    } finally { UI.loading(false); }
  };
}

/* ---------------- 화면 A. 영수증 업로드 ---------------- */

function resetUpload() {
  State.upload = null;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderUpload() {
  const root = el('view-upload');
  const u = State.upload;

  if (!u) {
    root.innerHTML = `
      <div class="card">
        <div class="card-head"><div class="card-title">${UI.icon('receipt-text')} 영수증 등록</div></div>
        <p class="form-note" style="margin-top:0">사진을 올리면 날짜·금액·항목을 자동으로 읽어 초안을 채웁니다. 저장 전에 직접 확인하고 고치실 수 있습니다.</p>
        <div class="uploader">
          <button class="btn" id="btn-camera">${UI.icon('camera')} 카메라 촬영</button>
          <button class="btn" id="btn-file">${UI.icon('image')} 파일 선택</button>
        </div>
        <input type="file" accept="image/*" capture="environment" id="input-camera" hidden>
        <input type="file" accept="image/*" id="input-file" hidden>
      </div>`;
    UI.refreshIcons(root);
    root.querySelector('#btn-camera').onclick = () => root.querySelector('#input-camera').click();
    root.querySelector('#btn-file').onclick = () => root.querySelector('#input-file').click();
    root.querySelectorAll('input[type=file]').forEach(inp => { inp.onchange = () => handleReceiptFile(inp.files[0]); });
    return;
  }

  if (u.analyzing) {
    root.innerHTML = `
      <div class="receipt-frame"><img src="${u.dataUrl}" alt="영수증 미리보기"></div>
      <div class="card" style="text-align:center">
        <div class="spinner" style="margin:6px auto 14px"></div>
        <p class="muted" style="margin:0">영수증을 분석하고 있습니다…</p>
      </div>`;
    return;
  }

  const f = u.form;
  const meta = State.boot.meta;
  const isPastoral = f.항목 === '목회비';
  const needsDesc = f.항목 === '목회비' || f.항목 === '경비';

  const missing = [];
  if (!f.사용일자) missing.push('사용일자');
  if (!Number(f.금액)) missing.push('금액');
  if (isPastoral && !f.목회비세부항목) missing.push('목회비 세부항목');
  if (needsDesc && !String(f.인원_내용).trim()) missing.push('인원/내용');

  root.innerHTML = `
    <div class="receipt-frame"><img src="${u.dataUrl}" alt="영수증"></div>

    <div class="card">
      ${u.analysisError ? `<p class="form-error">${UI.esc(u.analysisError)}</p>` : ''}
      ${u.analysis?.vendor ? `<p class="form-note" style="margin-top:0">인식한 상호: <b>${UI.esc(u.analysis.vendor)}</b>${u.analysis.confidence ? ` · 신뢰도 ${UI.esc(u.analysis.confidence)}` : ''}</p>` : ''}
      ${u.bytes ? `<p class="form-note" style="margin-top:0">저장 크기 ${UI.fileSize(u.bytes)}${u.originalBytes > u.bytes ? ` (원본 ${UI.fileSize(u.originalBytes)} 에서 줄임)` : ''} · ${u.width}×${u.height}</p>` : ''}

      <div class="field"><span>항목</span>
        <div class="chip-group">
          ${meta.categories.map(c => `<button class="chip ${c === f.항목 ? 'is-active' : ''}" data-cat="${c}">${c}</button>`).join('')}
        </div>
      </div>

      ${isPastoral ? subscriptionField(f, u.subscriptionMatch) : ''}

      ${isPastoral ? `
        <div class="field"><span>목회비 세부항목 <span class="hint">필수</span></span>
          <div class="chip-group">
            ${meta.subcategories.map(s => `<button class="chip ${s === f.목회비세부항목 ? 'is-active' : ''}" data-sub="${UI.esc(s)}">${UI.esc(s)}</button>`).join('')}
          </div>
        </div>
        <div id="health-gauge">${healthGaugeHtml(f)}</div>` : ''}

      <label class="field"><span>사용일자</span>
        <input type="date" id="f-date" value="${UI.esc(f.사용일자)}">
      </label>

      <label class="field"><span>금액</span>
        <input type="number" id="f-amt" inputmode="numeric" placeholder="0" value="${f.금액 || ''}">
      </label>

      ${needsDesc ? `
        <label class="field"><span>인원/내용 <span class="hint">필수 — 예: 청년부 리더 3명 심방 식사</span></span>
          <input type="text" id="f-desc" value="${UI.esc(f.인원_내용)}">
        </label>` : ''}

      <div class="collapse-toggle">
        <button class="link-btn" id="toggle-note">${f.noteOpen ? '비고 접기' : '비고 추가'}</button>
      </div>
      ${f.noteOpen ? `<label class="field"><textarea id="f-note" placeholder="자유 메모">${UI.esc(f.비고)}</textarea></label>` : ''}
    </div>

    <div class="sticky-actions">
      ${missing.length ? `<p class="form-error">${UI.esc(missing.join(' · '))} 을(를) 입력해야 저장할 수 있습니다.</p>` : ''}
      <div class="row">
        <button class="btn" id="f-cancel">다시 찍기</button>
        <button class="btn btn-primary" id="f-save" ${missing.length ? 'disabled' : ''}>저장</button>
      </div>
    </div>`;

  UI.refreshIcons(root);
  bindUploadForm(root);
}

/**
 * 정기구독 연결 필드.
 * 자동으로 찾았으면 미리 골라 두고, 못 찾았어도 직접 고를 수 있게 항상 보여 줍니다.
 * (온라인 결제 전표는 상호가 결제대행사로 찍혀 자동 매칭이 빗나갈 수 있습니다.)
 */
function subscriptionField(f, match) {
  const subs = State.boot.subscriptions || [];
  if (!subs.length) return '';

  const month = String(f.사용일자 || '').slice(0, 7);
  const inRange = s => (!s.시작월 || month >= s.시작월) && (!s.종료월 || month <= s.종료월);
  const sorted = subs.slice().sort((a, b) => {
    const ar = inRange(a) ? 0 : 1, br = inRange(b) ? 0 : 1;
    return ar - br || a.구독명.localeCompare(b.구독명, 'ko');
  });

  const auto = match && f.연결구독ID === match.구독ID;
  return `
    <div class="field">
      <span>정기구독 연결 <span class="hint">해당하면 고르십시오. 그 달 예상액이 실제 금액으로 바뀝니다.</span></span>
      <select id="f-sub">
        <option value="">연결 안 함</option>
        ${sorted.map(s => `<option value="${UI.esc(s.구독ID)}"${s.구독ID === f.연결구독ID ? ' selected' : ''}>
          ${UI.esc(s.구독명)}${inRange(s) ? '' : ' · 기간 밖'}${s.활성상태 === '해지' ? ' · 해지' : ''}
        </option>`).join('')}
      </select>
      ${auto ? `<span class="hint" style="color:var(--accent)">영수증에서 자동으로 찾았습니다.</span>` : ''}
    </div>`;
}

/** 건강관리 미니 게이지 — 저장 전에 한도 초과 여부를 바로 확인합니다. */
function healthGaugeHtml(f) {
  if (f.목회비세부항목 !== '건강관리') return '';
  const d = State.boot.dashboard;
  const health = d.목회비.세부항목.find(s => s.이름 === '건강관리');
  const limit = health?.한도 || 0;
  const used = (health?.실사용 || 0) + (Number(f.금액) || 0);
  const over = used - limit;
  return `
    <div class="mini-gauge">
      <div class="gauge-meta"><span>건강관리 사용액</span><span>${UI.num(used)} / ${UI.num(limit)}원</span></div>
      ${UI.gauge(used, limit)}
      ${over > 0 ? `<p class="form-error" style="margin:4px 0 12px">한도를 ${UI.won(over)} 초과합니다. 저장은 가능합니다.</p>` : '<div class="spacer"></div>'}
    </div>`;
}

async function handleReceiptFile(file) {
  if (!file) return;
  try {
    const img = await UI.readImage(file);
    State.upload = { ...img, analyzing: true, form: null };
    renderUpload();

    let analysis = null, subscriptionMatch = null, analysisError = '';
    try {
      const res = await API.call('analyzeReceipt', { imageBase64: img.base64, mimeType: img.mimeType });
      if (res.ok) { analysis = res.data; subscriptionMatch = res.subscriptionMatch; }
      else analysisError = res.error + ' 값을 직접 입력해 주세요.';
    } catch (e) {
      analysisError = '자동 분석에 실패했습니다 (' + e.message + '). 값을 직접 입력해 주세요.';
    }

    const cat = analysis?.suggested_category || '경비';
    State.upload = {
      ...State.upload,
      analyzing: false,
      analysis,
      analysisError,
      subscriptionMatch,
      form: {
        항목: subscriptionMatch ? '목회비' : cat,
        // 정기구독을 찾았으면 세부항목은 구독 설정을 따릅니다(영수증 추론보다 정확합니다).
        목회비세부항목: subscriptionMatch
          ? subscriptionMatch.목회비세부항목
          : (cat === '목회비' ? (analysis?.suggested_subcategory || '') : ''),
        사용일자: analysis?.date || todayStr(),
        금액: analysis?.amount || '',
        인원_내용: subscriptionMatch ? subscriptionMatch.구독명 : '',
        비고: '',
        연결구독ID: subscriptionMatch ? subscriptionMatch.구독ID : '',
        noteOpen: false
      }
    };
    renderUpload();
  } catch (e) {
    UI.toast(e.message, 'danger');
    resetUpload();
    renderUpload();
  }
}

function bindUploadForm(root) {
  const u = State.upload, f = u.form;

  root.querySelectorAll('[data-cat]').forEach(btn => {
    btn.onclick = () => {
      f.항목 = btn.dataset.cat;
      if (f.항목 !== '목회비') { f.목회비세부항목 = ''; f.연결구독ID = ''; }
      if (f.항목 === '주유비') f.인원_내용 = '';
      renderUpload();
    };
  });

  root.querySelectorAll('[data-sub]').forEach(btn => {
    btn.onclick = () => { f.목회비세부항목 = btn.dataset.sub; renderUpload(); };
  });

  const subSel = root.querySelector('#f-sub');
  if (subSel) subSel.onchange = () => {
    f.연결구독ID = subSel.value;
    const sub = (State.boot.subscriptions || []).find(x => x.구독ID === f.연결구독ID);
    if (sub) {
      // 구독을 고르면 세부항목과 내용을 구독 설정에 맞춥니다.
      f.목회비세부항목 = sub.목회비세부항목 || f.목회비세부항목;
      if (!String(f.인원_내용).trim()) f.인원_내용 = sub.구독명;
    }
    renderUpload();
  };

  const date = root.querySelector('#f-date');
  if (date) date.onchange = () => { f.사용일자 = date.value; };

  const amt = root.querySelector('#f-amt');
  if (amt) amt.oninput = () => {
    f.금액 = amt.value;
    const g = root.querySelector('#health-gauge');
    if (g) { g.innerHTML = healthGaugeHtml(f); UI.refreshIcons(g); }
    root.querySelector('#f-save').disabled = !canSaveUpload(f);
  };

  const desc = root.querySelector('#f-desc');
  if (desc) desc.oninput = () => {
    f.인원_내용 = desc.value;
    root.querySelector('#f-save').disabled = !canSaveUpload(f);
  };

  const note = root.querySelector('#f-note');
  if (note) note.oninput = () => { f.비고 = note.value; };

  root.querySelector('#toggle-note').onclick = () => { f.noteOpen = !f.noteOpen; renderUpload(); };
  root.querySelector('#f-cancel').onclick = () => { resetUpload(); renderUpload(); };
  root.querySelector('#f-save').onclick = saveUpload;
}

function canSaveUpload(f) {
  if (!f.사용일자 || !Number(f.금액)) return false;
  if (f.항목 === '목회비' && !f.목회비세부항목) return false;
  if ((f.항목 === '목회비' || f.항목 === '경비') && !String(f.인원_내용).trim()) return false;
  return true;
}

async function saveUpload() {
  const u = State.upload, f = u.form;
  if (!canSaveUpload(f)) return;
  UI.loading(true, '저장 중…');
  try {
    await API.call('createExpense', {
      항목: f.항목,
      목회비세부항목: f.목회비세부항목,
      사용일자: f.사용일자,
      금액: Number(f.금액),
      인원_내용: f.인원_내용,
      비고: f.비고,
      연결구독ID: f.연결구독ID,
      imageBase64: u.base64,
      mimeType: u.mimeType
    });
    resetUpload();
    UI.toast('등록했습니다. 영수증 제출상태는 “미제출”입니다.');
    await reload();
    go('dashboard');
  } catch (e) {
    UI.toast(e.message, 'danger');
  } finally { UI.loading(false); }
}

/* ---------------- 화면 D. 정산 대사 ---------------- */

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function renderSettle() {
  const s = State.settle;
  if (!s.month) s.month = currentMonthStr();

  const root = el('view-settle');
  const isPastoral = s.tab === '목회비정산';

  root.innerHTML = `
    <div class="segmented" id="settle-tabs" style="align-self:center">
      <button data-tab="목회비정산" class="${isPastoral ? 'is-active' : ''}">목회비 정산</button>
      <button data-tab="경비정산" class="${isPastoral ? '' : 'is-active'}">경비 정산 (주유비+경비)</button>
    </div>

    <div class="card">
      <label class="field" ${isPastoral ? '' : 'style="margin-bottom:12px"'}>
        <span>대상 ${isPastoral ? '월' : '월 선택'}</span>
        <input type="month" id="s-month" value="${s.month}">
      </label>
      ${isPastoral ? '' : `
        <label class="field" style="margin-bottom:0"><span>주차 <span class="hint">월요일 시작 (ISO 기준)</span></span>
          <select id="s-week"><option>불러오는 중…</option></select>
        </label>`}
    </div>

    <div id="settle-body"><div class="empty">${UI.icon('loader')}불러오는 중…</div></div>

    <div class="section-title">정산 기록</div>
    <div class="list" id="settle-history"></div>`;

  UI.refreshIcons(root);

  root.querySelector('#settle-tabs').onclick = ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    State.settle = { ...State.settle, tab: btn.dataset.tab, week: '', candidates: [], selected: {}, capture: null };
    renderSettle();
  };
  root.querySelector('#s-month').onchange = async ev => {
    s.month = ev.target.value;
    s.week = '';
    await refreshSettleTarget();
  };

  renderSettleHistory();
  await refreshSettleTarget();
}

async function refreshSettleTarget() {
  const s = State.settle;
  const root = el('view-settle');
  const body = root.querySelector('#settle-body');
  if (!body) return;

  if (s.tab === '경비정산') {
    const weekSel = root.querySelector('#s-week');
    try {
      const { weeks } = await API.call('weeksOfMonth', { month: s.month });
      s.weeks = weeks;
      if (!s.week || !weeks.some(w => w.key === s.week)) s.week = weeks[0]?.key || '';
      weekSel.innerHTML = weeks.map(w => `<option value="${w.key}"${w.key === s.week ? ' selected' : ''}>${UI.esc(w.label)}</option>`).join('');
      weekSel.onchange = async () => { s.week = weekSel.value; await loadCandidates(); };
    } catch (e) {
      weekSel.innerHTML = '<option>주차를 불러오지 못했습니다</option>';
      return;
    }
  }
  await loadCandidates();
}

async function loadCandidates() {
  const s = State.settle;
  const body = el('view-settle').querySelector('#settle-body');
  const period = s.tab === '목회비정산' ? s.month : s.week;
  if (!period) { body.innerHTML = ''; return; }

  body.innerHTML = `<div class="empty">${UI.icon('loader')}불러오는 중…</div>`;
  UI.refreshIcons(body);
  try {
    const { candidates } = await API.call('settlementCandidates', { 정산유형: s.tab, 대상기간: period });
    s.candidates = candidates;
    s.selected = {};
    candidates.forEach(c => { if (!c.정산기록ID) s.selected[c.지출ID] = true; }); // 기본 전체 선택
    renderSettleForm();
  } catch (e) {
    body.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`;
  }
}

function renderSettleForm() {
  const s = State.settle;
  const body = el('view-settle').querySelector('#settle-body');
  const open = s.candidates.filter(c => !c.정산기록ID);
  const done = s.candidates.filter(c => c.정산기록ID);
  const sum = open.filter(c => s.selected[c.지출ID]).reduce((a, c) => a + c.금액, 0);

  if (!s.candidates.length) {
    body.innerHTML = `<div class="empty">${UI.icon('inbox')}이 기간에 정산할 지출이 없습니다.</div>`;
    UI.refreshIcons(body);
    return;
  }

  const row = c => `
    <label class="check-row">
      <input type="checkbox" data-pick="${UI.esc(c.지출ID)}" ${s.selected[c.지출ID] ? 'checked' : ''}>
      <div class="cr-body">
        <div class="cr-top">${UI.dateLabel(c.사용일자)} · ${UI.esc(c.항목)}${c.목회비세부항목 ? ' · ' + UI.esc(c.목회비세부항목) : ''}</div>
        <div class="cr-desc">${UI.esc(c.인원_내용 || '주유')}</div>
      </div>
      <div class="cr-amt">${UI.won(c.금액)}</div>
    </label>`;

  body.innerHTML = `
    <div class="list">${open.map(row).join('') || `<div class="empty">${UI.icon('circle-check')}이 기간의 지출은 모두 정산되었습니다.</div>`}</div>

    ${done.length ? `
      <div class="section-title" style="margin-top:16px">이미 정산됨</div>
      <div class="list">${done.map(c => `
        <div class="check-row" style="opacity:.6">
          <div class="cr-body">
            <div class="cr-top">${UI.dateLabel(c.사용일자)} · ${UI.esc(c.정산기록ID)}</div>
            <div class="cr-desc">${UI.esc(c.인원_내용 || '주유')}</div>
          </div>
          <div class="cr-amt">${UI.won(c.금액)}</div>
        </div>`).join('')}</div>` : ''}

    ${open.length ? `
      <div class="spacer"></div>
      <div class="total-row"><span>선택 지출 합계</span><span id="s-sum">${UI.won(sum)}</span></div>

      <div class="card" style="margin-top:14px">
        <div class="field"><span>입금 확인 방식</span>
          <div class="segmented" id="s-method">
            <button data-method="수기입력" class="${s.method === '수기입력' ? 'is-active' : ''}">직접 금액 입력</button>
            <button data-method="캡처이미지" class="${s.method === '캡처이미지' ? 'is-active' : ''}">캡처 이미지</button>
          </div>
        </div>

        ${s.method === '캡처이미지' ? `
          <div class="field">
            ${s.capture ? `<div class="receipt-frame"><img src="${s.capture.dataUrl}" alt="입금 캡처"></div>` : ''}
            <button class="btn" id="s-capture-btn">${UI.icon('image')} ${s.capture ? '캡처 다시 선택' : '입금 캡처 이미지 선택'}</button>
            <input type="file" accept="image/*" id="s-capture-input" hidden>
          </div>` : ''}

        <label class="field"><span>입금액</span>
          <input type="number" id="s-deposit" inputmode="numeric" placeholder="${sum}" value="${s.deposit ?? ''}">
          <span class="hint">비워두면 선택 합계(${UI.won(sum)})와 같은 금액으로 저장합니다.</span>
        </label>
        <label class="field" style="margin-bottom:0"><span>입금일</span>
          <input type="date" id="s-depositdate" value="${s.depositDate || State.boot.meta.today}">
        </label>
      </div>

      <div class="sticky-actions">
        <button class="btn btn-primary btn-block" id="s-save" ${sum ? '' : 'disabled'}>정산 저장</button>
      </div>` : ''}`;

  UI.refreshIcons(body);

  body.querySelectorAll('[data-pick]').forEach(cb => {
    cb.onchange = () => {
      s.selected[cb.dataset.pick] = cb.checked;
      const newSum = open.filter(c => s.selected[c.지출ID]).reduce((a, c) => a + c.금액, 0);
      const sumEl = body.querySelector('#s-sum');
      if (sumEl) sumEl.textContent = UI.won(newSum);
      const dep = body.querySelector('#s-deposit');
      if (dep) dep.placeholder = newSum;
      const save = body.querySelector('#s-save');
      if (save) save.disabled = !newSum;
    };
  });

  const methodBox = body.querySelector('#s-method');
  if (methodBox) methodBox.onclick = ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    s.method = btn.dataset.method;
    renderSettleForm();
  };

  const capBtn = body.querySelector('#s-capture-btn');
  if (capBtn) {
    const input = body.querySelector('#s-capture-input');
    capBtn.onclick = () => input.click();
    input.onchange = async () => {
      if (!input.files[0]) return;
      try {
        s.capture = await UI.readImage(input.files[0]);
        renderSettleForm();
      } catch (e) { UI.toast(e.message, 'danger'); }
    };
  }

  const dep = body.querySelector('#s-deposit');
  if (dep) dep.oninput = () => { s.deposit = dep.value; };
  const depDate = body.querySelector('#s-depositdate');
  if (depDate) depDate.onchange = () => { s.depositDate = depDate.value; };

  const save = body.querySelector('#s-save');
  if (save) save.onclick = () => submitSettlement(open);
}

async function submitSettlement(open) {
  const s = State.settle;
  const ids = open.filter(c => s.selected[c.지출ID]).map(c => c.지출ID);
  const sum = open.filter(c => s.selected[c.지출ID]).reduce((a, c) => a + c.금액, 0);
  const deposit = Number(s.deposit) || sum;
  const period = s.tab === '목회비정산' ? s.month : s.week;

  UI.loading(true, '정산 저장 중…');
  try {
    const res = await API.call('createSettlement', {
      정산유형: s.tab,
      대상기간: period,
      입금액: deposit,
      입금일: s.depositDate || State.boot.meta.today,
      입금확인방식: s.method,
      imageBase64: s.method === '캡처이미지' ? s.capture?.base64 : '',
      mimeType: s.capture?.mimeType || '',
      연결된지출ID목록: ids
    });
    State.settle = { ...s, selected: {}, capture: null, deposit: '', depositDate: '' };
    UI.toast(res.차액 === 0 ? '정산 완료 — 금액이 일치합니다.' : `차액 ${UI.won(Math.abs(res.차액))} 발생`, res.차액 === 0 ? '' : 'danger');
    await reload();
    go('settle');
  } catch (e) {
    UI.toast(e.message, 'danger');
  } finally { UI.loading(false); }
}

function renderSettleHistory() {
  const box = el('view-settle').querySelector('#settle-history');
  if (!box) return;
  const all = (State.boot?.settlements || []).slice();
  // 불일치 건을 최상단에 고정합니다.
  all.sort((a, b) => {
    const am = a.차액 !== 0 ? 0 : 1, bm = b.차액 !== 0 ? 0 : 1;
    if (am !== bm) return am - bm;
    return a.입금일 < b.입금일 ? 1 : -1;
  });

  if (!all.length) {
    box.innerHTML = `<div class="empty">${UI.icon('inbox')}아직 정산 기록이 없습니다.</div>`;
    UI.refreshIcons(box);
    return;
  }

  box.innerHTML = all.map(st => `
    <button class="item-card" data-settlement="${UI.esc(st.정산ID)}">
      <div class="item-icon">${UI.icon(st.차액 === 0 ? 'circle-check' : 'triangle-alert')}</div>
      <div class="item-body">
        <div class="item-top">${UI.dateLabel(st.입금일)} · ${UI.esc(st.정산유형)} · ${UI.esc(st.대상기간)}</div>
        <div class="item-desc">입금 ${UI.won(st.입금액)} · 지출 ${UI.won(st.연결지출합계)} · ${st.연결된지출ID목록.length}건</div>
        <div class="item-badges">
          ${st.차액 === 0
            ? `<span class="badge ok">${UI.icon('circle-check')}일치</span>`
            : `<span class="badge danger">${UI.icon('triangle-alert')}차액 ${UI.won(Math.abs(st.차액))} ${st.차액 > 0 ? '더 입금' : '덜 입금'}</span>`}
        </div>
      </div>
    </button>`).join('');

  UI.refreshIcons(box);
  box.querySelectorAll('[data-settlement]').forEach(btn => {
    btn.onclick = () => openSettlementDetail(btn.dataset.settlement);
  });
}

function openSettlementDetail(id) {
  const st = (State.boot?.settlements || []).find(x => x.정산ID === id);
  if (!st) return;
  const byId = {};
  (State.boot.expenses || []).forEach(e => { byId[e.지출ID] = e; });

  const body = UI.openSheet(`
    <h2 class="sheet-title">${UI.esc(st.정산ID)}</h2>
    <div class="kv"><span class="k">정산유형</span><span class="v">${UI.esc(st.정산유형)}</span></div>
    <div class="kv"><span class="k">대상기간</span><span class="v">${UI.esc(st.대상기간)}</span></div>
    <div class="kv"><span class="k">입금일</span><span class="v">${UI.dateLabel(st.입금일)}</span></div>
    <div class="kv"><span class="k">입금액</span><span class="v">${UI.won(st.입금액)}</span></div>
    <div class="kv"><span class="k">연결지출 합계</span><span class="v">${UI.won(st.연결지출합계)}</span></div>
    <div class="kv"><span class="k">차액</span><span class="v" style="color:${st.차액 === 0 ? 'var(--ok)' : 'var(--danger)'}">${st.차액 === 0 ? '없음 (일치)' : UI.won(st.차액)}</span></div>
    <div class="kv"><span class="k">입금 확인</span><span class="v">${UI.esc(st.입금확인방식)}${st.입금캡처이미지URL ? ` · <a href="${UI.esc(st.입금캡처이미지URL)}" target="_blank" rel="noopener">캡처 보기</a>` : ''}</span></div>

    <div class="section-title" style="margin:18px 0 8px">연결된 지출 ${st.연결된지출ID목록.length}건</div>
    <div class="list">
      ${st.연결된지출ID목록.map(eid => {
        const e = byId[eid];
        return e ? expenseCard(e) : `<div class="empty">${UI.esc(eid)} (삭제됨)</div>`;
      }).join('')}
    </div>

    <div class="spacer"></div>
    <button class="btn btn-danger btn-block" id="st-delete">${UI.icon('trash-2')} 정산 기록 삭제</button>
    <p class="form-note" style="margin-top:10px">삭제하면 연결된 지출이 모두 “미정산”으로 되돌아갑니다.</p>`);

  UI.refreshIcons(body);
  bindExpenseCards(body);

  body.querySelector('#st-delete').onclick = async () => {
    if (!await UI.confirmSheet('정산 기록 삭제', '연결된 지출이 모두 미정산으로 되돌아갑니다.', '삭제', true)) return;
    UI.loading(true, '삭제 중…');
    try {
      await API.call('deleteSettlement', { 정산ID: id });
      UI.closeSheet();
      UI.toast('정산 기록을 삭제했습니다.');
      await reload();
      go('settle');
    } catch (e) { UI.toast(e.message, 'danger'); }
    finally { UI.loading(false); }
  };
}

/* ---------------- 화면 E. 설정 ---------------- */

/**
 * 예산 응답 정규화.
 * 세부 한도를 지원하지 않는 이전 버전 백엔드가 응답해도 화면이 죽지 않도록,
 * 빠진 필드를 채워 넣습니다.
 */
function normalizeBudget(raw) {
  const b = Object.assign({}, raw);
  b.연도 = Number(b.연도) || new Date().getFullYear();
  b.목회비연간한도 = Number(b.목회비연간한도) || 0;
  b.주유비연간한도 = Number(b.주유비연간한도) || 0;

  if (!b.세부한도 || typeof b.세부한도 !== 'object') {
    b.세부한도 = {};
    const legacy = Number(b.목회비_건강관리한도) || 0;
    if (legacy) b.세부한도['건강관리'] = legacy;
  }
  if (b.건강관리자동 === undefined) b.건강관리자동 = !b.세부한도['건강관리'];
  return b;
}

function renderSettings() {
  const root = el('view-settings');
  const b = State.boot;
  if (!b) { root.innerHTML = ''; return; }

  const budgets = (b.budgets && b.budgets.length ? b.budgets : [b.budget]).map(normalizeBudget);
  if (!State.budgetYear || !budgets.some(x => x.연도 === State.budgetYear)) {
    State.budgetYear = (budgets.find(x => x.연도 === b.budget.연도) || budgets[0]).연도;
  }
  const budget = budgets.find(x => x.연도 === State.budgetYear) || normalizeBudget(b.budget);
  const cfg = API.getConfig();

  // 세부 한도: 설정된 것만 목록에 보여 주고, 나머지는 "한도 추가" 에서 고릅니다.
  const meta = b.meta;
  const limitNames = meta.subcategories.filter(n => budget.세부한도[n]);
  const addable = meta.subcategories.filter(n => !budget.세부한도[n]);

  const limitRow = n => {
    const auto = n === '건강관리' && budget.건강관리자동;
    return `
      <div class="limit-row">
        ${UI.icon(UI.SUB_ICON[n] || 'circle-ellipsis')}
        <span class="limit-name">${UI.esc(n)}${auto ? '<span class="hint"> 자동 20%</span>' : ''}</span>
        <input type="number" inputmode="numeric" data-limit="${UI.esc(n)}" value="${budget.세부한도[n]}">
        <button class="icon-btn danger" data-limit-del="${UI.esc(n)}" aria-label="${UI.esc(n)} 한도 삭제">${UI.icon('trash-2')}</button>
      </div>`;
  };

  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="card-title">${UI.icon('wallet')} 예산 한도</div>
        <div style="display:flex;gap:6px;align-items:center">
          <select class="year-select" id="budget-year">
            ${budgets.map(x => `<option value="${x.연도}"${x.연도 === State.budgetYear ? ' selected' : ''}>${x.연도}년</option>`).join('')}
          </select>
          <button class="icon-btn" id="year-add" aria-label="연도 추가">${UI.icon('plus')}</button>
        </div>
      </div>

      <label class="field"><span>목회비 연간 한도</span>
        <input type="number" id="b-pastoral" inputmode="numeric" value="${budget.목회비연간한도}"></label>
      <label class="field"><span>주유비 연간 한도</span>
        <input type="number" id="b-fuel" inputmode="numeric" value="${budget.주유비연간한도}"></label>

      <div class="field">
        <span>목회비 세부 한도
          <span class="hint">필요한 항목에만 겁니다. 건강관리는 비워 두면 목회비 한도의 20% 로 자동 계산합니다.</span></span>
        <div class="limit-list">
          ${limitNames.length ? limitNames.map(limitRow).join('')
            : `<p class="form-note" style="margin:2px 0">설정된 세부 한도가 없습니다.</p>`}
        </div>
        ${addable.length ? `<button class="btn btn-sm" id="limit-add" style="margin-top:10px">${UI.icon('plus')} 세부 한도 추가</button>` : ''}
      </div>

      <button class="btn btn-primary btn-block" id="b-save">예산 저장</button>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-danger btn-sm" id="year-del">${UI.icon('trash-2')} ${budget.연도}년 예산 삭제</button>
      </div>
      <p class="form-note" style="margin:12px 0 0">매년 1월 1일에 전년도 값이 자동 복사됩니다(Apps Script 트리거).</p>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">${UI.icon('repeat')} 정기구독</div>
        <button class="btn btn-sm" id="sub-add">${UI.icon('plus')} 추가</button></div>
      <p class="form-note" style="margin:-6px 0 12px">항목을 탭하면 수정하거나 삭제할 수 있습니다.</p>
      <div class="list">
        ${b.subscriptions.length ? b.subscriptions.map(s => `
          <button class="item-card" data-sub-edit="${UI.esc(s.구독ID)}">
            <div class="item-icon">${UI.icon(UI.SUB_ICON[s.목회비세부항목] || 'repeat')}</div>
            <div class="item-body">
              <div class="item-top">${UI.esc(s.구독ID)} · ${UI.esc(s.목회비세부항목)}</div>
              <div class="item-desc">${UI.esc(s.구독명)}</div>
              <div class="item-amt">${UI.won(s.월예상금액)} / 월</div>
              <div class="item-badges">
                <span class="badge ${s.활성상태 === '사용중' ? 'ok' : ''}">${UI.esc(s.활성상태)}</span>
                <span class="badge">${UI.esc(s.시작월)} ~ ${UI.esc(s.종료월 || '계속')}</span>
                ${s.연결지출건수 ? `<span class="badge accent">지출 ${s.연결지출건수}건 연결</span>` : ''}
              </div>
            </div>
            ${UI.icon('chevron-right')}
          </button>`).join('')
          : `<div class="empty">${UI.icon('inbox')}등록된 정기구독이 없습니다.</div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">${UI.icon('hard-drive')} 연결 상태</div></div>
      <div id="drive-status"><p class="form-note" style="margin:0">확인 중…</p></div>
      <div class="spacer"></div>
      <div class="kv"><span class="k">앱 버전</span><span class="v">${APP_VERSION}</span></div>
      <div class="kv"><span class="k">웹앱 URL</span><span class="v" style="font-size:12px">${UI.esc(cfg.url)}</span></div>
      <button class="btn btn-block" id="app-refresh" style="margin-top:12px">${UI.icon('refresh-cw')} 최신 버전으로 새로고침</button>
      <button class="btn btn-block" id="reset-conn" style="margin-top:8px">${UI.icon('unplug')} 연결 정보 다시 입력</button>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">${UI.icon('download')} 데이터 내보내기</div></div>
      <div class="chip-group">
        ${['지출기록', '정산기록', '정기구독설정', '예산설정'].map(n => `<button class="chip" data-export="${n}">${n} CSV</button>`).join('')}
      </div>
    </div>`;

  UI.refreshIcons(root);
  bindSettings(root, budget, addable);
}

function bindSettings(root, budget, addable) {
  const b = State.boot;

  root.querySelector('#budget-year').onchange = ev => {
    State.budgetYear = Number(ev.target.value);
    renderSettings();
  };

  root.querySelector('#year-add').onclick = () => openYearSheet();

  root.querySelector('#b-save').onclick = async () => {
    const limits = {};
    root.querySelectorAll('[data-limit]').forEach(inp => { limits[inp.dataset.limit] = inp.value; });
    UI.loading(true, '저장 중…');
    try {
      await API.call('updateBudget', {
        연도: budget.연도,
        목회비연간한도: Number(root.querySelector('#b-pastoral').value),
        주유비연간한도: Number(root.querySelector('#b-fuel').value),
        세부한도: limits
      });
      UI.toast('예산을 저장했습니다.');
      await reload();
    } catch (e) { UI.toast(e.message, 'danger'); }
    finally { UI.loading(false); }
  };

  const addLimit = root.querySelector('#limit-add');
  if (addLimit) addLimit.onclick = () => openLimitSheet(budget.연도, addable);

  root.querySelectorAll('[data-limit-del]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.limitDel;
      const extra = name === '건강관리'
        ? '\n삭제하면 목회비 한도의 20% 자동 계산으로 돌아갑니다.'
        : '';
      if (!await UI.confirmSheet('세부 한도 삭제',
        `${budget.연도}년 ${name} 한도를 없앱니다.${extra}`, '삭제', true)) return;
      UI.loading(true, '삭제 중…');
      try {
        await API.call('deleteSubLimit', { 연도: budget.연도, 세부항목: name });
        UI.toast(`${name} 한도를 없앴습니다.`);
        await reload();
      } catch (e) { UI.toast(e.message, 'danger'); }
      finally { UI.loading(false); }
    };
  });

  root.querySelector('#year-del').onclick = async () => {
    const del = async force => API.call('deleteBudgetYear', { 연도: budget.연도, force });
    UI.loading(true, '삭제 중…');
    try {
      await del(false);
      UI.toast(`${budget.연도}년 예산을 삭제했습니다.`);
      State.budgetYear = null;
      await reload();
    } catch (e) {
      UI.loading(false);
      // 그 해에 지출이 있으면 서버가 막습니다. 내용을 그대로 보여 주고 다시 묻습니다.
      if (!/계속하시겠습니까/.test(e.message)) { UI.toast(e.message, 'danger'); return; }
      if (!await UI.confirmSheet('예산 연도 삭제', e.message, '삭제', true)) return;
      UI.loading(true, '삭제 중…');
      try {
        await del(true);
        UI.toast(`${budget.연도}년 예산을 삭제했습니다.`);
        State.budgetYear = null;
        await reload();
      } catch (e2) { UI.toast(e2.message, 'danger'); }
    } finally { UI.loading(false); }
  };

  root.querySelector('#sub-add').onclick = () => openSubscriptionSheet(null);
  root.querySelectorAll('[data-sub-edit]').forEach(btn => {
    btn.onclick = () => openSubscriptionSheet(b.subscriptions.find(s => s.구독ID === btn.dataset.subEdit));
  });

  root.querySelector('#app-refresh').onclick = hardReload;
  root.querySelector('#reset-conn').onclick = () => showOnboarding();

  root.querySelectorAll('[data-export]').forEach(btn => {
    btn.onclick = async () => {
      UI.loading(true, '내보내는 중…');
      try {
        const res = await API.call('exportCsv', { sheet: btn.dataset.export });
        const blob = new Blob(['\ufeff' + res.csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = res.filename;
        a.click();
        URL.revokeObjectURL(a.href);
        UI.toast(res.filename + ' 을(를) 내려받았습니다.');
      } catch (e) { UI.toast(e.message, 'danger'); }
      finally { UI.loading(false); }
    };
  });

  API.call('driveStatus').then(st => {
    const box = root.querySelector('#drive-status');
    if (!box) return;
    box.innerHTML = `
      <div class="kv"><span class="k">Drive 폴더</span><span class="v"><a href="${UI.esc(st.폴더URL)}" target="_blank" rel="noopener">${UI.esc(st.폴더명)}</a></span></div>
      <div class="kv"><span class="k">공유 상태</span><span class="v">${UI.esc(st.공유상태)}</span></div>
      <div class="kv"><span class="k">데이터 시트</span><span class="v"><a href="${UI.esc(st.시트URL)}" target="_blank" rel="noopener">열기</a></span></div>
      <div class="kv"><span class="k">Claude API 키</span><span class="v">${UI.esc(st.ANTHROPIC_API_KEY)}</span></div>`;
  }).catch(() => {});
}

/** 세부 한도 추가 시트 */
function openLimitSheet(year, addable) {
  const body = UI.openSheet(`
    <h2 class="sheet-title">${year}년 세부 한도 추가</h2>
    <label class="field"><span>목회비 세부항목</span>
      <select id="lm-name">${addable.map(n => `<option>${UI.esc(n)}</option>`).join('')}</select></label>
    <label class="field"><span>연간 한도</span>
      <input type="number" id="lm-amt" inputmode="numeric" placeholder="300000"></label>
    <p class="form-note">연간 누적 기준입니다. 연중에 새로 걸어도 그 해 전체 사용액과 비교합니다.</p>
    <p class="form-error" id="lm-error" hidden></p>
    <button class="btn btn-primary btn-block" id="lm-save">추가</button>`);

  UI.refreshIcons(body);
  body.querySelector('#lm-save').onclick = async () => {
    const err = body.querySelector('#lm-error');
    err.hidden = true;
    UI.loading(true, '저장 중…');
    try {
      await API.call('addSubLimit', {
        연도: year,
        세부항목: body.querySelector('#lm-name').value,
        한도: Number(body.querySelector('#lm-amt').value)
      });
      UI.closeSheet();
      UI.toast('세부 한도를 추가했습니다.');
      await reload();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
    finally { UI.loading(false); }
  };
}

/** 예산 연도 추가 시트 */
function openYearSheet() {
  const exists = (State.boot.budgets || []).map(x => x.연도);
  const suggest = Math.max(...exists, new Date().getFullYear()) + 1;

  const body = UI.openSheet(`
    <h2 class="sheet-title">예산 연도 추가</h2>
    <label class="field"><span>연도</span>
      <input type="number" id="yr-value" inputmode="numeric" value="${suggest}"></label>
    <p class="form-note">전년도 한도를 복사해 만듭니다. 만든 뒤 값을 고치시면 됩니다.</p>
    <p class="form-error" id="yr-error" hidden></p>
    <button class="btn btn-primary btn-block" id="yr-save">추가</button>`);

  UI.refreshIcons(body);
  body.querySelector('#yr-save').onclick = async () => {
    const err = body.querySelector('#yr-error');
    err.hidden = true;
    const year = Number(body.querySelector('#yr-value').value);
    UI.loading(true, '저장 중…');
    try {
      await API.call('addBudgetYear', { 연도: year });
      UI.closeSheet();
      State.budgetYear = year;
      UI.toast(`${year}년 예산을 추가했습니다.`);
      await reload();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
    finally { UI.loading(false); }
  };
}

function openSubscriptionSheet(sub) {
  const meta = State.boot.meta;
  const s = sub || { 구독ID: '', 구독명: '', 목회비세부항목: '사역도구', 월예상금액: '', 시작월: currentMonthStr(), 종료월: '', 활성상태: '사용중' };

  const body = UI.openSheet(`
    <h2 class="sheet-title">${sub ? '정기구독 수정' : '정기구독 추가'}</h2>
    <label class="field"><span>구독명</span><input type="text" id="su-name" value="${UI.esc(s.구독명)}" placeholder="예: 클로드 구독"></label>
    <label class="field"><span>목회비 세부항목</span>
      <select id="su-cat">${meta.subcategories.map(c => `<option${c === s.목회비세부항목 ? ' selected' : ''}>${UI.esc(c)}</option>`).join('')}</select></label>
    <label class="field"><span>월 예상금액</span><input type="number" id="su-amt" inputmode="numeric" value="${s.월예상금액}"></label>
    <div class="row">
      <label class="field"><span>시작월</span><input type="month" id="su-start" value="${UI.esc(s.시작월)}"></label>
      <label class="field"><span>종료월 <span class="hint">비우면 계속</span></span><input type="month" id="su-end" value="${UI.esc(s.종료월)}"></label>
    </div>
    <label class="field"><span>활성상태</span>
      <select id="su-status">
        <option${s.활성상태 === '사용중' ? ' selected' : ''}>사용중</option>
        <option${s.활성상태 === '해지' ? ' selected' : ''}>해지</option>
      </select>
      <span class="hint">"해지"로 두면 예상액 계산에서는 빠지고 기록은 남습니다.
        다시 쓸 일이 없으면 아래에서 삭제하십시오.</span></label>
    <p class="form-error" id="su-error" hidden></p>
    <div class="row">
      ${sub ? `<button class="btn btn-danger" id="su-delete">삭제</button>` : ''}
      <button class="btn btn-primary" id="su-save">저장</button>
    </div>`);

  UI.refreshIcons(body);

  body.querySelector('#su-save').onclick = async () => {
    const err = body.querySelector('#su-error');
    err.hidden = true;
    UI.loading(true, '저장 중…');
    try {
      await API.call('saveSubscription', {
        구독ID: s.구독ID,
        구독명: body.querySelector('#su-name').value,
        목회비세부항목: body.querySelector('#su-cat').value,
        월예상금액: Number(body.querySelector('#su-amt').value),
        시작월: body.querySelector('#su-start').value,
        종료월: body.querySelector('#su-end').value,
        활성상태: body.querySelector('#su-status').value
      });
      UI.closeSheet();
      UI.toast('저장했습니다.');
      await reload();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
    finally { UI.loading(false); }
  };

  const del = body.querySelector('#su-delete');
  if (del) del.onclick = async () => {
    const linked = s.연결지출건수
      ? `\n이 구독에 연결된 지출 ${s.연결지출건수}건은 그대로 남습니다(금액·내역 보존).`
      : '';
    const msg = `${s.구독명} 을(를) 목록에서 없앱니다.${linked}\n앞으로 대시보드의 "정기구독 포함" 예상액에서 빠집니다.`;
    if (!await UI.confirmSheet('정기구독 삭제', msg, '삭제', true)) return;
    UI.loading(true, '삭제 중…');
    try {
      await API.call('deleteSubscription', { 구독ID: s.구독ID });
      UI.closeSheet();
      UI.toast('삭제했습니다.');
      await reload();
    } catch (e) { UI.toast(e.message, 'danger'); }
    finally { UI.loading(false); }
  };
}

/* ---------------- 시작 ---------------- */

/** 앱 버전 — 배포마다 올립니다. 설정 화면에 표시해 무엇이 돌고 있는지 확인합니다. */
const APP_VERSION = '2026.09.09-2';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache:'none' — sw.js 자체도 HTTP 캐시에서 꺼내 쓰지 않습니다.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update().catch(() => {});
        // 새 워커가 대기 중이면 바로 넘겨받게 합니다.
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
      })
      .catch(() => {});

    // 새 파일이 확인되면 알려 주고, 새로고침은 사용자가 고르게 둡니다.
    navigator.serviceWorker.addEventListener('message', ev => {
      if (ev.data && ev.data.type === 'shell-updated') showUpdateToast();
    });
  });
}

let updateToastShown = false;
function showUpdateToast() {
  if (updateToastShown) return;
  updateToastShown = true;
  const el = document.createElement('div');
  el.className = 'toast toast-action';
  el.innerHTML = '새 버전이 준비됐습니다 <button type="button">새로고침</button>';
  el.querySelector('button').onclick = () => location.reload();
  document.getElementById('toasts').appendChild(el);
}

UI.refreshIcons(document.body);
UI.initSheetDrag();
boot();
