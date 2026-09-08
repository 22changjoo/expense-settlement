/** 대시보드 집계 — 예산 게이지, 정기구독 예상 반영, 상태 배지. */

/**
 * 세부 한도는 `목회비_<세부항목>한도` 열로 저장합니다.
 * 열을 추가하면 한도가 생기고, 열을 지우면 한도가 사라집니다.
 * 기존 `목회비_건강관리한도` 열도 이 규칙에 그대로 들어맞습니다.
 */
var SUBLIMIT_RE = /^목회비_(.+)한도$/;

function subLimitColumn_(name) {
  return '목회비_' + name + '한도';
}

function budgetFromRow_(header, row) {
  var pastoral = num_(row['목회비연간한도']);

  var limits = {};
  header.forEach(function (h) {
    var m = String(h).match(SUBLIMIT_RE);
    if (!m) return;
    var v = num_(row[h]);
    if (v > 0) limits[m[1]] = v;
  });

  // 건강관리는 값을 비워 두면 목회비 한도의 20% 로 자동 계산합니다(교회 규정 기본값).
  var healthAuto = !limits['건강관리'];
  if (healthAuto && pastoral) limits['건강관리'] = Math.round(pastoral * 0.2);

  return {
    연도: Number(num_(row['연도'])),
    목회비연간한도: pastoral,
    주유비연간한도: num_(row['주유비연간한도']),
    목회비_건강관리한도: limits['건강관리'] || 0,   // 이전 버전 호환용 별칭
    건강관리자동: healthAuto,
    세부한도: limits
  };
}

function budgetForYear_(year) {
  var data = readSheet_(CFG.SHEET_BUDGET);
  var hit = null;
  data.rows.forEach(function (r) { if (String(num_(r['연도'])) === String(year)) hit = r; });
  if (!hit) {
    ensureBudgetRow_(year);
    data = readSheet_(CFG.SHEET_BUDGET);
    data.rows.forEach(function (r) { if (String(num_(r['연도'])) === String(year)) hit = r; });
  }
  if (!hit) throw new Error(year + '년 예산 행을 만들지 못했습니다.');
  return budgetFromRow_(data.header, hit);
}

/** 등록된 모든 연도의 한도. 설정 화면의 연도 목록에 씁니다. */
function listBudgets_() {
  var data = readSheet_(CFG.SHEET_BUDGET);
  return data.rows
    .map(function (r) { return budgetFromRow_(data.header, r); })
    .filter(function (b) { return b.연도; })
    .sort(function (a, b) { return b.연도 - a.연도; });
}

/** 해당 연도 행이 없으면 전년도 값을 복사해 만듭니다(없으면 기본값). */
function ensureBudgetRow_(year) {
  var data = readSheet_(CFG.SHEET_BUDGET);
  var exists = null, prev = null;
  data.rows.forEach(function (r) {
    var y = num_(r['연도']);
    if (String(y) === String(year)) exists = r;
    if (String(y) === String(Number(year) - 1)) prev = r;
  });
  if (exists) return exists;

  var base = prev || { 목회비연간한도: 3600000, 목회비_건강관리한도: 720000, 주유비연간한도: 3600000 };
  var pastoral = num_(base['목회비연간한도']) || 3600000;
  var row = {
    '연도': Number(year),
    '목회비연간한도': pastoral,
    '목회비_건강관리한도': num_(base['목회비_건강관리한도']) || Math.round(pastoral * 0.2),
    '주유비연간한도': num_(base['주유비연간한도']) || 3600000
  };
  appendRow_(CFG.SHEET_BUDGET, row);
  return row;
}

function normalizeExpense_(r) {
  return {
    지출ID: String(r['지출ID'] || ''),
    등록일시: r['등록일시'] ? String(r['등록일시']) : '',
    사용일자: ymd_(r['사용일자']),
    항목: String(r['항목'] || ''),
    목회비세부항목: String(r['목회비세부항목'] || ''),
    인원_내용: String(r['인원_내용'] || ''),
    금액: num_(r['금액']),
    영수증이미지URL: String(r['영수증이미지URL'] || ''),
    영수증제출상태: String(r['영수증제출상태'] || '미제출'),
    제출일: r['제출일'] ? ymd_(r['제출일']) : '',
    정산기록ID: String(r['정산기록ID'] || ''),
    정산상태: String(r['정산상태'] || '미정산'),
    연결구독ID: String(r['연결구독ID'] || ''),
    비고: String(r['비고'] || ''),
    _row: r._row
  };
}

function allExpenses_() {
  return readSheet_(CFG.SHEET_EXPENSE).rows.map(normalizeExpense_);
}

function allSubscriptions_() {
  var linked = {};
  readSheet_(CFG.SHEET_EXPENSE).rows.forEach(function (e) {
    var id = String(e['연결구독ID'] || '');
    if (id) linked[id] = (linked[id] || 0) + 1;
  });

  return readSheet_(CFG.SHEET_SUBSCRIPTION).rows.map(function (r) {
    return {
      연결지출건수: linked[String(r['구독ID'] || '')] || 0,
      구독ID: String(r['구독ID'] || ''),
      구독명: String(r['구독명'] || ''),
      목회비세부항목: String(r['목회비세부항목'] || ''),
      월예상금액: num_(r['월예상금액']),
      시작월: ym_(r['시작월']),
      종료월: ym_(r['종료월']),
      활성상태: String(r['활성상태'] || '사용중'),
      _row: r._row
    };
  });
}

function allSettlements_() {
  return readSheet_(CFG.SHEET_SETTLEMENT).rows.map(function (r) {
    return {
      정산ID: String(r['정산ID'] || ''),
      정산유형: String(r['정산유형'] || ''),
      대상기간: String(r['대상기간'] || ''),
      입금액: num_(r['입금액']),
      입금확인방식: String(r['입금확인방식'] || ''),
      입금캡처이미지URL: String(r['입금캡처이미지URL'] || ''),
      입금일: ymd_(r['입금일']),
      연결된지출ID목록: String(r['연결된지출ID목록'] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
      연결지출합계: num_(r['연결지출합계']),
      일치여부: String(r['일치여부'] || ''),
      차액: num_(r['차액']),
      _row: r._row
    };
  });
}

/**
 * 정기구독 예상 반영액.
 * 해당 월에 연결구독ID 로 등록된 실제 지출이 있으면 예상액은 더하지 않고,
 * 없으면 월예상금액을 세부항목 합계에 가산합니다.
 */
function subscriptionProjection_(year, expenses, subs) {
  var perSub = {};
  var bySubMonth = {};
  expenses.forEach(function (e) {
    if (!e.연결구독ID) return;
    bySubMonth[e.연결구독ID + '|' + e.사용일자.slice(0, 7)] = true;
  });

  var bySubcategory = {}, total = 0;
  SUBCATEGORIES.forEach(function (s) { bySubcategory[s] = 0; });

  subs.forEach(function (s) {
    if (s.활성상태 !== '사용중') return;
    var pending = [];      // 아직 영수증이 없어 예상액으로 잡히는 달
    var recorded = [];     // 실제 지출이 연결된 달
    monthsOfYear_(year).forEach(function (m) {
      if (!subActiveInMonth_({ '시작월': s.시작월, '종료월': s.종료월 }, m)) return;
      if (bySubMonth[s.구독ID + '|' + m]) recorded.push(m);   // 실제 데이터가 있으므로 예상액 무시
      else pending.push(m);
    });
    var months = pending.length;
    var amount = months * s.월예상금액;
    if (amount <= 0) return;
    perSub[s.구독ID] = {
      구독명: s.구독명,
      목회비세부항목: s.목회비세부항목,
      월예상금액: s.월예상금액,
      개월수: months,
      금액: amount,
      예상월목록: pending,
      실제등록월: recorded
    };
    var key = SUBCATEGORIES.indexOf(s.목회비세부항목) >= 0 ? s.목회비세부항목 : '기타';
    bySubcategory[key] += amount;
    total += amount;
  });

  return { total: total, bySubcategory: bySubcategory, perSub: perSub };
}

function buildDashboard_(year) {
  year = Number(year) || Number(Utilities.formatDate(new Date(), CFG.TZ, 'yyyy'));
  var thisMonth = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM');

  var expenses = allExpenses_();
  var subs = allSubscriptions_();
  var budget = budgetForYear_(year);
  var yearly = expenses.filter(function (e) { return e.사용일자.slice(0, 4) === String(year); });

  var pastoralActual = 0, fuelActual = 0, etcYear = 0, etcMonth = 0;
  var bySub = {};
  SUBCATEGORIES.forEach(function (s) { bySub[s] = 0; });

  yearly.forEach(function (e) {
    if (e.항목 === '목회비') {
      pastoralActual += e.금액;
      var key = SUBCATEGORIES.indexOf(e.목회비세부항목) >= 0 ? e.목회비세부항목 : '기타';
      bySub[key] += e.금액;
    } else if (e.항목 === '주유비') {
      fuelActual += e.금액;
    } else {
      etcYear += e.금액;
      if (e.사용일자.slice(0, 7) === thisMonth) etcMonth += e.금액;
    }
  });

  var projection = subscriptionProjection_(year, yearly, subs);

  var pendingSettlement = expenses.filter(function (e) {
    return (e.항목 === '주유비' || e.항목 === '경비') && e.정산상태 === '미정산';
  });
  var etcPending = expenses.filter(function (e) { return e.항목 === '경비' && e.정산상태 === '미정산'; });

  var badges = {
    미제출: expenses.filter(function (e) { return e.영수증제출상태 === '미제출'; }).length,
    미정산: expenses.filter(function (e) { return e.정산상태 === '미정산'; }).length,
    금액불일치: expenses.filter(function (e) { return e.정산상태 === '금액불일치'; }).length
  };

  var recent = expenses.slice().sort(function (a, b) {
    if (a.사용일자 === b.사용일자) return a.지출ID < b.지출ID ? 1 : -1;
    return a.사용일자 < b.사용일자 ? 1 : -1;
  }).slice(0, 5);

  return {
    연도: year,
    이번달: thisMonth,
    예산: budget,
    목회비: {
      실사용: pastoralActual,
      예상포함: pastoralActual + projection.total,
      한도: budget.목회비연간한도,
      세부항목: SUBCATEGORIES.map(function (s) {
        return {
          이름: s,
          실사용: bySub[s],
          예상포함: bySub[s] + (projection.bySubcategory[s] || 0),
          한도: budget.세부한도[s] || null
        };
      }),
      구독예상: projection.perSub
    },
    주유비: { 실사용: fuelActual, 한도: budget.주유비연간한도 },
    경비: {
      이번달누적: etcMonth,
      올해누적: etcYear,
      정산대기건수: etcPending.length,
      정산대기금액: etcPending.reduce(function (a, e) { return a + e.금액; }, 0)
    },
    정산대기_경비주유: {
      건수: pendingSettlement.length,
      금액: pendingSettlement.reduce(function (a, e) { return a + e.금액; }, 0)
    },
    배지: badges,
    최근등록: recent
  };
}
