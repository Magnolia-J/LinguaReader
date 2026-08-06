/* =========================================================
 * LinguaReader Workspace · 浏览器 API 客户端
 * 封装对后端 REST 的调用；所有持久化（书籍/进度/笔记/统计）都走这里。
 *
 * 离线 / 纯静态部署（无后端）兜底：
 *  - 维护一份 localStorage 全量 store（key: lr_store_v1），作为「无后端时的唯一持久化」+「有后端时的缓存」。
 *  - getState/getStore：优先后端；后端不可用时回退本地；本地为空时尝试读取 snapshot.json 播种（仅首次）。
 *  - 所有增删改：先写本地（立即生效、可刷新恢复），再尽力同步后端；后端不可用时静默走本地，不弹错误。
 * ========================================================= */
const ApiClient = (function () {
  let onSaveCb = null;
  function fire(status) { if (onSaveCb) { try { onSaveCb(status); } catch (e) { /* ignore */ } } }

  /* ---------- 本地存储（localStorage）全量兜底 ---------- */
  const LS_KEY = "lr_store_v1";
  let _local = null;
  let _backendOk = true;            // 初次 getState 失败即置 false（静态部署，无后端）

  function emptyStore() {
    return {
      books: [],
      progress: {},
      kb: [],
      prefs: { enabledDicts: [], categories: [] },
      reading: { seconds: {}, byDate: {}, byBookDay: {} },
      checkins: {},
      lastBookId: null
    };
  }
  function loadLocal() {
    if (_local) return _local;
    let s = emptyStore();
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) s = Object.assign(emptyStore(), JSON.parse(raw));
    } catch (e) { /* ignore */ }
    if (!s.reading) s.reading = emptyStore().reading;
    if (!s.prefs) s.prefs = emptyStore().prefs;
    _local = s;
    return _local;
  }
  function saveLocal(s) {
    _local = s;
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* 容量满忽略 */ }
  }
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } }
  function markBackendFail() { _backendOk = false; }
  function isEmptyStore(s) {
    return (!s.books || !s.books.length) && (!s.kb || !s.kb.length) &&
      (!s.checkins || !Object.keys(s.checkins).length);
  }
  function notifyCloud() {
    if (window.CloudSync && window.CloudSync.notifyLocalChange) window.CloudSync.notifyLocalChange();
  }

  /* ---------- 原始请求（保留后端语义；不在此处做本地兜底） ---------- */
  async function req(method, url, body, extra) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    // 若用户配置过访问令牌（公网后端设了 LR_TOKEN），随请求带上，否则后端返回 401
    try {
      const tk = localStorage.getItem("lr_token");
      if (tk) opt.headers["x-lr-token"] = tk;
    } catch (e) { /* ignore */ }
    if (extra && extra.keepalive) opt.keepalive = true; // 卸载时也能送达（阅读计时结算）
    const silent = !!(extra && extra.silent);           // 静默：不触发自动保存状态提示（如周期性阅读上报）
    const mutating = method !== "GET";
    try {
      const r = await fetch(url, opt);
      if (!r.ok) {
        let m = r.statusText;
        try { const j = await r.json(); if (j && j.error) m = j.error; } catch (e) { /* ignore */ }
        if (mutating && !silent) fire("error");
        throw new Error(m || ("HTTP " + r.status));
      }
      if (r.status === 204) { if (mutating && !silent) fire("saved"); if (mutating) notifyCloud(); return null; }
      const j = await r.json();
      if (mutating && !silent) fire("saved");
      if (mutating) notifyCloud(); // 任意本地改动成功后，触发云端同步（防抖，由 sync.js 接管）
      return j;
    } catch (e) {
      if (mutating && !silent) fire("error");
      throw e;
    }
  }

  /* ---------- 本地变更 + 尽力同步后端（后端不可用时静默走本地） ----------
   * updater(s): 就地修改本地 store 并返回「对外返回值」
   * backendCall: 可选，成功后返回后端结果（优先作为返回值）
   * silent: 为 true 时不触发自动保存状态提示（如周期性阅读上报） */
  async function localThen(updater, backendCall, silent) {
    const s = loadLocal();
    const ret = updater(s);
    saveLocal(s);
    notifyCloud();
    if (_backendOk && backendCall) {
      try {
        const r = await backendCall();
        if (!silent) fire("saved");
        return (r !== undefined && r !== null) ? r : ret;
      } catch (e) {
        markBackendFail();
        if (!silent) fire("saved"); // 本地已保存成功，视为成功
        return ret;
      }
    }
    if (!silent) fire("saved");
    return ret;
  }

  return {
    /* 自动保存状态回调：设为函数 (status) => {}，status ∈ saved|error */
    setOnSave: (cb) => { onSaveCb = (typeof cb === "function") ? cb : null; },

    /* 状态 / 配置 */
    getState: async () => {
      try {
        const j = await req("GET", "/api/state");
        if (j) { saveLocal(j); _backendOk = true; }
        return j;
      } catch (e) {
        markBackendFail();
        let s = loadLocal();
        if (isEmptyStore(s)) { // 首次且无后端：尝试用内置快照播种（仅一次）
          try {
            const r = await fetch("snapshot.json", { cache: "no-store" });
            if (r && r.ok) { const snap = await r.json(); saveLocal(snap); s = snap; }
          } catch (_) { /* 无快照忽略 */ }
        }
        return clone(s);
      }
    },
    getConfig: () => req("GET", "/api/config"),
    setPrefs: (p) => localThen(
      (s) => { s.prefs = (Array.isArray(p)) ? { enabledDicts: p, categories: (s.prefs && s.prefs.categories) || [] } : Object.assign(s.prefs || {}, p); },
      () => req("PUT", "/api/prefs", { enabledDicts: (Array.isArray(p) ? p : (p && p.enabledDicts) || []) }),
      true
    ),

    /* 整体读写（云端同步 pull / push 用） */
    getStore: async () => {
      try {
        const j = await req("GET", "/api/store");
        if (j) { saveLocal(j); _backendOk = true; }
        return j;
      } catch (e) {
        markBackendFail();
        return clone(loadLocal());
      }
    },
    putStore: (store) => localThen(
      (s) => { Object.assign(s, store); },
      () => req("PUT", "/api/store", store),
      true
    ),

    /* 书籍 */
    addBook: (b) => localThen(
      (s) => { const i = s.books.findIndex((x) => x.id === b.id); if (i >= 0) s.books[i] = b; else s.books.push(b); return b; },
      () => req("POST", "/api/books", b)
    ),
    updateBook: (id, patch) => localThen(
      (s) => { const x = s.books.find((b) => b.id === id); if (x) Object.assign(x, patch); return patch; },
      () => req("PUT", "/api/books/" + encodeURIComponent(id), patch)
    ),
    setProgress: (id, chapter) => localThen(
      (s) => { s.progress[id] = chapter; },
      () => req("PUT", "/api/books/" + encodeURIComponent(id) + "/progress", { chapter }),
      true
    ),
    setLastBook: (id) => localThen(
      (s) => { s.lastBookId = id; },
      () => req("PUT", "/api/lastbook", { id }),
      true
    ),
    deleteBook: (id) => localThen(
      (s) => { s.books = s.books.filter((b) => b.id !== id); },
      () => req("DELETE", "/api/books/" + encodeURIComponent(id)),
      true
    ),

    /* 阅读统计 / 打卡 */
    // 活跃页面用普通 fetch（可靠）；仅页面卸载/hidden 时才用 keepalive；silent 避免每 10s 闪一次按钮
    reportReading: (bookId, seconds, useKeepAlive) => localThen(
      (s) => { s.reading.seconds[bookId] = (s.reading.seconds[bookId] || 0) + seconds; },
      () => req("PUT", "/api/reading", { bookId, seconds }, useKeepAlive ? { keepalive: true, silent: true } : { silent: true }),
      true
    ),
    checkIn: (date) => localThen(
      (s) => { s.checkins[date] = true; },
      () => req("POST", "/api/checkin", { date }),
      true
    ),

    /* 知识库（笔记/收藏） */
    getKb: () => clone(loadLocal().kb),
    addKb: (e) => localThen(
      (s) => { const i = s.kb.findIndex((x) => x.id === e.id); if (i >= 0) s.kb[i] = e; else s.kb.push(e); return e; },
      () => req("POST", "/api/kb", e)
    ),
    updateKb: (id, patch) => localThen(
      (s) => { const x = s.kb.find((k) => k.id === id); if (x) Object.assign(x, patch); return patch; },
      () => req("PUT", "/api/kb/" + encodeURIComponent(id), patch)
    ),
    deleteKb: (id) => localThen(
      (s) => { s.kb = s.kb.filter((k) => k.id !== id); },
      () => req("DELETE", "/api/kb/" + encodeURIComponent(id)),
      true
    ),
    clearKb: () => localThen(
      (s) => { s.kb = []; },
      () => req("DELETE", "/api/kb"),
      true
    ),

    /* AI（依赖后端 LLM，纯静态部署无此能力，调用会失败——属预期）
     * 把用户在界面里填的 LLM 配置（本机 localStorage）随请求交给后端，
     * 后端优先用之、缺省再回落服务端 .env。密钥只在本机 localhost 传输，
     * 不进入代码仓库，别人下载后只能用他们自己的密钥。 */
    analyze: (p) => req("POST", "/api/analyze", Object.assign({}, p, { llm: window.LLM_CONFIG || {} })),
    annotate: (bookId) => req("POST", "/api/annotate", { bookId, llm: window.LLM_CONFIG || {} })
  };
})();

/* 显式挂到 window：app.js 多处用 `window.ApiClient` 判空；而 const 全局词法绑定默认不会成为 window 的属性，
 * 导致 window.ApiClient 为 undefined → 阅读计时不上报、续读/自动保存失效。统一在此挂载即可。 */
if (typeof window !== "undefined") window.ApiClient = ApiClient;
