/**
 * Claude Vision 영수증 분석.
 * 결과는 어디까지나 초안이며, 화면 A 에서 사용자가 최종 확인·수정합니다.
 */

function visionPrompt_() {
  return [
    '너는 한국 교회 목회자의 영수증을 정리하는 보조 도구다.',
    '첨부된 영수증(사진 또는 PDF)에서 다음을 추출해 JSON 하나만 출력하라. 설명 문장이나 코드펜스는 절대 붙이지 마라.',
    'PDF 가 여러 쪽이면 결제 금액·결제일이 적힌 쪽을 기준으로 한다.',
    '',
    '{"date":"YYYY-MM-DD","amount":숫자,"vendor":"실제 판매처 상호","product":"상품명 또는 null",',
    ' "suggested_category":"목회비|주유비|경비",',
    ' "suggested_subcategory":"건강관리|도서구입|심방|세미나·강의수강|자동차관리|사역도구|기타|null",',
    ' "confidence":"high|medium|low"}',
    '',
    '규칙:',
    '- amount 는 원 단위 정수(쉼표·통화기호 없이). 합계/총액/받을금액에 해당하는 최종 결제금액을 쓴다.',
    '- date 는 영수증에 찍힌 실제 사용일. 판독 불가면 null.',
    '- **vendor 는 결제대행사가 아니라 실제로 물건·서비스를 판 곳을 쓴다.**',
    '  온라인 결제 전표에서 가맹점명이 결제대행사(KG이니시스, 케이지이니시스, 토스페이먼츠,',
    '  NHN KCP, 나이스페이, 다날, 페이레터, 카카오페이, 네이버페이 등)이면 그것을 쓰지 말고,',
    '  "공급자 상호" · "판매자" · "상품명" 항목에서 실제 판매처를 찾아 쓴다.',
    '- product 는 영수증의 "상품명"·"품목"에 적힌 이름을 그대로 쓴다(예: "두플러스프리미엄플랜").',
    '  구독 서비스인지 판단하는 데 쓰이므로 요약하거나 바꾸지 말 것. 없으면 null.',
    '- 정기 구독 상품(월간·연간 이용권, OO플랜, OO멤버십)으로 보이면 신뢰도와 무관하게',
    '  product 를 반드시 채운다.',
    '- 분류 기준:',
    '  · 주유소 상호(S-OIL, GS칼텍스, SK에너지 등)나 휘발유·경유 등 유종 표기가 있으면 "주유비".',
    '  · 식당·카페 등 식사류로 동석 인원을 특정해야 할 것으로 보이면 "목회비".',
    '  · 그 밖의 사역 관련 물품 구입 등은 "경비".',
    '- suggested_subcategory 는 suggested_category 가 "목회비"일 때만 채우고, 그 외에는 null.',
    '  · 헬스장·수영장·요가원 → "건강관리"',
    '  · 서점·온라인 도서 → "도서구입"',
    '  · 타이어숍·카센터·오일교환 → "자동차관리"',
    '  · 소프트웨어 구독(Claude, ChatGPT, Obsidian, 1Password 등 사역용 도구) → "사역도구"',
    '  · 심방·조의금·심방 선물·주차비 → "심방"',
    '  · 세미나·강의 수강료 → "세미나·강의수강"',
    '  · 확실하지 않으면 "기타"로 두고 confidence 를 낮춰라.'
  ].join('\n');
}

var SUPPORTED_IMAGE_TYPES_ = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
var MAX_FILE_BASE64_ = 14 * 1024 * 1024;   // base64 약 14MB ≈ 원본 10MB

/**
 * Claude API 호출.
 * 과부하(529)·요청 한도(429)·서버 오류(5xx)·연결 끊김은 잠깐 뒤 다시 시도합니다.
 * 한 번의 일시적 오류로 영수증 인식이 통째로 실패하던 것을 막습니다.
 */
function callClaude_(key, payload) {
  var RETRYABLE = [408, 409, 429, 500, 502, 503, 504, 529];
  var waits = [1500, 4000];
  var last = '';
  for (var attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt > 0) Utilities.sleep(waits[attempt - 1]);
    var res;
    try {
      res = UrlFetchApp.fetch(CFG.ANTHROPIC_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-api-key': key, 'anthropic-version': CFG.ANTHROPIC_VERSION },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (e) {
      last = 'Claude API 에 연결하지 못했습니다 (' + (e && e.message ? e.message : e) + ')';
      continue;
    }
    var code = res.getResponseCode();
    if (code === 200) return { ok: true, body: JSON.parse(res.getContentText()), attempts: attempt + 1 };
    last = describeClaudeError_(code, res.getContentText());
    if (RETRYABLE.indexOf(code) < 0) break;
  }
  return { ok: false, error: last };
}

/** 사람이 알아볼 수 있는 오류 문장. 원래 코드도 함께 남깁니다. */
function describeClaudeError_(code, text) {
  var t = String(text || '');
  if (code === 401) return 'Claude API 키가 올바르지 않습니다 (401). 스크립트 속성 ANTHROPIC_API_KEY 를 확인하세요.';
  if (/credit balance/i.test(t)) return 'Anthropic 크레딧이 부족합니다 (' + code + '). Console 에서 결제 상태를 확인하세요.';
  if (code === 529 || /overloaded/i.test(t)) return 'Claude 서버가 혼잡합니다 (' + code + '). 잠시 후 다시 시도하세요.';
  if (code === 429) return 'Claude API 요청 한도를 넘었습니다 (429). 잠시 후 다시 시도하세요.';
  if (code === 413) return '파일이 너무 커서 분석하지 못했습니다 (413).';
  if (/PDF specified was not valid|password|encrypt/i.test(t)) {
    return 'PDF 를 읽을 수 없습니다 (' + code + '). 손상되었거나 암호가 걸린 파일인지 확인하세요.';
  }
  return 'Claude API 오류 (' + code + '): ' + t.slice(0, 200);
}

/**
 * 영수증 분석. 사진(JPG·PNG 등)과 PDF 를 모두 받습니다.
 * @return {{ok:boolean, data:Object, error:string}}
 */
function analyzeReceipt_(base64, mimeType) {
  var key = prop_('ANTHROPIC_API_KEY');
  if (!key) {
    return { ok: false, error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다. 값을 직접 입력해 저장하실 수 있습니다.' };
  }
  var clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!clean) return { ok: false, error: '파일 내용이 비어 있습니다.' };
  if (clean.length > MAX_FILE_BASE64_) return { ok: false, error: '파일이 너무 큽니다. 10MB 이하로 올려 주세요.' };

  var mime = String(mimeType || 'image/jpeg').toLowerCase();
  var isPdf = mime === 'application/pdf';
  if (!isPdf && SUPPORTED_IMAGE_TYPES_.indexOf(mime) < 0) {
    return { ok: false, error: '지원하지 않는 파일 형식입니다 (' + mime + '). JPG·PNG 사진이나 PDF 를 올려 주세요.' };
  }

  // PDF 는 document 블록으로 보내면 Claude 가 글자와 모양을 함께 읽습니다.
  var fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: clean } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: clean } };

  var payload = {
    model: CFG.ANTHROPIC_MODEL,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [fileBlock, { type: 'text', text: visionPrompt_() }]
    }]
  };

  var call = callClaude_(key, payload);
  if (!call.ok) {
    console.error('영수증 분석 실패 (' + mime + '): ' + call.error);
    return { ok: false, error: call.error };
  }

  var body = call.body;
  var text = (body.content || []).map(function (c) { return c.text || ''; }).join('').trim();
  var parsed = extractJson_(text);
  if (!parsed) return { ok: false, error: '분석 결과를 해석하지 못했습니다: ' + text.slice(0, 200) };

  // 값 정규화
  parsed.amount = num_(parsed.amount);
  parsed.date = parsed.date ? ymd_(parsed.date) : '';
  if (CATEGORIES.indexOf(parsed.suggested_category) < 0) parsed.suggested_category = '경비';
  if (parsed.suggested_category !== '목회비' || SUBCATEGORIES.indexOf(parsed.suggested_subcategory) < 0) {
    parsed.suggested_subcategory = parsed.suggested_category === '목회비' ? '기타' : '';
  }
  parsed.vendor = parsed.vendor || '';
  parsed.product = parsed.product || '';

  // 상호와 상품명 모두를 후보로 두고 정기구독을 찾습니다.
  // 온라인 결제 전표는 상호가 결제대행사로 찍히는 일이 많아 상품명이 더 정확합니다.
  var match = matchSubscription_([parsed.product, parsed.vendor], parsed.date);
  return { ok: true, data: parsed, subscriptionMatch: match };
}

function extractJson_(text) {
  var s = String(text).replace(/```json|```/g, '').trim();
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
}

/**
 * 상호명이 활성 정기구독과 닮았고, 해당 월에 아직 실제 지출이 연결되지 않았다면
 * 연결 후보로 제안합니다.
 */
function matchSubscription_(texts, useDate) {
  var candidates = (Array.isArray(texts) ? texts : [texts])
    .map(normalizeName_)
    .filter(String);
  if (!candidates.length) return null;
  var month = ym_(useDate) || ym_(today_());
  var subs = readSheet_(CFG.SHEET_SUBSCRIPTION).rows;
  var expenses = readSheet_(CFG.SHEET_EXPENSE).rows;

  for (var i = 0; i < subs.length; i++) {
    var s = subs[i];
    if (String(s['활성상태']) !== '사용중') continue;
    if (!subActiveInMonth_(s, month)) continue;
    var name = normalizeName_(s['구독명']);
    if (!name) continue;
    var hit = candidates.some(function (c) {
      return c.indexOf(name) >= 0 || name.indexOf(c) >= 0;
    });
    if (!hit) continue;

    var already = expenses.some(function (e) {
      return String(e['연결구독ID']) === String(s['구독ID']) && ym_(e['사용일자']) === month;
    });
    if (already) return null;

    return {
      구독ID: s['구독ID'],
      구독명: s['구독명'],
      목회비세부항목: s['목회비세부항목'],
      월예상금액: num_(s['월예상금액'])
    };
  }
  return null;
}

/** 비교용으로 군더더기를 걷어낸 이름. "두플러스프리미엄플랜" → "두플러스" */
function normalizeName_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s()·\-_,.]/g, '')
    .replace(/주식회사|사단법인|재단법인/g, '')
    .replace(/구독|결제|정기|강습|이용권|멤버십|프리미엄|플랜|월간|연간|서비스/g, '');
}
