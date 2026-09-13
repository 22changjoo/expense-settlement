/**
 * Apps Script 웹앱 호출.
 * CORS 프리플라이트를 피하려고 본문을 text/plain 으로 보냅니다
 * (Apps Script 는 OPTIONS 를 처리하지 못합니다).
 */
const API = (() => {
  const KEY_URL = 'exp.apiUrl';
  const KEY_TOKEN = 'exp.token';

  function getConfig() {
    return {
      url: localStorage.getItem(KEY_URL) || '',
      token: localStorage.getItem(KEY_TOKEN) || ''
    };
  }

  function setConfig(url, token) {
    localStorage.setItem(KEY_URL, (url || '').trim());
    localStorage.setItem(KEY_TOKEN, (token || '').trim());
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c.url && c.token);
  }

  /** 저장 요청마다 붙이는 고유 번호. 재시도해도 같은 값을 씁니다. */
  function newRequestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /**
   * @param opts.retries  네트워크 오류일 때 다시 시도할 횟수
   *
   * fetch 가 실패했다는 것은 응답을 못 받았다는 뜻일 뿐, 서버가 저장하지
   * 않았다는 뜻이 아닙니다. payload.요청ID 가 있으면 서버가 같은 요청을
   * 알아보고 두 번 저장하지 않으므로, 안심하고 다시 보낼 수 있습니다.
   */
  /** 조회만 하는 요청 — 몇 번을 다시 보내도 데이터가 바뀌지 않습니다. */
  const READ_ACTIONS = new Set([
    'ping', 'bootstrap', 'dashboard', 'listExpenses', 'receiptImage',
    'settlementCandidates', 'weeksOfMonth', 'listSettlements', 'listSubscriptions',
    'getBudget', 'listBudgets', 'driveStatus', 'exportCsv'
  ]);

  /**
   * 한 번 보낼 때 기다리는 최대 시간.
   * 구글이 요청을 되돌리기 시작하면 리다이렉트를 몇 번씩 오가며 1분 넘게 붙잡혀
   * 있기도 합니다. 그만 기다리고 다시 보내는 편이 빠릅니다. 영수증 분석과 사진이
   * 실리는 저장은 원래 오래 걸리므로 넉넉히 둡니다.
   */
  const TIMEOUT_MS = { analyzeReceipt: 90000, createExpense: 60000, createSettlement: 60000, importExpenses: 120000 };
  const DEFAULT_TIMEOUT_MS = 30000;

  /** 다시 보내면 나아질 수 있는 실패(연결 끊김, 깨진 응답, 너무 늦은 응답, 구글이 요청을 되돌린 경우) */
  class TransientError extends Error {}

  async function call(action, payload = {}, opts = {}) {
    const { url, token } = getConfig();
    if (!url) throw new Error('웹앱 URL 이 설정되지 않았습니다.');

    // 조회, 요청ID 가 붙은 저장(서버가 중복을 걸러 냄), 호출하는 쪽이 안전하다고
    // 알려 준 요청만 다시 보냅니다.
    const retries = opts.retries ?? ((READ_ACTIONS.has(action) || payload.요청ID) ? 2 : 0);
    const requestBody = JSON.stringify({ token, action, payload });
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS[action] ?? DEFAULT_TIMEOUT_MS;

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(1200 * attempt);
      try {
        return await sendOnce(url, requestBody, action, timeoutMs);
      } catch (e) {
        if (!(e instanceof TransientError)) throw e;   // 토큰·입력 오류는 다시 보내도 같습니다
        lastError = e;
      }
    }

    if (READ_ACTIONS.has(action)) throw new Error(lastError.message);
    // 저장 요청은 서버에서 이미 처리됐을 수도 있으므로 '실패' 라고 단정하지 않습니다.
    throw new Error('저장 결과를 확인하지 못했습니다. 새로고침해서 반영됐는지 확인하세요.');
  }

  async function sendOnce(url, requestBody, action, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let text;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: requestBody,
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal
      });
      text = await res.text();
    } catch (e) {
      throw new TransientError(controller.signal.aborted
        ? '서버 응답이 너무 늦습니다. 잠시 후 다시 시도하세요.'
        : '서버에 연결하지 못했습니다. 네트워크 상태를 확인하세요.');
    } finally {
      clearTimeout(timer);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      throw new TransientError('서버 응답을 해석하지 못했습니다. 잠시 후 다시 시도하세요.');
    }

    // 구글이 요청을 되돌려 보내면서 본문이 사라져 '빈 요청' 으로 도착한 경우입니다.
    // 새 서버는 EMPTY_REQUEST 로, 예전 서버는 ping 응답(ok:true, data 없음)으로 답합니다.
    // 성공으로 받아들이면 빈 데이터로 화면을 그리거나 저장 결과를 놓치게 됩니다.
    if (body.code === 'EMPTY_REQUEST' || (body.ok && !('data' in body) && action !== 'ping')) {
      throw new TransientError('서버가 요청 내용을 받지 못했습니다. 잠시 후 다시 시도하세요.');
    }
    if (!body.ok) throw new Error(body.error || '알 수 없는 오류');
    return body.data;
  }

  return { call, getConfig, setConfig, isConfigured, newRequestId };
})();
