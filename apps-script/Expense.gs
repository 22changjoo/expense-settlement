/** 지출기록 CRUD. */

function validateExpense_(p) {
  var errors = [];
  if (CATEGORIES.indexOf(p.항목) < 0) errors.push('항목을 선택하세요.');
  if (!p.사용일자) errors.push('사용일자를 입력하세요.');
  if (!num_(p.금액)) errors.push('금액을 입력하세요.');
  if (p.항목 === '목회비' && SUBCATEGORIES.indexOf(p.목회비세부항목) < 0) {
    errors.push('목회비 세부항목을 선택하세요.');
  }
  if ((p.항목 === '목회비' || p.항목 === '경비') && !String(p.인원_내용 || '').trim()) {
    errors.push('인원/내용을 입력하세요.');
  }
  return errors;
}

function createExpense_(p) {
  // 같은 요청이 다시 들어왔으면 새로 쓰지 않고 먼저 저장된 것을 돌려줍니다.
  var already = findByRequestId_(CFG.SHEET_EXPENSE, p.요청ID);
  if (already) return Object.assign(normalizeExpense_(already), { 중복요청: true });

  var errors = validateExpense_(p);
  if (errors.length) throw new Error(errors.join('\n'));

  var useDate = ymd_(p.사용일자);
  var id = nextExpenseId_(useDate);
  var url = String(p.영수증이미지URL || '');
  if (p.imageBase64) url = saveReceiptImage_(id, useDate, p.imageBase64, p.mimeType);

  var submitted = submitState_(p.영수증제출상태);
  var row = {
    '지출ID': id,
    '등록일시': nowIso_(),
    '사용일자': useDate,
    '항목': p.항목,
    '목회비세부항목': p.항목 === '목회비' ? p.목회비세부항목 : '',
    '인원_내용': p.항목 === '주유비' ? '' : String(p.인원_내용 || '').trim(),
    '금액': num_(p.금액),
    '영수증이미지URL': url,
    '영수증제출상태': submitted,
    '제출일': submitted === '제출완료' ? (ymd_(p.제출일) || today_()) : '',   // 영수증없음은 빈칸
    '정산기록ID': '',
    '정산상태': SETTLE_STATUSES.indexOf(p.정산상태) >= 0 ? p.정산상태 : '미정산',
    '연결구독ID': String(p.연결구독ID || ''),
    '비고': String(p.비고 || ''),
    '요청ID': String(p.요청ID || '')
  };
  if (row['요청ID']) ensureColumn_(CFG.SHEET_EXPENSE, '요청ID');
  appendRow_(CFG.SHEET_EXPENSE, row);
  return row;
}

var EXPENSE_EDITABLE = ['사용일자', '항목', '목회비세부항목', '인원_내용', '금액',
  '영수증제출상태', '제출일', '연결구독ID', '비고'];

function updateExpense_(p) {
  var found = findRow_(CFG.SHEET_EXPENSE, '지출ID', p.지출ID);
  if (!found) throw new Error('지출ID 를 찾을 수 없습니다: ' + p.지출ID);

  var merged = normalizeExpense_(found);
  EXPENSE_EDITABLE.forEach(function (k) {
    if (p[k] !== undefined) merged[k] = p[k];
  });
  var errors = validateExpense_(merged);
  if (errors.length) throw new Error(errors.join('\n'));

  var patch = {
    '사용일자': ymd_(merged.사용일자),
    '항목': merged.항목,
    '목회비세부항목': merged.항목 === '목회비' ? merged.목회비세부항목 : '',
    '인원_내용': merged.항목 === '주유비' ? '' : String(merged.인원_내용 || '').trim(),
    '금액': num_(merged.금액),
    '영수증제출상태': submitState_(merged.영수증제출상태),
    '연결구독ID': String(merged.연결구독ID || ''),
    '비고': String(merged.비고 || '')
  };
  patch['제출일'] = patch['영수증제출상태'] === '제출완료'
    ? (ymd_(merged.제출일) || today_())
    : '';

  if (p.imageBase64) {
    patch['영수증이미지URL'] = saveReceiptImage_(merged.지출ID, patch['사용일자'], p.imageBase64, p.mimeType);
  }

  updateRow_(CFG.SHEET_EXPENSE, found._row, patch);
  return Object.assign({ 지출ID: merged.지출ID }, patch);
}

/**
 * 이미 정산기록에 묶인 지출은 기본적으로 삭제를 막습니다.
 * force=true 이면 해당 정산기록에서 지출ID를 빼고 합계·차액을 다시 계산합니다.
 */
function deleteExpense_(p) {
  var found = findRow_(CFG.SHEET_EXPENSE, '지출ID', p.지출ID);
  if (!found) throw new Error('지출ID 를 찾을 수 없습니다: ' + p.지출ID);
  var e = normalizeExpense_(found);

  if (e.정산기록ID && !p.force) {
    throw new Error('이 지출은 정산기록 ' + e.정산기록ID + ' 에 연결되어 있습니다.\n' +
      '삭제하면 해당 정산의 합계와 차액이 다시 계산됩니다. 계속하시겠습니까?');
  }
  if (e.정산기록ID) detachFromSettlement_(e.정산기록ID, e.지출ID);
  deleteRow_(CFG.SHEET_EXPENSE, found._row);
  return { 지출ID: e.지출ID, deleted: true };
}

/** 상태 배지 탭으로 제출상태만 빠르게 토글할 때 사용합니다. */
function toggleSubmitted_(p) {
  var found = findRow_(CFG.SHEET_EXPENSE, '지출ID', p.지출ID);
  if (!found) throw new Error('지출ID 를 찾을 수 없습니다: ' + p.지출ID);
  var cur = String(found['영수증제출상태'] || '미제출');
  var next = cur === '제출완료' ? '미제출' : '제출완료';
  updateRow_(CFG.SHEET_EXPENSE, found._row, {
    '영수증제출상태': next,
    '제출일': next === '제출완료' ? today_() : ''
  });
  return { 지출ID: p.지출ID, 영수증제출상태: next };
}

var SETTLE_STATUSES = ['미정산', '정산완료', '금액불일치', '정산확인불가(과거기록)'];

/**
 * 과거 기록 일괄 등록.
 *
 * 교회 장부에 이미 정리된 내역처럼, 영수증 이미지 없이 여러 건을 한 번에
 * 넣을 때 씁니다. 건별로 부르면 왕복마다 몇 초가 걸려 한 번에 씁니다.
 */
function importExpenses_(p) {
  var items = p.items || [];
  if (!items.length) throw new Error('등록할 내역이 없습니다.');
  if (items.length > 300) throw new Error('한 번에 300건까지만 등록할 수 있습니다.');

  var sh = sheet_(CFG.SHEET_EXPENSE);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  // 일련번호는 시트 전체를 통틀어 이어집니다.
  var seq = 0;
  readSheet_(CFG.SHEET_EXPENSE).rows.forEach(function (r) {
    var m = String(r['지출ID']).match(/EXP-\d{8}-(\d+)$/);
    if (m) seq = Math.max(seq, parseInt(m[1], 10));
  });

  var stamp = nowIso_();
  var created = [];
  var rows = items.map(function (it) {
    var errors = validateExpense_(it);
    if (errors.length) throw new Error(ymd_(it.사용일자) + ' 항목: ' + errors.join(' / '));

    var useDate = ymd_(it.사용일자);
    var id = 'EXP-' + useDate.replace(/-/g, '') + '-' + pad3_(++seq);
    var submitted = submitState_(it.영수증제출상태);
    var obj = {
      '지출ID': id,
      '등록일시': stamp,
      '사용일자': useDate,
      '항목': it.항목,
      '목회비세부항목': it.항목 === '목회비' ? it.목회비세부항목 : '',
      '인원_내용': it.항목 === '주유비' ? '' : String(it.인원_내용 || '').trim(),
      '금액': num_(it.금액),
      '영수증이미지URL': String(it.영수증이미지URL || ''),
      '영수증제출상태': submitted,
      '제출일': submitted === '제출완료' ? (ymd_(it.제출일) || '') : '',
      '정산기록ID': '',
      '정산상태': SETTLE_STATUSES.indexOf(it.정산상태) >= 0 ? it.정산상태 : '미정산',
      '연결구독ID': String(it.연결구독ID || ''),
      '비고': String(it.비고 || '')
    };
    created.push({ 지출ID: id, 사용일자: useDate, 금액: obj['금액'] });
    return header.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  });

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
  invalidate_(CFG.SHEET_EXPENSE);

  return {
    건수: created.length,
    합계: created.reduce(function (a, c) { return a + c.금액; }, 0),
    처음: created[0],
    마지막: created[created.length - 1]
  };
}

/**
 * 영수증 제출상태 일괄 변경.
 *
 * 지출ID 열만 읽어 행 번호를 찾고, 고른 칸에만 씁니다. RangeList 는 같은 값을
 * 여러 칸에 한 번에 쓰므로 몇 건을 바꾸든 쓰기는 두 번입니다.
 * (열 전체를 읽었다 다시 쓰면, 그 사이에 들어온 다른 변경을 덮어씁니다.)
 * 같은 요청을 다시 보내도 결과가 같아 재시도해도 안전합니다.
 */
function bulkSetSubmitted_(p) {
  var ids = (p.지출ID목록 || []).map(String).filter(String);
  if (!ids.length) throw new Error('바꿀 지출을 한 건 이상 고르세요.');
  var status = p.상태 === '미제출' ? '미제출' : '제출완료';
  var date = status === '제출완료' ? (ymd_(p.제출일) || today_()) : '';

  var sh = sheet_(CFG.SHEET_EXPENSE);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('지출기록이 비어 있습니다.');
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idCol = colIndex_(header, '지출ID');
  var stLetter = colLetter_(colIndex_(header, '영수증제출상태'));
  var dtLetter = colLetter_(colIndex_(header, '제출일'));

  var idVals = sh.getRange(2, idCol, lastRow - 1, 1).getValues();
  var want = {};
  ids.forEach(function (id) { want[id] = true; });

  var stCells = [], dtCells = [], done = [];
  for (var i = 0; i < idVals.length; i++) {
    var id = String(idVals[i][0]);
    if (!want[id]) continue;
    var row = i + 2;
    stCells.push(stLetter + row);
    dtCells.push(dtLetter + row);
    done.push(id);
  }

  if (done.length) {
    sh.getRangeList(stCells).setValue(status);
    sh.getRangeList(dtCells).setValue(date);
    invalidate_(CFG.SHEET_EXPENSE);
  }

  return {
    상태: status,
    제출일: date,
    변경건수: done.length,
    찾지못한ID: ids.filter(function (id) { return done.indexOf(id) < 0; })
  };
}

/** 열 번호 → A1 표기 열 문자 (1 → A, 27 → AA) */
function colLetter_(n) {
  var out = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
