// 재고리스트 공통 처리: 일련번호 정규화, CSV 파싱, 일련번호 → 재고행 매칭
(function () {
  const norm = s => String(s ?? '').toUpperCase().replace(/[\s\-_.]/g, '').trim();

  // 일련번호 하나에서 매칭에 쓸 키들: 전체 / 끝 알파벳 제거 / 끝 숫자 7자리
  function keysOf(serial) {
    const s = norm(serial); if (!s) return [];
    const stripped = s.replace(/[A-Z]+$/, '');
    const m7 = stripped.match(/(\d{7})$/);
    const keys = [s, stripped, m7 && m7[1]].filter(Boolean);
    // 숫자만 있는 키는 앞자리 0을 뗀 형태도 등록 → 엑셀에서 0이 빠진 재고리스트(123456)와 스캔값(0123456)이 서로 매칭
    for (const k of [...keys]) if (/^\d+$/.test(k)) { const z = k.replace(/^0+/, ''); if (z) keys.push(z); }
    return [...new Set(keys)];
  }

  // 간단 CSV 파서 (따옴표/쉼표 포함 값 지원)
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  // 2차원 배열(헤더 포함) → 재고 행 배열. 헤더 이름으로 컬럼 자동 탐색
  //  - 재고 엑셀 양식: POS코드, POS그룹명, POS닉네임, 단말모델, 일련번호, 단말색상, 출고가 … (다른 컬럼은 무시)
  //  - 예전 양식(모델명, 일련번호, 출고가)도 그대로 읽힘
  function toStockRows(table) {
    const hi = table.findIndex(r => r.some(v => /모델/.test(v)) && r.some(v => /일련/.test(v)));
    if (hi < 0) throw new Error('헤더에 "단말모델(모델명)", "일련번호" 컬럼이 필요합니다');
    const h = table[hi].map(v => String(v).replace(/\s/g, ''));
    const col = (...res) => { for (const re of res) { const i = h.findIndex(v => re.test(v)); if (i >= 0) return i; } return -1; };
    const iM = col(/^단말모델$/, /모델/);
    const iS = col(/일련/);
    const iP = col(/출고가/, /가격|단가/);
    const iC = col(/^POS코드$/i, /^P코드$/i);
    const iG = col(/^POS그룹/i);
    const iN = col(/^POS닉네임/i);
    const iK = col(/색상/);
    const val = (r, i) => i >= 0 ? String(r[i] ?? '').trim() : '';
    const out = [];
    for (const r of table.slice(hi + 1)) {
      const model = val(r, iM);
      const serial = norm(r[iS]);   // 앞자리 0 빠짐(0123456→123456)은 매칭 키에서 처리
      if (!model || !serial) continue;
      const price = iP >= 0 ? Number(String(r[iP] ?? '').replace(/[^\d.-]/g, '')) || 0 : 0;
      out.push({ model, serial, price, posCode: val(r, iC), group: val(r, iG), nick: val(r, iN), color: val(r, iK) });
    }
    return out;
  }

  const csvEsc = v => /[",\n]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? '');
  // 저장용 CSV: withPrice=false 이면 공개용(출고가 제외)
  function toCSV(rows, withPrice = true) {
    const head = ['POS코드', 'POS그룹명', 'POS닉네임', '단말모델', '일련번호', '단말색상'].concat(withPrice ? ['출고가'] : []);
    const body = rows.map(r => [r.posCode, r.group, r.nick, r.model, r.serial, r.color].concat(withPrice ? [r.price] : []).map(csvEsc).join(','));
    return '\uFEFF' + head.join(',') + '\n' + body.join('\n');
  }

  // 매칭 인덱스
  function buildIndex(rows) {
    const byKey = new Map();
    for (const r of rows) for (const k of keysOf(r.serial)) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
    const models = [...new Set(rows.map(r => r.model))].sort();
    const modelPrice = new Map();
    for (const r of rows) if (r.price && !modelPrice.has(r.model)) modelPrice.set(r.model, r.price);
    return {
      rows, models, modelPrice,
      // 스캔된 일련번호 후보들로 조회: 전체 일치 우선, 없으면 7자리 일치
      find(candidates) {
        const keys = [...new Set(candidates.flatMap(keysOf))];
        const uniq = rows => [...new Map(rows.map(r => [r.model + '|' + r.serial, r])).values()];
        // 1) 영문이 섞인 전체 일련번호가 정확히 일치하면 그것만 사용
        for (const k of keys.filter(k => /[A-Z]/.test(k)).sort((a, b) => b.length - a.length)) {
          const hit = byKey.get(k); if (hit) return { rows: uniq(hit), key: k };
        }
        // 2) 숫자 일련번호(7자리·앞자리 0 제거 등)는 걸리는 행을 모두 모음 → 여러 모델이면 화면에서 선택
        const all = keys.filter(k => /^\d+$/.test(k)).flatMap(k => byKey.get(k) || []);
        return all.length ? { rows: uniq(all), key: 'num' } : { rows: [], key: null };
      }
    };
  }

  window.Stock = { norm, keysOf, parseCSV, toStockRows, toCSV, buildIndex };
})();