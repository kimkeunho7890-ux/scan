// 재고리스트 공통 처리: 일련번호 정규화, CSV 파싱, 일련번호 → 재고행 매칭
(function () {
  const norm = s => String(s ?? '').toUpperCase().replace(/[\s\-_.]/g, '').trim();

  // 일련번호 하나에서 매칭에 쓸 키들: 전체 / 끝 알파벳 제거 / 끝 숫자 7자리
  function keysOf(serial) {
    const s = norm(serial); if (!s) return [];
    const stripped = s.replace(/[A-Z]+$/, '');
    const m7 = stripped.match(/(\d{7})$/);
    return [...new Set([s, stripped, m7 && m7[1]].filter(Boolean))];
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

  // 2차원 배열(헤더 포함) → [{model, serial, price}] ; 헤더 이름으로 컬럼 자동 탐색
  function toStockRows(table) {
    const hi = table.findIndex(r => r.some(v => /모델/.test(v)) && r.some(v => /일련/.test(v)));
    if (hi < 0) throw new Error('헤더에 "모델명", "일련번호" 컬럼이 필요합니다');
    const h = table[hi].map(v => String(v).trim());
    const iM = h.findIndex(v => /모델/.test(v));
    const iS = h.findIndex(v => /일련/.test(v));
    const iP = h.findIndex(v => /출고가|가격|단가/.test(v));
    const out = [];
    for (const r of table.slice(hi + 1)) {
      const model = String(r[iM] ?? '').trim();
      const serial = norm(r[iS]);
      if (!model || !serial) continue;
      const price = iP >= 0 ? Number(String(r[iP] ?? '').replace(/[^\d.-]/g, '')) || 0 : 0;
      out.push({ model, serial, price });
    }
    return out;
  }

  function toCSV(rows) {
    const esc = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
    return '﻿모델명,일련번호,출고가\n' + rows.map(r => [r.model, r.serial, r.price].map(esc).join(',')).join('\n');
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
        keys.sort((a, b) => b.length - a.length);           // 긴(정확한) 키 먼저
        for (const k of keys) {
          const hit = byKey.get(k);
          if (hit) {
            const uniq = [...new Map(hit.map(r => [r.model + '|' + r.serial, r])).values()];
            return { rows: uniq, key: k };
          }
        }
        return { rows: [], key: null };
      }
    };
  }

  window.Stock = { norm, keysOf, parseCSV, toStockRows, toCSV, buildIndex };
})();