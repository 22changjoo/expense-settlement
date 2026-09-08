/**
 * Claude Vision 영수증 분석.
 * 결과는 어디까지나 초안이며, 화면 A 에서 사용자가 최종 확인·수정합니다.
 */

function visionPrompt_() {
  return [
    '너는 한국 교회 목회자의 영수증을 정리하는 보조 도구다.',
    '첨부된 영수증 이미지에서 다음을 추출해 JSON 하나만 출력하라. 설명 문장이나 코드펜스는 절대 붙이지 마라.',
    '',
    '{"date":"YYYY-MM-DD","amount":숫자,"vendor":"상호명","suggested_category":"목회비|주유비|경비",',
    ' "suggested_subcategory":"건강관리|도서구입|심방|세미나·강의수강|자동차관리|사역도구|기타|null",',
    ' "confidence":"high|medium|low"}',
    '',
    '규칙:',
    '- amount 는 원 단위 정수(쉼표·통화기호 없이). 합계/총액/받을금액에 해당하는 최종 결제금액을 쓴다.',
    '- date 는 영수증에 찍힌 실제 사용일. 판독 불가면 null.',
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

  return { ok: true, data: parsed, subscriptionMatch: matchSubscription_(parsed.vendor, parsed.date) };
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
function matchSubscription_(vendor, useDate) {
  var v = normalizeName_(vendor);
  if (!v) return null;
  var month = ym_(useDate) || ym_(today_());
  var subs = readSheet_(CFG.SHEET_SUBSCRIPTION).rows;
  var expenses = readSheet_(CFG.SHEET_EXPENSE).rows;

  for (var i = 0; i < subs.length; i++) {
    var s = subs[i];
    if (String(s['활성상태']) !== '사용중') continue;
    if (!subActiveInMonth_(s, month)) continue;
    var name = normalizeName_(s['구독명']);
    if (!name) continue;
    if (v.indexOf(name) < 0 && name.indexOf(v) < 0) continue;

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

function normalizeName_(s) {
  return String(s || '').toLowerCase().replace(/[\s()·\-_]|구독|결제|정기|강습/g, '');
}
