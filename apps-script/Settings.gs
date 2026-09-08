/** 예산설정 · 정기구독설정 · 내보내기. */

/** 연도 행을 찾습니다. 없으면 만듭니다. */
function budgetRow_(year) {
  ensureBudgetRow_(year);
  var data = readSheet_(CFG.SHEET_BUDGET);
  var target = null;
  data.rows.forEach(function (r) { if (num_(r['연도']) === Number(year)) target = r; });
  if (!target) throw new Error(year + '년 예산설정 행을 찾지 못했습니다.');
  return { data: data, row: target };
}

/**
 * 연간 한도와 세부 한도를 한 번에 저장합니다.
 * p.세부한도 는 {건강관리: 720000, 도서구입: 300000} 형태이며,
 * 값이 0 이거나 빈 문자열이면 해당 한도를 지웁니다.
 */
function updateBudget_(p) {
  var year = Number(p.연도);
  if (!year) throw new Error('연도를 입력하세요.');
  var found = budgetRow_(year);
  var target = found.row;

  var patch = {};
  if (p.목회비연간한도 !== undefined) patch['목회비연간한도'] = num_(p.목회비연간한도);
  if (p.주유비연간한도 !== undefined) patch['주유비연간한도'] = num_(p.주유비연간한도);
  if (Object.keys(patch).length) updateRow_(CFG.SHEET_BUDGET, target._row, patch);

  var limits = p.세부한도 || {};
  Object.keys(limits).forEach(function (name) {
    var value = num_(limits[name]);
    if (value > 0) setSubLimit_(year, name, value);
    else clearSubLimitCell_(year, name);
  });

  return budgetForYear_(year);
}

/** `목회비_<세부항목>한도` 열이 없으면 맨 뒤에 만들고, 열 번호를 돌려줍니다. */
function ensureSubLimitColumn_(name) {
  if (SUBCATEGORIES.indexOf(name) < 0) throw new Error('알 수 없는 목회비 세부항목: ' + name);
  var sh = sheet_(CFG.SHEET_BUDGET);
  var col = subLimitColumn_(name);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idx = header.indexOf(col);
  if (idx >= 0) return idx + 1;

  var next = sh.getLastColumn() + 1;
  sh.getRange(1, next).setValue(col);
  return next;
}

function setSubLimit_(year, name, value) {
  var col = ensureSubLimitColumn_(name);
  var found = budgetRow_(year);
  sheet_(CFG.SHEET_BUDGET).getRange(found.row._row, col).setValue(num_(value));
}

/** 해당 연도의 칸만 비웁니다(열은 남깁니다). */
function clearSubLimitCell_(year, name) {
  var sh = sheet_(CFG.SHEET_BUDGET);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idx = header.indexOf(subLimitColumn_(name));
  if (idx < 0) return;
  var found = budgetRow_(year);
  sh.getRange(found.row._row, idx + 1).setValue('');
}

/** 세부 한도 추가 — 이미 있으면 값을 덮어씁니다. */
function addSubLimit_(p) {
  var year = Number(p.연도);
  var name = String(p.세부항목 || '');
  var value = num_(p.한도);
  if (!year) throw new Error('연도를 입력하세요.');
  if (SUBCATEGORIES.indexOf(name) < 0) throw new Error('목회비 세부항목을 선택하세요.');
  if (value <= 0) throw new Error('한도 금액을 입력하세요.');
  setSubLimit_(year, name, value);
  return budgetForYear_(year);
}

/**
 * 세부 한도 삭제. 해당 연도 칸을 비우고, 모든 연도에서 비게 되면 열 자체를 지웁니다.
 * 건강관리를 지우면 목회비 한도의 20% 자동 계산으로 되돌아갑니다.
 */
function deleteSubLimit_(p) {
  var year = Number(p.연도);
  var name = String(p.세부항목 || '');
  if (!year) throw new Error('연도를 입력하세요.');

  var sh = sheet_(CFG.SHEET_BUDGET);
  var col = subLimitColumn_(name);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idx = header.indexOf(col);
  if (idx < 0) throw new Error(name + ' 한도가 설정되어 있지 않습니다.');

  clearSubLimitCell_(year, name);

  var stillUsed = readSheet_(CFG.SHEET_BUDGET).rows.some(function (r) { return num_(r[col]) > 0; });
  if (!stillUsed) sh.deleteColumn(idx + 1);

  return { 연도: year, 세부항목: name, 열삭제됨: !stillUsed, budget: budgetForYear_(year) };
}

/** 연도 추가 — 전년도 값을 복사해 만듭니다. */
function addBudgetYear_(p) {
  var year = Number(p.연도);
  if (!year || year < 2000 || year > 2100) throw new Error('연도를 올바르게 입력하세요.');
  var exists = readSheet_(CFG.SHEET_BUDGET).rows.some(function (r) { return num_(r['연도']) === year; });
  if (exists) throw new Error(year + '년 예산은 이미 있습니다.');
  ensureBudgetRow_(year);
  return budgetForYear_(year);
}

/** 연도 삭제 — 그 해에 지출이 있으면 막습니다(force 로 통과). */
function deleteBudgetYear_(p) {
  var year = Number(p.연도);
  if (!year) throw new Error('연도를 입력하세요.');

  var data = readSheet_(CFG.SHEET_BUDGET);
  if (data.rows.length <= 1) throw new Error('마지막 남은 예산 연도는 삭제할 수 없습니다.');

  var target = null;
  data.rows.forEach(function (r) { if (num_(r['연도']) === year) target = r; });
  if (!target) throw new Error(year + '년 예산 행이 없습니다.');

  if (!p.force) {
    var used = allExpenses_().filter(function (e) { return e.사용일자.slice(0, 4) === String(year); }).length;
    if (used) {
      throw new Error(year + '년에 등록된 지출이 ' + used + '건 있습니다.\n' +
        '한도를 지우면 그 해 대시보드에서 예산 게이지를 볼 수 없습니다. 계속하시겠습니까?');
    }
  }

  deleteRow_(CFG.SHEET_BUDGET, target._row);
  return { 연도: year, deleted: true };
}

function saveSubscription_(p) {
  var payload = {
    '구독명': String(p.구독명 || '').trim(),
    '목회비세부항목': SUBCATEGORIES.indexOf(p.목회비세부항목) >= 0 ? p.목회비세부항목 : '기타',
    '월예상금액': num_(p.월예상금액),
    '시작월': ym_(p.시작월) || String(p.시작월 || ''),
    '종료월': p.종료월 ? (ym_(p.종료월) || String(p.종료월)) : '',
    '활성상태': p.활성상태 === '해지' ? '해지' : '사용중'
  };
  if (!payload['구독명']) throw new Error('구독명을 입력하세요.');
  if (!payload['시작월']) throw new Error('시작월을 입력하세요 (예: 2026-01).');

  if (p.구독ID) {
    var found = findRow_(CFG.SHEET_SUBSCRIPTION, '구독ID', p.구독ID);
    if (!found) throw new Error('구독ID 를 찾을 수 없습니다: ' + p.구독ID);
    updateRow_(CFG.SHEET_SUBSCRIPTION, found._row, payload);
    return Object.assign({ 구독ID: p.구독ID }, payload);
  }
  payload['구독ID'] = nextSubscriptionId_();
  appendRow_(CFG.SHEET_SUBSCRIPTION, payload);
  return payload;
}

function deleteSubscription_(p) {
  var found = findRow_(CFG.SHEET_SUBSCRIPTION, '구독ID', p.구독ID);
  if (!found) throw new Error('구독ID 를 찾을 수 없습니다: ' + p.구독ID);
  deleteRow_(CFG.SHEET_SUBSCRIPTION, found._row);
  return { 구독ID: p.구독ID, deleted: true };
}

/** 시트 하나를 CSV 문자열로 내보냅니다. */
function exportCsv_(p) {
  var name = p.sheet || CFG.SHEET_EXPENSE;
  if (!HEADERS[name]) throw new Error('알 수 없는 시트: ' + name);
  var values = sheet_(name).getDataRange().getValues();
  var csv = values.map(function (row) {
    return row.map(function (cell) {
      var v = Object.prototype.toString.call(cell) === '[object Date]'
        ? Utilities.formatDate(cell, CFG.TZ, 'yyyy-MM-dd')
        : String(cell === null || cell === undefined ? '' : cell);
      return '"' + v.replace(/"/g, '""') + '"';
    }).join(',');
  }).join('\n');
  return { sheet: name, filename: name + '_' + today_() + '.csv', csv: csv };
}

/** Drive 연결 상태 확인 (화면 E). */
function driveStatus_() {
  var root = rootFolder_();
  return {
    폴더명: root.getName(),
    폴더URL: root.getUrl(),
    공유상태: String(root.getSharingAccess()),
    시트URL: spreadsheet_().getUrl(),
    ANTHROPIC_API_KEY: prop_('ANTHROPIC_API_KEY') ? '설정됨' : '미설정'
  };
}
