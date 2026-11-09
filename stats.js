// 재고조사 통계: 기준재고 × 현재재고 × 조사입력 비교 + 그룹별 집계 + 드릴다운 화면
(function () {
  // ---------- 지역 그룹 (POS그룹명 → 지역) ----------
  const REGION_DEF = [
    ['부산', ['여상식', '강슬기', '정준호', '나재철', '공진석', '강숭교', '전라도', '부산팀']],
    ['울산', ['전하영', '이기형', '신진호', '배웅', '울산팀']],
    ['경남', ['한성철', '김현중', '유승열', '경남팀']],
    ['경주포항', ['손병현', '김시우', '경북팀']],
    ['대구', ['최승형', '구본석', '김민우', '대구팀']],
    ['구미', ['이남협', '박유경', '구미팀']],
    ['소매', ['소매']],
    ['관리', ['박기용', '관리팀']],
  ];
  const REGIONS = REGION_DEF.map(r => r[0]).concat('기타');
  const memberRegion = new Map();
  REGION_DEF.forEach(([r, ms]) => ms.forEach(m => memberRegion.set(m, r)));
  const regionOf = g => memberRegion.get(String(g || '').trim()) || '기타';

  // ---------- 비교 키: 단말모델 + 일련번호 ----------
  const N = s => Stock.norm(s);
  const canon = s => { const n = N(s); return /^\d+$/.test(n) ? (n.replace(/^0+/, '') || '0') : n; };  // 숫자는 앞자리 0 무시
  const key = (m, s) => N(m) + '|' + canon(s);
  const storeId = r => r.posCode || r.nick;

  // 조사 전송 문서 → 입력 목록 (같은 일련번호는 마지막 입력만)
  function entriesFromDocs(docs) {   // docs: 최신순
    const out = [], seen = new Set(); let dup = 0;
    for (const d of docs) {
      let its = []; try { its = JSON.parse(d.items || '[]'); } catch (e) {}
      for (const x of its) {
        const k = N(x.s); if (!k) continue;
        if (seen.has(k)) { dup++; continue; }
        seen.add(k);
        out.push({ pcode: d.pcode, store: d.pcode === '영업사원' ? `${d.store} (영업사원)` : d.store,
                   model: x.m || '', serial: x.s || '', serialRaw: x.r || x.s || '', matched: !!x.k, at: d.$createdAt });
      }
    }
    return { entries: out, dup };
  }

  // ---------- 핵심 비교 ----------
  // 상태: done=조사완료 / sold=판매(현재재고에 없음) / moved=이관(현재재고에서 다른 판매점) / todo=조사미완료
  function compute(base, cur, entries) {
    const baseMap = new Map(), bySerial = new Map();
    for (const b of base) {
      baseMap.set(key(b.model, b.serial), b);
      const c = canon(b.serial); if (!bySerial.has(c)) bySerial.set(c, []); bySerial.get(c).push(b);
    }
    // 조사 입력 → 기준재고 행 매칭 (모델+일련번호, 모델 미확인 입력은 일련번호가 유일할 때만)
    const surveyed = new Map();
    const candsOf = s => [...new Set([...new Set(Stock.keysOf(s).map(canon))].flatMap(c => bySerial.get(c) || []))];
    for (const e of entries) {
      let cands = candsOf(e.serial);
      if (!cands.length && e.serialRaw) cands = candsOf(e.serialRaw);
      if (!cands.length) continue;
      const em = e.model ? e.model.split(' / ').map(N) : [];
      let hit = em.length ? cands.filter(b => em.includes(N(b.model))) : [];
      if (!hit.length && !em.length && cands.length === 1) hit = cands;
      for (const b of hit) { const k = key(b.model, b.serial); if (!surveyed.has(k)) surveyed.set(k, e); }
    }
    const curMap = new Map(); if (cur) for (const c of cur) curMap.set(key(c.model, c.serial), c);
    const items = base.map(b => {
      const k = key(b.model, b.serial), c = cur ? (curMap.get(k) || null) : b, sv = surveyed.get(k) || null;
      const status = sv ? 'done' : !c ? 'sold' : storeId(c) !== storeId(b) ? 'moved' : 'todo';
      return { b, c, sv, status };
    });
    // 이관입고: 기준재고엔 A판매점, 현재재고엔 B판매점 → B 쪽에 +1
    const incoming = [];
    if (cur) for (const c of cur) {
      const k = key(c.model, c.serial), b = baseMap.get(k);
      if (b && storeId(b) !== storeId(c)) incoming.push({ b, c, sv: surveyed.get(k) || null });
    }
    return { items, incoming, hasCur: !!cur, surveyedCount: surveyed.size };
  }

  // ---------- 집계 ----------
  const empty = () => ({ base: 0, done: 0, sold: 0, moved: 0, todo: 0, incIn: 0, incTodo: 0 });
  function aggregate(res, level, filter = () => true) {
    const kf = { region: r => regionOf(r.group), group: r => r.group || '(미지정)', store: r => storeId(r) }[level];
    const map = new Map(), names = new Map();
    const get = k => { if (!map.has(k)) map.set(k, empty()); return map.get(k); };
    for (const it of res.items) {
      if (!filter(it.b)) continue;
      const k = kf(it.b), a = get(k); names.set(k, it.b.nick || k);
      a.base++; a[it.status]++;
    }
    for (const x of res.incoming) {
      if (!filter(x.c)) continue;
      const k = kf(x.c), a = get(k); names.set(k, names.get(k) || x.c.nick || k);
      a.incIn++; if (!x.sv) a.incTodo++;
    }
    return { map, names };
  }
  const sum = list => list.reduce((t, a) => { for (const k in t) t[k] += a[k] || 0; return t; }, empty());

  // 판매점(POS코드)별 조사 미완료 목록: 아직 그 판매점에 있는 미조사 + 이관입고 미조사
  function todoList(res, sid) {
    const rows = res.items.filter(it => it.status === 'todo' && storeId(it.b) === sid)
      .map(it => ({ r: it.c || it.b, tag: '' }));
    for (const x of res.incoming) if (!x.sv && storeId(x.c) === sid) rows.push({ r: x.c, tag: '이관입고', from: x.b.nick });
    return rows;
  }

  // ---------- 드릴다운 화면 ----------
  const css = `
  .st-crumb{font-size:13px;color:#9aa3b2;margin:2px 0 10px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .st-crumb a{color:#60a5fa;cursor:pointer}
  .st-tbl{width:100%;border-collapse:collapse;font-size:13px}
  .st-tbl th,.st-tbl td{padding:8px 5px;border-bottom:1px solid #2a2f3a;text-align:right;white-space:nowrap}
  .st-tbl th{color:#9aa3b2;font-weight:600;font-size:12px}
  .st-tbl th:first-child,.st-tbl td:first-child{text-align:left;white-space:normal}
  .st-tbl tr.go{cursor:pointer} .st-tbl tr.go:active td,.st-tbl tr.go:hover td{background:#222733}
  .st-tbl tr.me td{background:rgba(16,185,129,.10)}
  .st-tbl tr.tot td{font-weight:800;border-top:2px solid #3a4150}
  .st-tbl .done{color:#22c55e} .st-tbl .gone{color:#9aa3b2} .st-tbl .todo{color:#f59e0b;font-weight:700}
  .st-tbl small{display:block;color:#60a5fa;font-size:11px;font-weight:400}
  .st-bar{height:5px;background:#2a2f3a;border-radius:3px;margin-top:3px;overflow:hidden}
  .st-bar i{display:block;height:100%;background:#22c55e}
  .st-list td{text-align:left!important;white-space:normal!important;font-size:13px}
  .st-list .mono{font-family:ui-monospace,Menlo,Consolas,monospace}
  .st-tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:6px;background:rgba(59,130,246,.18);color:#60a5fa;margin-left:4px}
  .st-note{font-size:12px;color:#9aa3b2;margin-top:8px;line-height:1.5}
  .st-empty{color:#9aa3b2;padding:14px 0;text-align:center}`;
  function injectCss() { if (document.getElementById('st-css')) return; const s = document.createElement('style'); s.id = 'st-css'; s.textContent = css; document.head.appendChild(s); }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = v => (v || 0).toLocaleString();
  // 삼성은 라벨처럼 7자리로 표시 (엑셀에서 빠진 앞자리 0 복원)
  const showSerial = r => /^SM-/i.test(r.model) && /^\d{1,6}$/.test(r.serial) ? r.serial.padStart(7, '0') : r.serial;
  const pct = a => { const t = a.done + a.todo + a.incTodo; return t ? Math.round(a.done / t * 100) : (a.base ? 100 : 0); };

  // path: [{level:'all'}, {level:'region', v}, {level:'group', v}, {level:'store', v, name}]
  function mount(el, res, opts = {}) {
    injectCss();
    const minDepth = opts.minDepth || 0;      // 이보다 위로는 못 올라감 (영업사원 화면)
    let path = opts.path || [{ level: 'all' }];
    const highlight = opts.highlight || '';
    const draw = () => {
      const cur = path[path.length - 1];
      const crumb = path.map((p, i) => {
        const label = p.level === 'all' ? '전체' : p.level === 'store' ? (p.name || p.v) : p.v;
        return i < path.length - 1 && i >= minDepth ? `<a data-up="${i}">${esc(label)}</a> ›` : `<b>${esc(label)}</b>${i < path.length - 1 ? ' ›' : ''}`;
      }).slice(minDepth).join(' ');
      let html = `<div class="st-crumb">${crumb}</div>`;
      if (cur.level === 'store') html += listHtml(cur.v);
      else html += tableHtml(cur);
      if (!res.hasCur) html += `<div class="st-note">※ 현재재고가 등록되지 않아 판매(이관)완료는 0으로 표시됩니다.</div>`;
      el.innerHTML = html;
      el.querySelectorAll('[data-up]').forEach(a => a.onclick = () => { path = path.slice(0, +a.dataset.up + 1); draw(); });
      el.querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => {
        const next = { all: 'region', region: 'group', group: 'store' }[cur.level];
        path = path.concat({ level: next, v: tr.dataset.k, name: tr.dataset.name });
        draw(); el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    };
    const tableHtml = cur => {
      const childLevel = { all: 'region', region: 'group', group: 'store' }[cur.level];
      const filter = cur.level === 'all' ? () => true
        : cur.level === 'region' ? r => regionOf(r.group) === cur.v
        : r => (r.group || '(미지정)') === cur.v;
      const { map, names } = aggregate(res, childLevel, filter);
      let keys = [...map.keys()];
      if (childLevel === 'region') keys = REGIONS.filter(r => map.has(r));
      else keys.sort((a, b) => (map.get(b).base - map.get(a).base) || String(names.get(a)).localeCompare(names.get(b)));
      if (!keys.length) return '<div class="st-empty">해당하는 재고가 없습니다</div>';
      const label = { region: '지역', group: 'POS그룹', store: 'POS닉네임' }[childLevel];
      const row = (k, a, cls = '') => `<tr class="${cls}" ${cls.includes('tot') ? '' : `data-k="${esc(k)}" data-name="${esc(names.get(k))}"`}>
        <td>${esc(childLevel === 'store' && !cls.includes('tot') ? names.get(k) : k)}${a.incIn ? `<small>이관입고 +${n(a.incIn)}</small>` : ''}
          <div class="st-bar"><i style="width:${pct(a)}%"></i></div></td>
        <td>${n(a.base)}</td><td class="done">${n(a.done)}</td><td class="gone">${n(a.sold + a.moved)}</td><td class="todo">${n(a.todo + a.incTodo)}</td><td>${pct(a)}%</td></tr>`;
      const tot = sum(keys.map(k => map.get(k)));
      return `<table class="st-tbl"><thead><tr><th>${label}</th><th>기준재고</th><th>조사완료</th><th>판매(이관)</th><th>미완료</th><th>진행률</th></tr></thead><tbody>
        ${row('합계', tot, 'tot')}
        ${keys.map(k => row(k, map.get(k), 'go' + (highlight && (k === highlight) ? ' me' : ''))).join('')}
      </tbody></table>
      <div class="st-note">· 판매(이관): 기준재고에 있었는데 현재재고에 없거나(판매) 다른 판매점으로 옮겨진(이관) 건<br>
      · 이관입고 +N: 다른 판매점에서 옮겨 온 건 — 미완료에 포함되어 이 판매점에서 조사합니다<br>· 행을 누르면 하위 목록으로 이동합니다</div>`;
    };
    const listHtml = sid => {
      const rows = todoList(res, sid);
      const a = aggregate(res, 'store', r => storeId(r) === sid).map.get(sid) || empty();
      const head = `<div class="st-note" style="margin:0 0 8px">기준재고 ${n(a.base)} · 조사완료 <b style="color:#22c55e">${n(a.done)}</b> · 판매(이관) ${n(a.sold + a.moved)} · <b style="color:#f59e0b">미완료 ${n(rows.length)}</b></div>`;
      if (!rows.length) return head + '<div class="st-empty">조사 미완료 재고가 없습니다</div>';
      rows.sort((x, y) => x.r.model.localeCompare(y.r.model) || canon(x.r.serial).localeCompare(canon(y.r.serial)));
      return head + `<table class="st-tbl st-list"><thead><tr><th>POS닉네임</th><th>단말모델</th><th>일련번호</th><th>색상</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td>${esc(x.r.nick)}${x.tag ? `<span class="st-tag">${x.tag}${x.from ? ' ← ' + esc(x.from) : ''}</span>` : ''}</td><td>${esc(x.r.model)}</td><td class="mono">${esc(showSerial(x.r))}</td><td>${esc(x.r.color)}</td></tr>`).join('')}
      </tbody></table>`;
    };
    draw();
    return { setPath: p => { path = p; draw(); } };
  }

  window.Stats = { REGIONS, REGION_DEF, regionOf, key, canon, storeId, entriesFromDocs, compute, aggregate, todoList, mount };
})();