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
})();