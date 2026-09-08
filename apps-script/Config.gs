/**
 * 목회비·주유비·경비 정산 관리 시스템 — 공통 설정
 *
 * 최초 1회, Apps Script 편집기에서 setupScriptProperties() 를 실행해
 * 스크립트 속성(SPREADSHEET_ID / API_TOKEN / ANTHROPIC_API_KEY)을 등록하십시오.
 */

var CFG = {
  // 시트 이름
  SHEET_EXPENSE: '지출기록',
  SHEET_SETTLEMENT: '정산기록',
  SHEET_SUBSCRIPTION: '정기구독설정',
  SHEET_BUDGET: '예산설정',

  // Drive 폴더
  // 코드 프로젝트 폴더(내 드라이브/코딩/경비정산시스템)와 이름이 겹치지 않도록 구분해 둡니다.
  DRIVE_ROOT: '경비정산_영수증',
  DRIVE_ROOT_LEGACY: '경비정산시스템',   // 예전 이름 — 있으면 자동으로 새 이름으로 바꿉니다
  DRIVE_RECEIPT: '영수증',
  DRIVE_DEPOSIT: '입금캡처',

  // Claude API
  ANTHROPIC_MODEL: 'claude-sonnet-5',
  ANTHROPIC_VERSION: '2023-06-01',
  ANTHROPIC_URL: 'https://api.anthropic.com/v1/messages',

  TZ: 'Asia/Seoul'
};

/** 헤더 정의 — 시트가 없을 때 생성에 사용하며, 열 위치는 헤더 이름으로 찾습니다. */
var HEADERS = {
  '지출기록': ['지출ID', '등록일시', '사용일자', '항목', '목회비세부항목', '인원_내용', '금액',
    '영수증이미지URL', '영수증제출상태', '제출일', '정산기록ID', '정산상태', '연결구독ID', '비고'],
  '정산기록': ['정산ID', '정산유형', '대상기간', '입금액', '입금확인방식', '입금캡처이미지URL',
    '입금일', '연결된지출ID목록', '연결지출합계', '일치여부', '차액'],
  '정기구독설정': ['구독ID', '구독명', '목회비세부항목', '월예상금액', '시작월', '종료월', '활성상태'],
  '예산설정': ['연도', '목회비연간한도', '목회비_건강관리한도', '주유비연간한도']
};

var CATEGORIES = ['목회비', '주유비', '경비'];
var SUBCATEGORIES = ['건강관리', '도서구입', '심방', '세미나·강의수강', '자동차관리', '사역도구', '기타'];

function props_() {
  return PropertiesService.getScriptProperties();
}

function prop_(key, fallback) {
  var v = props_().getProperty(key);
  return (v === null || v === '') ? (fallback === undefined ? '' : fallback) : v;
}

function spreadsheet_() {
  var id = prop_('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID 스크립트 속성이 설정되지 않았습니다. setupScriptProperties() 를 먼저 실행하세요.');
  return SpreadsheetApp.openById(id);
}
