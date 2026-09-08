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

  async function call(action, payload = {}) {
    const { url, token } = getConfig();
    if (!url) throw new Error('웹앱 URL 이 설정되지 않았습니다.');

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, action, payload }),
        redirect: 'follow'
      });
    } catch (e) {
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

  return { call, getConfig, setConfig, isConfigured };
})();
