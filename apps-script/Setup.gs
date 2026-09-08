/**
 * 최초 설치 · 유지보수용 함수.
 * Apps Script 편집기에서 직접 실행합니다 (웹앱 라우터에서는 호출되지 않습니다).
 */

/**
 * 1) 스크립트 속성 등록.
 *
 * SPREADSHEET_ID 는 데이터 시트 주소의 `/d/` 와 `/edit` 사이 문자열입니다.
 * 시트에 연결된(container-bound) 프로젝트라면 아래처럼 비워 두어도 자동으로 찾습니다.
 *
 * 이미 등록된 값은 덮어쓰지 않습니다. 토큰을 새로 발급하려면
 * resetApiToken() 을 실행하세요.
 */
function setupScriptProperties() {
  var sheetId = '';   // ← 독립 프로젝트라면 여기에 시트 ID 를 넣으세요
  if (!sheetId) {
    var bound = SpreadsheetApp.getActiveSpreadsheet();
    if (bound) sheetId = bound.getId();
  }

  var current = props_().getProperties();
  var next = {};
  if (sheetId && !current.SPREADSHEET_ID) next.SPREADSHEET_ID = sheetId;
  if (!current.API_TOKEN) next.API_TOKEN = Utilities.getUuid();
  if (current.ANTHROPIC_API_KEY === undefined) next.ANTHROPIC_API_KEY = '';
  if (Object.keys(next).length) props_().setProperties(next, false);

  if (!prop_('SPREADSHEET_ID')) {
    throw new Error('SPREADSHEET_ID 를 찾지 못했습니다. 이 함수 안의 sheetId 변수에 시트 ID 를 직접 넣고 다시 실행하세요.');
  }
  Logger.log('SPREADSHEET_ID = %s', prop_('SPREADSHEET_ID'));
  Logger.log('API_TOKEN = %s', prop_('API_TOKEN'));
}

/** 접근 토큰을 새로 발급합니다. 기존 기기에서는 다시 입력해야 합니다. */
function resetApiToken() {
  var token = Utilities.getUuid();
  props_().setProperty('API_TOKEN', token);
  Logger.log('새 API_TOKEN = %s', token);
}

/** 2) 시트 4종과 Drive 폴더를 만들어 둡니다(이미 있으면 그대로 둡니다). */
function setupSheetsAndFolders() {
  Object.keys(HEADERS).forEach(function (name) { sheet_(name); });
  receiptFolder_(today_());
  depositFolder_(today_());
  ensureBudgetRow_(Number(Utilities.formatDate(new Date(), CFG.TZ, 'yyyy')));
  Logger.log('시트·폴더 준비 완료: %s', rootFolder_().getUrl());
}

/** 3) 매년 1월 1일 예산 행 자동 생성 트리거를 겁니다. */
function setupAnnualTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rolloverBudget') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rolloverBudget')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .create();
  Logger.log('예산 초기화 트리거 등록 완료 (매월 1일 03시 실행, 1월에만 동작)');
}

/** 트리거 본체 — 1월에만 해당 연도 행을 만듭니다. */
function rolloverBudget() {
  var now = new Date();
  if (Number(Utilities.formatDate(now, CFG.TZ, 'MM')) !== 1) return;
  var year = Number(Utilities.formatDate(now, CFG.TZ, 'yyyy'));
  ensureBudgetRow_(year);
  Logger.log('%s년 예산 행 확인 완료', year);
}

/** 현재 토큰을 로그로 확인합니다. */
function showApiToken() {
  Logger.log('API_TOKEN = %s', prop_('API_TOKEN'));
  Logger.log('Web App URL 은 [배포] > [배포 관리] 에서 확인하세요.');
}
