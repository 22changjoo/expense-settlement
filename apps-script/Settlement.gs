/**
 * 정산 대사.
 *   연결지출합계 = SUM(선택된 지출의 금액)
 *   차액 = 입금액 - 연결지출합계
 *   차액 == 0 → 일치 / 선택 지출 모두 "정산완료"
 *   그 외    → 불일치 / 선택 지출 모두 "금액불일치"
 */

/** 정산 대상 후보 — 과거기록(정산확인불가)은 제외합니다. */
function settlementCandidates_(type, period) {
  var expenses = allExpenses_();
  var out;

  if (type === '목회비정산') {
    out = expenses.filter(function (e) {
      return e.항목 === '목회비' && e.사용일자.slice(0, 7) === period;
    });
  } else {
    var r = weekRange_(period);
    if (!r) throw new Error('대상기간(주차) 형식이 올바르지 않습니다: ' + period);
    out = expenses.filter(function (e) {
      return (e.항목 === '주유비' || e.항목 === '경비') &&
        e.사용일자 >= r.start && e.사용일자 <= r.end;
    });
  }

  return out.filter(function (e) { return e.정산상태 !== '정산확인불가(과거기록)'; })
    .sort(function (a, b) { return a.사용일자 < b.사용일자 ? -1 : 1; });
}

function createSettlement_(p) {
  var type = p.정산유형;
  if (['목회비정산', '경비정산'].indexOf(type) < 0) throw new Error('정산유형이 올바르지 않습니다.');
  var period = String(p.대상기간 || '');
  if (!period) throw new Error('대상기간을 선택하세요.');

  var ids = (p.연결된지출ID목록 || []).map(String).filter(String);
  if (!ids.length) throw new Error('정산에 포함할 지출을 한 건 이상 선택하세요.');

  var depositDate = ymd_(p.입금일) || today_();
  var deposit = num_(p.입금액);
  if (!deposit) throw new Error('입금액을 입력하세요.');

  var expenses = allExpenses_();
  var byId = {};
  expenses.forEach(function (e) { byId[e.지출ID] = e; });

  var sum = 0;
  ids.forEach(function (id) {
    if (!byId[id]) throw new Error('존재하지 않는 지출ID: ' + id);
    if (byId[id].정산기록ID) throw new Error(id + ' 은(는) 이미 ' + byId[id].정산기록ID + ' 에 연결되어 있습니다.');
    sum += byId[id].금액;
  });

  var diff = deposit - sum;
  var match = diff === 0 ? '일치' : '불일치';
  var settlementId = nextSettlementId_(depositDate);

  var captureUrl = '';
  var method = p.입금확인방식 === '캡처이미지' ? '캡처이미지' : '수기입력';
  if (method === '캡처이미지' && p.imageBase64) {
    captureUrl = saveDepositImage_(settlementId, depositDate, p.imageBase64, p.mimeType);
  }

  appendRow_(CFG.SHEET_SETTLEMENT, {
    '정산ID': settlementId,
    '정산유형': type,
    '대상기간': period,
    '입금액': deposit,
    '입금확인방식': method,
    '입금캡처이미지URL': captureUrl,
    '입금일': depositDate,
    '연결된지출ID목록': ids.join(','),
    '연결지출합계': sum,
    '일치여부': match === '일치' ? '일치' : '불일치(' + formatWon_(diff) + ')',
    '차액': diff
  });

  var status = diff === 0 ? '정산완료' : '금액불일치';
  ids.forEach(function (id) {
    updateRow_(CFG.SHEET_EXPENSE, byId[id]._row, { '정산기록ID': settlementId, '정산상태': status });
  });

  return {
    정산ID: settlementId, 정산유형: type, 대상기간: period, 입금액: deposit,
    연결지출합계: sum, 차액: diff, 일치여부: match, 입금일: depositDate,
    입금캡처이미지URL: captureUrl, 연결된지출ID목록: ids
  };
}

/** 정산기록 삭제 — 연결된 지출을 모두 "미정산"으로 되돌립니다. */
function deleteSettlement_(p) {
  var found = findRow_(CFG.SHEET_SETTLEMENT, '정산ID', p.정산ID);
  if (!found) throw new Error('정산ID 를 찾을 수 없습니다: ' + p.정산ID);

  var ids = String(found['연결된지출ID목록'] || '').split(',')
    .map(function (s) { return s.trim(); }).filter(String);
  var expenses = allExpenses_();
  expenses.forEach(function (e) {
    if (ids.indexOf(e.지출ID) < 0) return;
    updateRow_(CFG.SHEET_EXPENSE, e._row, { '정산기록ID': '', '정산상태': '미정산' });
  });
  deleteRow_(CFG.SHEET_SETTLEMENT, found._row);
  return { 정산ID: p.정산ID, deleted: true };
}

/** 지출 한 건이 삭제될 때 정산기록에서 떼어내고 합계·차액을 다시 계산합니다. */
function detachFromSettlement_(settlementId, expenseId) {
  var found = findRow_(CFG.SHEET_SETTLEMENT, '정산ID', settlementId);
  if (!found) return;

  var ids = String(found['연결된지출ID목록'] || '').split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s && s !== expenseId; });

  var byId = {};
  allExpenses_().forEach(function (e) { byId[e.지출ID] = e; });
  var sum = ids.reduce(function (a, id) { return a + (byId[id] ? byId[id].금액 : 0); }, 0);
  var diff = num_(found['입금액']) - sum;

  updateRow_(CFG.SHEET_SETTLEMENT, found._row, {
    '연결된지출ID목록': ids.join(','),
    '연결지출합계': sum,
    '일치여부': diff === 0 ? '일치' : '불일치(' + formatWon_(diff) + ')',
    '차액': diff
  });

  var status = diff === 0 ? '정산완료' : '금액불일치';
  ids.forEach(function (id) {
    if (byId[id]) updateRow_(CFG.SHEET_EXPENSE, byId[id]._row, { '정산상태': status });
  });
}

function formatWon_(n) {
  var sign = n < 0 ? '-' : '+';
  return sign + Math.abs(n).toLocaleString('ko-KR') + '원';
}
