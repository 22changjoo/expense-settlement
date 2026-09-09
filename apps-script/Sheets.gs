/** 시트 접근 공통 레이어 — 열 위치는 항상 헤더 이름으로 해석합니다. */

function sheet_(name) {
  if (MEMO_.sheets[name]) return MEMO_.sheets[name];
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    sh.setFrozenRows(1);
  }
  MEMO_.sheets[name] = sh;
  return sh;
}

/** 시트 전체를 객체 배열로 읽습니다. 같은 실행 안에서는 한 번만 읽습니다. */
function readSheet_(name) {
  if (MEMO_.values[name]) return MEMO_.values[name];
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { header: values[0] || HEADERS[name], rows: [] };
  var header = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i];
    if (raw.join('') === '') continue;
    var obj = { _row: i + 1 };
    for (var c = 0; c < header.length; c++) obj[header[c]] = raw[c];
    rows.push(obj);
  }
  MEMO_.values[name] = { header: header, rows: rows };
  return MEMO_.values[name];
}

function colIndex_(header, name) {
  var i = header.indexOf(name);
  if (i < 0) throw new Error('시트에 "' + name + '" 열이 없습니다.');
  return i + 1;
}

/** 객체 하나를 헤더 순서에 맞춰 마지막 행에 추가합니다. */
function appendRow_(name, obj) {
  var sh = sheet_(name);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var row = header.map(function (h) {
    return obj[h] === undefined || obj[h] === null ? '' : obj[h];
  });
  sh.appendRow(row);
  invalidate_(name);
  return sh.getLastRow();
}

/** 특정 행의 일부 열만 갱신합니다. */
function updateRow_(name, rowNumber, patch) {
  var sh = sheet_(name);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  Object.keys(patch).forEach(function (key) {
    var idx = header.indexOf(key);
    if (idx < 0) return;
    sh.getRange(rowNumber, idx + 1).setValue(patch[key]);
  });
  invalidate_(name);
}

function deleteRow_(name, rowNumber) {
  sheet_(name).deleteRow(rowNumber);
  invalidate_(name);
}

function findRow_(name, key, value) {
  var data = readSheet_(name);
  for (var i = 0; i < data.rows.length; i++) {
    if (String(data.rows[i][key]) === String(value)) return data.rows[i];
  }
  return null;
}

/* ---------- 값 정규화 ---------- */

/** "35,000" · 35000 · "₩35,000" 모두 숫자로 변환합니다. */
function num_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[^0-9.\-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Date · "2026-03-14" · "2026. 3. 14" 을 "YYYY-MM-DD" 로 변환합니다. */
function ymd_(v) {
  if (!v && v !== 0) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  return s;
}

/** "2026-03" 형태의 월 문자열. */
function ym_(v) {
  var d = ymd_(v);
  return d ? d.slice(0, 7) : '';
}

function pad2_(v) { return ('0' + v).slice(-2); }
function pad3_(v) { return ('00' + v).slice(-3); }

function nowIso_() {
  return Utilities.formatDate(new Date(), CFG.TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function today_() {
  return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
}

/* ---------- ID 생성 ---------- */

/** EXP-YYYYMMDD-NNN — NNN 은 시트 전체를 통틀어 이어지는 일련번호입니다. */
function nextExpenseId_(useDate) {
  var data = readSheet_(CFG.SHEET_EXPENSE);
  var max = 0;
  data.rows.forEach(function (r) {
    var m = String(r['지출ID']).match(/EXP-\d{8}-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'EXP-' + ymd_(useDate).replace(/-/g, '') + '-' + pad3_(max + 1);
}

/** SET-YYYYMMDD-NNN — NNN 은 같은 날짜 안에서의 일련번호입니다. */
function nextSettlementId_(depositDate) {
  var stamp = ymd_(depositDate).replace(/-/g, '');
  var data = readSheet_(CFG.SHEET_SETTLEMENT);
  var max = 0;
  data.rows.forEach(function (r) {
    var m = String(r['정산ID']).match(new RegExp('SET-' + stamp + '-(\\d+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'SET-' + stamp + '-' + pad3_(max + 1);
}

function nextSubscriptionId_() {
  var data = readSheet_(CFG.SHEET_SUBSCRIPTION);
  var max = 0;
  data.rows.forEach(function (r) {
    var m = String(r['구독ID']).match(/SUB-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'SUB-' + pad3_(max + 1);
}
