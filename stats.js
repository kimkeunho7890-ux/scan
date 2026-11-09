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
        out.push({ pcode: d.pcode, staff: d.pcode === '영업사원' ? d.store : '', store: d.pcode === '영업사원' ? `${d.store} (영업사원)` : d.store,
                   model: x.m || '', serial: x.s || '', serialRaw: x.r || x.s || '', matched: !!x.k, at: d.$createdAt });
      }
    }
    return { entries: out, dup };
  }

  // ---------- 핵심 비교 ----------
  // 상태: done=입력완료(조사됨) / sold=개통완료(현재재고에 없음) / todo=미완료
  // 이관(현재재고에서 다른 판매점·영업사원): 단말은 아직 우리 재고 → 현재 위치(B)로 기준재고를 옮기고 B에서 조사해야 완료
  //   단, 옮기기 전에 원래 판매점(A)에서 이미 조사한 건은 A의 입력완료로 둠
  function compute(base, cur, entries) {
    const bySerial = new Map();
    for (const b of base) { const c = canon(b.serial); if (!bySerial.has(c)) bySerial.set(c, []); bySerial.get(c).push(b); }
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
      // 이관: 판매점(P코드)이 바뀌었거나, 같은 P코드라도 담당 영업사원(POS그룹명)이 바뀐 경우
      const moved = !!(c && (storeId(c) !== storeId(b) || (c.group || '') !== (b.group || '')));
      // 원래 판매점에서 조사된 입력인지 (그 판매점 P코드로 입력했거나, 담당 영업사원 이름으로 입력)
      const svAtBase = !!(sv && (sv.pcode === b.posCode || (sv.staff && sv.staff === b.group)));
      const owner = moved && !svAtBase ? c : b;            // 통계에 잡히는 판매점
      const status = sv ? 'done' : !c ? 'sold' : 'todo';
      return { b, c, sv, status, moved, owner };
    });
    return { items, hasCur: !!cur, surveyedCount: surveyed.size };
  }

  // ---------- 집계 ----------
  // base0=원래 기준재고, out=이관출고, in=이관입고, base=조정 기준재고(=base0-out+in), done/sold/todo 는 조정 기준
  const empty = () => ({ base0: 0, out: 0, in: 0, base: 0, done: 0, sold: 0, todo: 0 });
  function aggregate(res, level, filter = () => true) {
    const kf = { region: r => regionOf(r.group), group: r => r.group || '(미지정)', store: r => storeId(r) }[level];
    const map = new Map(), names = new Map();
    const get = (k, r) => { if (!map.has(k)) map.set(k, empty()); if (!names.has(k)) names.set(k, r.nick || k); return map.get(k); };
    for (const it of res.items) {
      const fb = filter(it.b), fo = filter(it.owner);
      const kb = fb ? kf(it.b) : null, ko = fo ? kf(it.owner) : null;
      if (fb) get(kb, it.b).base0++;
      if (fo) { const a = get(ko, it.owner); a.base++; a[it.status]++; }
      if (it.owner !== it.b) {                            // 보고 있는 범위 밖으로 나갔거나 다른 행으로 옮겨진 경우만 출고/입고
        if (fb && (!fo || kb !== ko)) get(kb, it.b).out++;
        if (fo && (!fb || kb !== ko)) get(ko, it.owner).in++;
      }
    }
    return { map, names };
  }
  const sum = list => list.reduce((t, a) => { for (const k in t) t[k] += a[k] || 0; return t; }, empty());

  // 판매점(POS코드)별 미완료 목록: 지금 그 판매점에 있는 미조사 단말 (이관입고 표시 포함)
  // group 을 주면 그 담당(POS그룹명) 소속으로 집계된 것만 (같은 P코드가 두 담당에 걸친 경우 구분)
  function todoList(res, sid, group) {
    return res.items.filter(it => it.status === 'todo' && storeId(it.owner) === sid && (group == null || (it.owner.group || '(미지정)') === group))
      .map(it => { const mv = it.owner !== it.b; return { r: it.c || it.b, tag: mv ? '이관입고' : '', from: mv ? `${it.b.nick}${it.b.group !== it.owner.group ? ' / ' + it.b.group : ''}` : '' }; });
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
  const pct = a => a.base ? Math.round((a.done + a.sold) / a.base * 100) : 0;   // 진행률 = (입력완료+개통완료) / 조정 기준재고

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
      if (cur.level === 'store') { const par = path[path.length - 2]; html += listHtml(cur.v, par && par.level === 'group' ? par.v : null); }
      else html += tableHtml(cur);
      if (!res.hasCur) html += `<div class="st-note">※ 현재재고가 등록되지 않아 개통완료·이관은 반영되지 않았습니다.</div>`;
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
        <td>${esc(childLevel === 'store' && !cls.includes('tot') ? names.get(k) : k)}${(a.out || a.in) ? `<small>원래 ${n(a.base0)}${a.out ? ` · 이관출고 −${n(a.out)}` : ''}${a.in ? ` · 이관입고 +${n(a.in)}` : ''}</small>` : ''}
          <div class="st-bar"><i style="width:${pct(a)}%"></i></div></td>
        <td>${n(a.base)}</td><td class="done">${n(a.done)}</td><td class="gone">${n(a.sold)}</td><td class="todo">${n(a.todo)}</td><td>${pct(a)}%</td></tr>`;
      const tot = sum(keys.map(k => map.get(k)));
      return `<table class="st-tbl"><thead><tr><th>${label}</th><th>기준재고</th><th>입력완료</th><th>개통완료</th><th>미완료</th><th>진행률</th></tr></thead><tbody>
        ${row('합계', tot, 'tot')}
        ${keys.map(k => row(k, map.get(k), 'go' + (highlight && (k === highlight) ? ' me' : ''))).join('')}
      </tbody></table>
      <div class="st-note">· 기준재고: 이관을 반영한 조정 수량 (다른 판매점으로 옮겨진 미조사 단말은 옮겨 간 곳에서 조사)<br>
      · 개통완료: 기준재고에 있었는데 현재재고에 없는 단말 · 진행률 = (입력완료+개통완료) ÷ 기준재고<br>· 행을 누르면 하위 목록으로 이동합니다</div>`;
    };
    const listHtml = (sid, group) => {
      const rows = todoList(res, sid, group);
      const a = aggregate(res, 'store', r => storeId(r) === sid && (group == null || (r.group || '(미지정)') === group)).map.get(sid) || empty();
      const head = `<div class="st-note" style="margin:0 0 8px">기준재고 ${n(a.base)}${(a.out || a.in) ? ` (원래 ${n(a.base0)}${a.out ? ' −' + n(a.out) : ''}${a.in ? ' +' + n(a.in) : ''})` : ''} · 입력완료 <b style="color:#22c55e">${n(a.done)}</b> · 개통완료 ${n(a.sold)} · <b style="color:#f59e0b">미완료 ${n(rows.length)}</b></div>`;
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