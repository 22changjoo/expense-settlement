/** 공통 UI 유틸 — 포맷, 아이콘, 토스트, 바텀시트, 이미지 리사이즈. */

const UI = (() => {
  const won = n => (Number(n) || 0).toLocaleString('ko-KR') + '원';
  const num = n => (Number(n) || 0).toLocaleString('ko-KR');

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function dateLabel(ymd) {
    if (!ymd) return '';
    const [y, m, d] = String(ymd).split('-');
    return `${y}.${m}.${d}`;
  }

  function pct(used, limit) {
    if (!limit) return 0;
    return Math.round((used / limit) * 1000) / 10;
  }

  /** 80% 초과 주의, 100% 초과 경고 */
  function tone(used, limit) {
    if (!limit) return '';
    const p = used / limit;
    if (p > 1) return 'danger';
    if (p > 0.8) return 'warn';
    return '';
  }

  const CATEGORY_ICON = { '목회비': 'heart-handshake', '주유비': 'fuel', '경비': 'receipt' };
  const SUB_ICON = {
    '건강관리': 'dumbbell', '도서구입': 'book-open', '심방': 'home',
    '세미나·강의수강': 'graduation-cap', '자동차관리': 'wrench',
    '사역도구': 'laptop', '기타': 'circle-ellipsis'
  };
  const icon = name => `<i data-lucide="${name}"></i>`;

  function refreshIcons(root) {
    if (window.lucide) window.lucide.createIcons({ nameAttr: 'data-lucide', root });
  }

  /** 지출 상태 배지들 */
  function statusBadges(e) {
    const out = [];
    out.push(e.영수증제출상태 === '제출완료'
      ? `<span class="badge ok">${icon('circle-check')}제출완료</span>`
      : `<span class="badge warn">${icon('circle-alert')}미제출</span>`);

    if (e.정산상태 === '정산완료') out.push(`<span class="badge ok">${icon('circle-check')}정산완료</span>`);
    else if (e.정산상태 === '금액불일치') out.push(`<span class="badge danger">${icon('triangle-alert')}금액불일치</span>`);
    else if (e.정산상태 === '정산확인불가(과거기록)') out.push(`<span class="badge">${icon('archive')}과거기록</span>`);
    else out.push(`<span class="badge">${icon('clock')}미정산</span>`);

    return out.join('');
  }

  /* ---------- 토스트 ---------- */
  function toast(message, variant) {
    const el = document.createElement('div');
    el.className = 'toast' + (variant ? ' ' + variant : '');
    el.textContent = message;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  /* ---------- 로딩 ---------- */
  let loadingDepth = 0;
  function loading(on, text) {
    const el = document.getElementById('loading');
    loadingDepth = Math.max(0, loadingDepth + (on ? 1 : -1));
    if (text) document.getElementById('loading-text').textContent = text;
    el.hidden = loadingDepth === 0;
  }

  /* ---------- 바텀시트 ---------- */
  function openSheet(html) {
    const sheet = document.getElementById('sheet');
    const body = document.getElementById('sheet-body');
    body.innerHTML = html;
    sheet.hidden = false;
    refreshIcons(body);
    return body;
  }
  function closeSheet() {
    document.getElementById('sheet').hidden = true;
    document.getElementById('sheet-body').innerHTML = '';
  }

  /** 확인 대화상자 (바텀시트) */
  function confirmSheet(title, message, confirmLabel = '확인', danger = false) {
    return new Promise(resolve => {
      const body = openSheet(`
        <h2 class="sheet-title">${esc(title)}</h2>
        <p class="muted" style="white-space:pre-line">${esc(message)}</p>
        <div class="row">
          <button class="btn" data-act="cancel">취소</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmLabel)}</button>
        </div>`);
      body.querySelector('[data-act=cancel]').onclick = () => { closeSheet(); resolve(false); };
      body.querySelector('[data-act=ok]').onclick = () => { closeSheet(); resolve(true); };
    });
  }

  /* ---------- 이미지 ---------- */

  /**
   * 업로드 전 이미지를 줄입니다.
   *
   * 영수증은 글자만 읽히면 되므로 원본 그대로 둘 이유가 없습니다.
   * 목표 용량(기본 200KB) 안에 들어올 때까지 해상도와 품질을 단계적으로 낮춥니다.
   * 1400px / 품질 0.75 면 대개 100~200KB 이고, 금액·날짜를 읽는 데 충분합니다.
   */
  const IMAGE_STEPS = [
    { maxSide: 1400, quality: 0.75 },
    { maxSide: 1400, quality: 0.62 },
    { maxSide: 1200, quality: 0.60 },
    { maxSide: 1000, quality: 0.55 },
    { maxSide: 900,  quality: 0.45 }
  ];

  function encodeAt(img, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    // 축소할 때 글자가 뭉개지지 않도록 부드럽게 리샘플링합니다.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h };
  }

  /** base64 문자열의 실제 바이트 수 */
  function base64Bytes(b64) {
    const padding = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    return Math.floor(b64.length * 3 / 4) - padding;
  }

  function readImage(file, targetBytes = 200 * 1024) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('이미지 형식을 인식하지 못했습니다.'));
        img.onload = () => {
          let out = null;
          for (const step of IMAGE_STEPS) {
            out = encodeAt(img, step.maxSide, step.quality);
            out.base64 = out.dataUrl.split(',')[1];
            out.bytes = base64Bytes(out.base64);
            if (out.bytes <= targetBytes) break;   // 목표 용량에 들면 더 줄이지 않습니다
          }
          resolve({
            dataUrl: out.dataUrl,
            base64: out.base64,
            mimeType: 'image/jpeg',
            bytes: out.bytes,
            width: out.width,
            height: out.height,
            originalBytes: file.size
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /** 1024 단위 사람이 읽는 크기 */
  function fileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }

  /** 게이지 마크업. projected 가 있으면 점선 음영으로 예상분을 덧그립니다. */
  function gauge(used, limit, projected) {
    const p = Math.min(100, limit ? (used / limit) * 100 : 0);
    const pp = Math.min(100, limit && projected ? (projected / limit) * 100 : 0);
    const t = tone(projected || used, limit);
    const cls = t === 'danger' ? ' is-danger' : t === 'warn' ? ' is-warn' : '';
    const overlay = pp > p
      ? `<div class="gauge-projected" style="left:${p}%;width:${pp - p}%"></div>` : '';
    return `<div class="gauge"><div class="gauge-fill${cls}" style="width:${p}%"></div>${overlay}</div>`;
  }

  /**
   * 구성비 도넛. slices = [{이름, 금액, 색}] (금액 내림차순).
   * 가운데에는 비중이 가장 큰 항목을 표시합니다.
   */
  function donut(slices, centerLabel) {
    const total = slices.reduce((a, s) => a + s.금액, 0);
    const R = 44, SW = 15;
    const C = 2 * Math.PI * R;

    if (!total) {
      return `<div class="donut-wrap">
        <svg class="donut" viewBox="0 0 120 120" role="img" aria-label="구성비 없음">
          <circle class="track" cx="60" cy="60" r="${R}" fill="none" stroke-width="${SW}"></circle>
          <text class="donut-center-label" x="60" y="63" text-anchor="middle">사용 내역 없음</text>
        </svg></div>`;
    }

    const GAP = 1.6;                       // 조각 사이 여백(둘레 단위)
    let offset = 0;
    const arcs = slices.map(s => {
      const len = (s.금액 / total) * C;
      const dash = Math.max(0.8, len - GAP);
      const arc = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${s.색}"
        stroke-width="${SW}" stroke-dasharray="${dash} ${C - dash}"
        stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)">
        <title>${esc(s.이름)} ${Math.round((s.금액 / total) * 100)}% · ${won(s.금액)}</title></circle>`;
      offset += len;
      return arc;
    }).join('');

    const top = slices[0];
    const topPct = Math.round((top.금액 / total) * 100);

    return `<div class="donut-wrap">
      <svg class="donut" viewBox="0 0 120 120" role="img"
           aria-label="목회비 세부항목 구성비, 가장 큰 항목 ${esc(top.이름)} ${topPct}퍼센트">
        <circle class="track" cx="60" cy="60" r="${R}" fill="none" stroke-width="${SW}"></circle>
        ${arcs}
        <text class="donut-center-label" x="60" y="51" text-anchor="middle">${esc(centerLabel || '최다 지출')}</text>
        <text class="donut-center-name" x="60" y="64" text-anchor="middle">${esc(top.이름)}</text>
        <text class="donut-center-pct" x="60" y="79" text-anchor="middle">${topPct}%</text>
      </svg>
    </div>`;
  }

  return {
    won, num, esc, dateLabel, pct, tone, icon, refreshIcons, statusBadges,
    toast, loading, openSheet, closeSheet, confirmSheet, readImage, gauge, fileSize,
    donut, CATEGORY_ICON, SUB_ICON
  };
})();
