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
  async function call(action, payload = {}, opts = {}) {
    const { url, token } = getConfig();
    if (!url) throw new Error('웹앱 URL 이 설정되지 않았습니다.');

    const retries = payload.요청ID ? (opts.retries ?? 2) : 0;
    const requestBody = JSON.stringify({ token, action, payload });

    let res, lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: requestBody,
          redirect: 'follow'
        });
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (attempt < retries) await sleep(1200 * (attempt + 1));
      }
    }
    if (lastError) {
      throw new Error('서버에 연결하지 못했습니다. 네트워크와 웹앱 URL 을 확인하세요.');
    }

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      throw new Error('서버 응답을 해석하지 못했습니다. 웹앱이 "모든 사용자" 접근으로 배포되었는지 확인하세요.');
    }
    if (!body.ok) throw new Error(body.error || '알 수 없는 오류');
    return body.data;
  }

  return { call, getConfig, setConfig, isConfigured, newRequestId };
})();
