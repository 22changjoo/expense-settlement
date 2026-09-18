/**
 * Web App 진입점.
 *
 * 프런트엔드(GitHub Pages)는 다른 출처에서 호출하므로, 프리플라이트를 피하기 위해
 * POST 본문을 text/plain 으로 보냅니다. 본문은 {token, action, payload} JSON 입니다.
 */

/** 요청 내용이 도착하지 않았음을 알립니다. 앱은 이 코드를 보고 다시 보냅니다. */
function emptyRequest_() {
  return json_({ ok: false, code: 'EMPTY_REQUEST', error: '요청 내용이 서버에 전달되지 않았습니다.' });
}

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  // 앱은 모든 요청을 POST 로 보냅니다. 인자 없는 GET 은 구글이 POST 를 되돌려 보내면서
  // 본문이 사라진 경우이므로, 예전처럼 ping(ok:true) 으로 답해 성공처럼 보이게 하지 않습니다.
  if (!action) return emptyRequest_();
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
  if (!body.action) return emptyRequest_();
  return handle_(body.action, body.payload || {}, body.token);
}

/**
 * 시트를 고치는 요청.
 * 앱은 저장을 뒤에서 처리하므로 여러 저장이 거의 동시에 들어올 수 있습니다.
 * 한 요청이 읽고 쓰는 사이에 다른 요청이 끼어들면 먼저 쓴 값이 사라지므로,
 * 이런 요청은 잠금을 잡고 하나씩 처리합니다.
 */
var WRITE_ACTIONS = {
  createExpense: 1, importExpenses: 1, updateExpense: 1, deleteExpense: 1,
  toggleSubmitted: 1, bulkSetSubmitted: 1,
  createSettlement: 1, deleteSettlement: 1,
  saveSubscription: 1, deleteSubscription: 1,
  updateBudget: 1, addBudgetYear: 1, deleteBudgetYear: 1, addSubLimit: 1, deleteSubLimit: 1
};

function handle_(action, payload, token) {
  try {
    var expected = prop_('API_TOKEN');
    if (expected && String(token) !== expected) {
      return json_({ ok: false, error: '접근 토큰이 올바르지 않습니다. 설정 화면에서 토큰을 확인하세요.', code: 'AUTH' });
    }
    var lock = null;
    if (WRITE_ACTIONS[action]) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) {
        throw new Error('다른 저장이 진행 중입니다. 잠시 후 다시 시도하세요.');
      }
    }
    try {
      var result = route_(action, payload);
      if (WRITE_ACTIONS[action]) bumpDataVersion_();   // 캐시된 bootstrap 을 버립니다
      return json_({ ok: true, data: result });
    } finally {
      if (lock) lock.releaseLock();
    }
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
    case 'importExpenses':    return importExpenses_(p);
    case 'updateExpense':     return updateExpense_(p);
    case 'deleteExpense':     return deleteExpense_(p);
    case 'toggleSubmitted':   return toggleSubmitted_(p);
    case 'bulkSetSubmitted':  return bulkSetSubmitted_(p);
    case 'receiptImage':      return fetchImageBase64_(p.url);

    case 'listSettlements':   return { settlements: allSettlements_() };
    case 'createSettlement':  return createSettlement_(p);
    case 'deleteSettlement':  return deleteSettlement_(p);

    case 'listSubscriptions': return { subscriptions: allSubscriptions_() };
    case 'saveSubscription':  return saveSubscription_(p);
    case 'deleteSubscription':return deleteSubscription_(p);

    case 'getBudget':         return budgetForYear_(p.year);
    case 'listBudgets':       return { budgets: listBudgets_() };
    case 'updateBudget':      return updateBudget_(p);
    case 'addBudgetYear':     return addBudgetYear_(p);
    case 'deleteBudgetYear':  return deleteBudgetYear_(p);
    case 'addSubLimit':       return addSubLimit_(p);
    case 'deleteSubLimit':    return deleteSubLimit_(p);
    case 'driveStatus':       return driveStatus_();
    case 'exportCsv':         return exportCsv_(p);
    default:
      throw new Error('알 수 없는 action: ' + action);
  }
}

/** 앱 시작 시 필요한 데이터를 한 번에 내려줍니다. */
/*
 * bootstrap 응답 캐시.
 *
 * 앱은 열 때마다, 그리고 저장할 때마다 bootstrap 을 부르는데 5~8초가 걸립니다
 * (시트 4개를 읽고 대시보드를 계산). 내용이 바뀌지 않았다면 다시 계산할 이유가
 * 없으므로, 계산 결과를 캐시에 두고 쓰기가 일어날 때만 버립니다.
 * 시트를 손으로 고치는 경우를 위해 3분이 지나면 저절로 비워집니다.
 */
var BOOTSTRAP_TTL_ = 180;
var CACHE_CHUNK_ = 20000;   // 한글은 글자당 3바이트라 넉넉히 나눕니다(칸당 100KB 제한)

function dataVersion_() {
  return prop_('DATA_VERSION', '0');
}

function bumpDataVersion_() {
  props_().setProperty('DATA_VERSION', String(Number(dataVersion_()) + 1));
}

function cacheGet_(key) {
  var c = CacheService.getScriptCache();
  var count = Number(c.get(key));
  if (!count) return null;
  var keys = [];
  for (var i = 0; i < count; i++) keys.push(key + ':' + i);
  var parts = c.getAll(keys);
  var out = '';
  for (var j = 0; j < count; j++) {
    var part = parts[key + ':' + j];
    if (part === undefined || part === null) return null;   // 일부만 남았으면 버립니다
    out += part;
  }
  return out;
}

function cachePut_(key, value, seconds) {
  var count = Math.ceil(value.length / CACHE_CHUNK_);
  if (count > 20) return;
  var map = {};
  for (var i = 0; i < count; i++) map[key + ':' + i] = value.substr(i * CACHE_CHUNK_, CACHE_CHUNK_);
  var c = CacheService.getScriptCache();
  c.putAll(map, seconds);
  c.put(key, String(count), seconds);
}

function bootstrap_(p) {
  var year = Number(p.year) || Number(Utilities.formatDate(new Date(), CFG.TZ, 'yyyy'));
  var key = 'boot:' + year + ':' + dataVersion_();
  if (!p.force) {
    var hit = cacheGet_(key);
    if (hit) {
      try { return JSON.parse(hit); } catch (e) { /* 깨진 캐시는 무시하고 다시 계산합니다 */ }
    }
  }
  var data = buildBootstrap_(year);
  cachePut_(key, JSON.stringify(data), BOOTSTRAP_TTL_);
  return data;
}

function buildBootstrap_(year) {
  return {
    dashboard: buildDashboard_(year),
    expenses: allExpenses_(),
    subscriptions: allSubscriptions_(),
    settlements: allSettlements_(),
    budget: budgetForYear_(year),
    budgets: listBudgets_(),
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
