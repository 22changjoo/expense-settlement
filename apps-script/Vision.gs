/**
 * Claude Vision 영수증 분석.
 * 결과는 어디까지나 초안이며, 화면 A 에서 사용자가 최종 확인·수정합니다.
 */

function visionPrompt_() {
  return [
    '너는 한국 교회 목회자의 영수증을 정리하는 보조 도구다.',
    '첨부된 영수증 이미지에서 다음을 추출해 JSON 하나만 출력하라. 설명 문장이나 코드펜스는 절대 붙이지 마라.',
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

/** @return {{ok:boolean, data:Object, error:string}} */
function analyzeReceipt_(base64, mimeType) {
  var key = prop_('ANTHROPIC_API_KEY');
  if (!key) {
    return { ok: false, error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다. 값을 직접 입력해 저장하실 수 있습니다.' };
  }
  var clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  var payload = {
    model: CFG.ANTHROPIC_MODEL,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: clean } },
        { type: 'text', text: visionPrompt_() }
      ]
    }]
  };

  var res = UrlFetchApp.fetch(CFG.ANTHROPIC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': CFG.ANTHROPIC_VERSION },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    return { ok: false, error: 'Claude API 오류 (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300) };
  }

  var body = JSON.parse(res.getContentText());
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
