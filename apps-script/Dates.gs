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
