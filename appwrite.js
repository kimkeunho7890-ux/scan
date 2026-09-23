<<<<<<< Updated upstream:appwrite.js
// Appwrite REST 경량 클라이언트 (SDK 버전-서버 버전 불일치 문제를 피하려고 fetch로 직접 호출)
// 다른 도메인(github.io)에서 접속해도 로그인이 유지되도록 X-Fallback-Cookies 방식을 사용
(function () {
  const C = window.APP_CONFIG;
  const FB_KEY = 'aw_fallback_' + C.projectId;

  function headers(json = true) {
    const h = { 'X-Appwrite-Project': C.projectId };
    if (json) h['Content-Type'] = 'application/json';
    try { const fb = localStorage.getItem(FB_KEY); if (fb) h['X-Fallback-Cookies'] = fb; } catch (e) {}
    return h;
  }

  async function call(method, path, body, { raw = false, form = false } = {}) {
    const res = await fetch(C.endpoint + path, {
      method,
      headers: headers(!form),
      credentials: 'include',
      body: body == null ? undefined : (form ? body : JSON.stringify(body))
    });
    const fb = res.headers.get('X-Fallback-Cookies');
    if (fb) { try { localStorage.setItem(FB_KEY, fb); } catch (e) {} }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); msg = j.message || msg; } catch (e) {}
      const err = new Error(msg); err.code = res.status; throw err;
    }
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  const q = (method, attribute, values) =>
    JSON.stringify(Object.assign({ method }, attribute ? { attribute } : {}, values ? { values } : {}));
  const qs = arr => arr.map(x => 'queries[]=' + encodeURIComponent(x)).join('&');

  window.AW = {
    // 인증
    login: (email, password) => call('POST', '/account/sessions/email', { email, password }),
    logout: async () => { try { await call('DELETE', '/account/sessions/current'); } catch (e) {}
                          try { localStorage.removeItem(FB_KEY); } catch (e) {} },
    me: () => call('GET', '/account'),

    // 스토리지
    fileMeta: (bucket, id) => call('GET', `/storage/buckets/${bucket}/files/${id}`),
    fileText: async (bucket, id) => {
      const res = await call('GET', `/storage/buckets/${bucket}/files/${id}/download`, null, { raw: true });
      return new TextDecoder('utf-8').decode(await res.arrayBuffer()).replace(/^﻿/, '');
    },
    deleteFile: (bucket, id) => call('DELETE', `/storage/buckets/${bucket}/files/${id}`),
    uploadFile: (bucket, id, blob, name) => {
      const fd = new FormData();
      fd.append('fileId', id);
      fd.append('file', blob, name);
      return call('POST', `/storage/buckets/${bucket}/files`, fd, { form: true });
    },

    // DB
    createDoc: (db, col, data) =>
      call('POST', `/databases/${db}/collections/${col}/documents`, { documentId: 'unique()', data }),
    listDocs: (db, col, queries = []) =>
      call('GET', `/databases/${db}/collections/${col}/documents?` + qs(queries)),
    Q: {
      equal: (a, v) => q('equal', a, Array.isArray(v) ? v : [v]),
      orderDesc: a => q('orderDesc', a),
      limit: n => q('limit', null, [n])
    }
  };
=======
// Appwrite REST 경량 클라이언트 (SDK 버전-서버 버전 불일치 문제를 피하려고 fetch로 직접 호출)
// 다른 도메인(github.io)에서 접속해도 로그인이 유지되도록 X-Fallback-Cookies 방식을 사용
(function () {
  const C = window.APP_CONFIG;
  const FB_KEY = 'aw_fallback_' + C.projectId;

  function headers(json = true) {
    const h = { 'X-Appwrite-Project': C.projectId };
    if (json) h['Content-Type'] = 'application/json';
    try { const fb = localStorage.getItem(FB_KEY); if (fb) h['X-Fallback-Cookies'] = fb; } catch (e) {}
    return h;
  }

  async function call(method, path, body, { raw = false, form = false } = {}) {
    const res = await fetch(C.endpoint + path, {
      method,
      headers: headers(!form),
      credentials: 'include',
      body: body == null ? undefined : (form ? body : JSON.stringify(body))
    });
    const fb = res.headers.get('X-Fallback-Cookies');
    if (fb) { try { localStorage.setItem(FB_KEY, fb); } catch (e) {} }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText, type = '';
      try { const j = await res.json(); msg = j.message || msg; type = j.type || ''; } catch (e) {}
      const err = new Error(msg); err.code = res.status; err.type = type; throw err;
    }
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  const q = (method, attribute, values) =>
    JSON.stringify(Object.assign({ method }, attribute ? { attribute } : {}, values ? { values } : {}));
  const qs = arr => arr.map(x => 'queries[]=' + encodeURIComponent(x)).join('&');

  window.AW = {
    // 인증
    // 로그인: 이미 세션이 있으면 정리 후 재시도, 성공 후 세션이 실제로 유지되는지까지 확인
    login: async (email, password) => {
      const create = () => call('POST', '/account/sessions/email', { email, password });
      try { await create(); }
      catch (e) {
        if (e.type === 'user_session_already_exists') {
          try { await call('DELETE', '/account/sessions/current'); } catch (_) {}
          await create();
        } else if (e.type === 'user_invalid_credentials') {
          throw new Error(`이메일 또는 비밀번호가 틀립니다. ('${C.projectId}' 프로젝트의 Auth > Users 계정인지 확인 — Appwrite 콘솔 로그인 계정과는 별개입니다)`);
        } else if (e.type === 'user_blocked') {
          throw new Error('차단된 계정입니다 (Auth > Users에서 상태 확인)');
        } else if (e.code === 429) {
          throw new Error('로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요');
        } else if (e.message === 'Failed to fetch') {
          throw new Error('서버 연결 실패 (Appwrite Platforms에 이 사이트 주소가 등록됐는지 확인)');
        } else throw e;
      }
      try { return await call('GET', '/account'); }
      catch (e) { throw new Error('로그인은 됐지만 세션이 유지되지 않습니다 (브라우저 쿠키 차단 여부 확인): ' + e.message); }
    },
    logout: async () => { try { await call('DELETE', '/account/sessions/current'); } catch (e) {}
                          try { localStorage.removeItem(FB_KEY); } catch (e) {} },
    me: () => call('GET', '/account'),

    // 스토리지
    fileMeta: (bucket, id) => call('GET', `/storage/buckets/${bucket}/files/${id}`),
    fileText: async (bucket, id) => {
      const res = await call('GET', `/storage/buckets/${bucket}/files/${id}/download`, null, { raw: true });
      return new TextDecoder('utf-8').decode(await res.arrayBuffer()).replace(/^﻿/, '');
    },
    deleteFile: (bucket, id) => call('DELETE', `/storage/buckets/${bucket}/files/${id}`),
    uploadFile: (bucket, id, blob, name) => {
      const fd = new FormData();
      fd.append('fileId', id);
      fd.append('file', blob, name);
      return call('POST', `/storage/buckets/${bucket}/files`, fd, { form: true });
    },

    // DB
    createDoc: (db, col, data) =>
      call('POST', `/databases/${db}/collections/${col}/documents`, { documentId: 'unique()', data }),
    listDocs: (db, col, queries = []) =>
      call('GET', `/databases/${db}/collections/${col}/documents?` + qs(queries)),
    Q: {
      equal: (a, v) => q('equal', a, Array.isArray(v) ? v : [v]),
      orderDesc: a => q('orderDesc', a),
      limit: n => q('limit', null, [n])
    }
  };
>>>>>>> Stashed changes:Appwrite.js
})();