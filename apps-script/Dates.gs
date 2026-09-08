/**
 * 주차 기준: ISO 8601 (월요일 시작).
 * 경비 정산의 "대상기간"은 "2026-W36" 형태로 저장하고, 화면에서는
 * "2026년 9월 1주차 (9/1~9/7)" 처럼 함께 보여줍니다.
 */

function parseYmd_(s) {
  var p = String(ymd_(s)).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function fmtYmd_(d) {
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}

/** 그 날짜가 속한 ISO 주의 월요일. */
function isoMonday_(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var dow = (x.getDay() + 6) % 7; // 월=0 … 일=6
  x.setDate(x.getDate() - dow);
  return x;
}

/** "YYYY-Www" */
function isoWeekKey_(dateLike) {
  var mon = isoMonday_(parseYmd_(dateLike));
  var thu = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 3); // 그 주의 목요일이 연도를 결정
  var jan1 = new Date(thu.getFullYear(), 0, 1);
  var week = Math.floor((thu - isoMonday_(jan1)) / (7 * 86400000)) + 1;
  return thu.getFullYear() + '-W' + pad2_(week);
}

/** "YYYY-Www" → {start, end} (YYYY-MM-DD) */
function weekRange_(key) {
  var m = String(key).match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  var year = Number(m[1]), week = Number(m[2]);
  var jan4 = new Date(year, 0, 4);
  var start = isoMonday_(jan4);
  start.setDate(start.getDate() + (week - 1) * 7);
  var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start: fmtYmd_(start), end: fmtYmd_(end) };
}

/** 해당 월과 겹치는 ISO 주 목록. 화면 D 의 주차 드롭다운에 씁니다. */
function weeksOfMonth_(ym) {
  var p = String(ym).split('-');
  var year = Number(p[0]), month = Number(p[1]);
  var first = new Date(year, month - 1, 1);
  var last = new Date(year, month, 0);
  var seen = {}, out = [];
  for (var d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    var key = isoWeekKey_(fmtYmd_(d));
    if (seen[key]) continue;
    seen[key] = true;
    var r = weekRange_(key);
    out.push({ key: key, start: r.start, end: r.end, label: '' });
  }
  out.forEach(function (w, i) {
    var s = w.start.split('-'), e = w.end.split('-');
    w.label = year + '년 ' + month + '월 ' + (i + 1) + '주차 (' +
      Number(s[1]) + '/' + Number(s[2]) + '~' + Number(e[1]) + '/' + Number(e[2]) + ')';
  });
  return out;
}

/** 정기구독이 해당 월에 유효한지. */
function subActiveInMonth_(sub, month) {
  var start = ym_(sub['시작월']);
  var end = ym_(sub['종료월']);
  if (start && month < start) return false;
  if (end && month > end) return false;
  return true;
}

/** "YYYY-01" … "YYYY-12" */
function monthsOfYear_(year) {
  var out = [];
  for (var m = 1; m <= 12; m++) out.push(year + '-' + pad2_(m));
  return out;
}
