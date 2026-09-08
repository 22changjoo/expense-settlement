/**
 * Web App 진입점.
 *
 * 프런트엔드(GitHub Pages)는 다른 출처에서 호출하므로, 프리플라이트를 피하기 위해
 * POST 본문을 text/plain 으로 보냅니다. 본문은 {token, action, payload} JSON 입니다.
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  if (action === 'ping') return json_({ ok: true, service: '경비정산시스템', time: nowIso_() });
  return handle_(action, e.parameter || {}, (e.parameter || {}).token);
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: '요청 본문을 해석할 수 없습니다.' });
  }
  return handle_(body.action, body.payload || {}, body.token);
}

function handle_(action, payload, token) {
  try {
    var expected = prop_('API_TOKEN');
    if (expected && String(token) !== expected) {
      return json_({ ok: false, error: '접근 토큰이 올바르지 않습니다. 설정 화면에서 토큰을 확인하세요.', code: 'AUTH' });
    }
    return json_({ ok: true, data: route_(action, payload) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function route_(action, p) {
  switch (action) {
    case 'ping':              return { service: '경비정산시스템', time: nowIso_() };
    case 'bootstrap':         return bootstrap_(p);
    case 'dashboard':         return buildDashboard_(p.year);
    case 'listExpenses':      return { expenses: allExpenses_() };
    case 'analyzeReceipt':    return analyzeReceipt_(p.imageBase64, p.mimeType);
    case 'createExpense':     return createExpense_(p);
    case 'updateExpense':     return updateExpense_(p);
    case 'deleteExpense':     return deleteExpense_(p);
    case 'toggleSubmitted':   return toggleSubmitted_(p);
    case 'receiptImage':      return fetchImageBase64_(p.url);

    case 'settlementCandidates': return { candidates: settlementCandidates_(p.정산유형, p.대상기간) };
    case 'weeksOfMonth':      return { weeks: weeksOfMonth_(p.month) };
    case 'listSettlements':   return { settlements: allSettlements_() };
    case 'createSettlement':  return createSettlement_(p);
    case 'deleteSettlement':  return deleteSettlement_(p);

    case 'listSubscriptions': return { subscriptions: allSubscriptions_() };
    case 'saveSubscription':  return saveSubscription_(p);
    case 'deleteSubscription':return deleteSubscription_(p);

    case 'getBudget':         return budgetForYear_(p.year);
    case 'updateBudget':      return updateBudget_(p);
    case 'driveStatus':       return driveStatus_();
    case 'exportCsv':         return exportCsv_(p);
    default:
      throw new Error('알 수 없는 action: ' + action);
  }
}

/** 앱 시작 시 필요한 데이터를 한 번에 내려줍니다. */
function bootstrap_(p) {
  var year = Number(p.year) || Number(Utilities.formatDate(new Date(), CFG.TZ, 'yyyy'));
  return {
    dashboard: buildDashboard_(year),
    expenses: allExpenses_(),
    subscriptions: allSubscriptions_(),
    settlements: allSettlements_(),
    budget: budgetForYear_(year),
    meta: {
      categories: CATEGORIES,
      subcategories: SUBCATEGORIES,
      today: today_(),
      year: year
    }
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
