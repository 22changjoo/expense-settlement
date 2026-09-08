/** 예산설정 · 정기구독설정 · 내보내기. */

function updateBudget_(p) {
  var year = Number(p.연도);
  if (!year) throw new Error('연도를 입력하세요.');
  ensureBudgetRow_(year);

  var data = readSheet_(CFG.SHEET_BUDGET);
  var target = null;
  data.rows.forEach(function (r) { if (num_(r['연도']) === year) target = r; });
  if (!target) throw new Error('예산설정 행을 찾지 못했습니다.');

  var pastoral = p.목회비연간한도 !== undefined ? num_(p.목회비연간한도) : num_(target['목회비연간한도']);
  // 건강관리 한도는 기본적으로 목회비 한도의 20%. 직접 값을 주면 그 값을 그대로 씁니다.
  var health = p.목회비_건강관리한도 !== undefined && String(p.목회비_건강관리한도) !== ''
    ? num_(p.목회비_건강관리한도)
    : Math.round(pastoral * 0.2);
  var fuel = p.주유비연간한도 !== undefined ? num_(p.주유비연간한도) : num_(target['주유비연간한도']);

  updateRow_(CFG.SHEET_BUDGET, target._row, {
    '목회비연간한도': pastoral,
    '목회비_건강관리한도': health,
    '주유비연간한도': fuel
  });
  return budgetForYear_(year);
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
