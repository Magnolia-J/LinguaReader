/* =========================================================
 * LinguaReader Workspace · 云端同步（Supabase）
 *
 * 设计：
 *  - 整包同步：把本地 store.json 作为 jsonb 存到 Supabase 的 kb_store 表（一行/用户）。
 *  - 冲突策略：按 id 并集合并（books/kb），reading 取 max，last-write-wins 在单条级别。
 *    任一端改动 → 先拉云端 → 与本地合并 → 推回云端；有多端新增时写回本地并重渲染。
 *    这样多设备不会互相覆盖，也不会丢数据。
 *  - 安全：仅用公开的 publishable key + 行级安全（RLS，auth.uid() = user_id）。
 * ========================================================= */
(function () {
  const POLL_MS = 60000;          // 轮询间隔：60s 拉一次云端
  const PUSH_DEBOUNCE_MS = 4000;  // 本地改动后 4s 防抖再同步

  let _client = null;
  let _uid = null;
  let _email = "";
  let _applyingRemote = false;    // 正在写回远端数据时，抑制本地变更触发的回环
  let _pushTimer = null;
  let _pollTimer = null;

  function cfg() { return window.SUPABASE_CONFIG || {}; }

  function getClient() {
    if (_client) return _client;
    const c = cfg();
    if (!c.URL || !c.ANON_KEY) { console.warn("[cloud] 未配置 Supabase"); return null; }
    if (!window.supabase || !window.supabase.createClient) { console.warn("[cloud] Supabase JS 未加载（可能离线）"); return null; }
    try {
      _client = window.supabase.createClient(c.URL, c.ANON_KEY);
      return _client;
    } catch (e) {
      console.error("[cloud] 创建客户端失败：", e);
      return null;
    }
  }

  function isConfigured() {
    const c = cfg();
    return !!(c.URL && c.ANON_KEY && window.supabase && window.supabase.createClient);
  }

  /* ---------- 合并策略（按 id 并集；reading 取 max） ---------- */
  function mergeById(a, b) {
    const map = new Map();
    (a || []).forEach((x) => { if (x && x.id) map.set(x.id, x); });
    (b || []).forEach((x) => { if (x && x.id) map.set(x.id, x); }); // 远端较新，覆盖同 id
    return Array.from(map.values());
  }
  function mergeReading(local, remote) {
    const out = JSON.parse(JSON.stringify(remote || { seconds: {}, byDate: {}, byBookDay: {} }));
    const ls = local || {};
    const mergeMax = (dst, src) => { for (const k in (src || {})) dst[k] = Math.max(dst[k] || 0, src[k] || 0); };
    mergeMax(out.seconds, ls.seconds);
    mergeMax(out.byDate, ls.byDate);
    out.byBookDay = out.byBookDay || {};
    for (const d in (ls.byBookDay || {})) {
      out.byBookDay[d] = out.byBookDay[d] || {};
      for (const b in (ls.byBookDay[d] || {})) out.byBookDay[d][b] = Math.max(out.byBookDay[d][b] || 0, ls.byBookDay[d][b] || 0);
    }
    return out;
  }
  function mergeStore(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    // 已删除书籍清单（tombstone）：本地与云端取并集，合并后的书籍必须排除这些 id，
    // 否则「本地删除 + 云端仍保留」会在并集合并时把书复活。
    const del = new Set([...(local.deletedBookIds || []), ...(remote.deletedBookIds || [])].map(String));
    const filt = (arr) => (arr || []).filter((b) => b && b.id && !del.has(String(b.id)));
    return {
      books: filt(mergeById(local.books, remote.books)),
      progress: Object.assign({}, remote.progress, local.progress),
      kb: mergeById(local.kb, remote.kb),
      prefs: remote.prefs || local.prefs,
      reading: mergeReading(local.reading, remote.reading),
      checkins: Object.assign({}, remote.checkins, local.checkins),
      lastBookId: remote.lastBookId || local.lastBookId,
      deletedBookIds: [...del]
    };
  }

  /* ---------- 同步往返 ---------- */
  async function syncRoundtrip(opts) {
    opts = opts || {};
    const client = getClient();
    if (!client || !_uid) return false;
    try {
      const local = await ApiClient.getStore();
      let remote = null;
      try {
        const { data, error } = await client.from("kb_store").select("payload").eq("user_id", _uid).maybeSingle();
        if (error) throw error;
        remote = data && data.payload;
      } catch (e) {
        console.warn("[cloud] 读取云端失败，仅本地：", e.message);
      }
      const merged = mergeStore(local, remote);
      // —— 调试日志：记录本地 / 云端 / 合并后的书籍与笔记数量，以及调用栈 ——
      console.log("[LR-DBG][sync] roundtrip local.books=" + ((local.books || []).length) +
        " remote.books=" + ((remote && remote.books || []).length) +
        " merged.books=" + ((merged.books || []).length) +
        " remote.deletedBookIds=" + JSON.stringify(remote && remote.deletedBookIds || []) +
        " | " + (new Error().stack || "").split("\n").slice(2, 5).join(" <- "));

      // —— 根因护栏：云端合并结果若把本地好书清空（如云端 deletedBookIds 被污染 / books 为空），
      // 绝不能写回本地、也不能触发 onCloudDataApplied（那会经 reloadFromServer→syncFromState 把 BOOKS 清空）。
      // 书库数据以「本地 + 服务端文件」为准，云端只作为增量补充，绝不反向清空。
      const localBooks = (local.books || []).length;
      const mergedBooks = (merged.books || []).length;
      if (mergedBooks === 0 && localBooks > 0) {
        console.warn("[LR-DBG][sync] 拒绝写回：合并后 books 为空但本地有 " + localBooks + " 本，疑似云端 tombstone/空载荷污染，已跳过 putStore 与 onCloudDataApplied");
        return true; // 视为本次同步无操作，不覆盖本地好书
      }

      await client.from("kb_store").upsert({ user_id: _uid, payload: merged, updated_at: new Date().toISOString() });

      const localCount = (local.kb || []).length + (local.books || []).length;
      const mergedCount = (merged.kb || []).length + (merged.books || []).length;
      if (mergedCount > localCount) {
        _applyingRemote = true;
        try { await ApiClient.putStore(merged); } finally { _applyingRemote = false; }
        if (window.onCloudDataApplied) window.onCloudDataApplied();
        if (opts.silent !== true) toast("☁ 已从云端合并新数据", "success");
      }
      return true;
    } catch (e) {
      console.error("[cloud] 同步失败：", e);
      if (opts.silent !== true) toast("⚠ 云端同步失败：" + (e.message || "网络错误"), "error");
      return false;
    }
  }

  function schedulePush() {
    if (_applyingRemote || !_uid || !isConfigured()) return;
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => syncRoundtrip({ silent: true }), PUSH_DEBOUNCE_MS);
  }
  function notifyLocalChange() { schedulePush(); }

  function startPolling() {
    clearInterval(_pollTimer);
    _pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") syncRoundtrip({ silent: true });
    }, POLL_MS);
  }
  function stopPolling() { clearInterval(_pollTimer); _pollTimer = null; }

  /* ---------- 认证 ---------- */
  async function signUp(email, password) {
    const client = getClient();
    if (!client) { toast("⚠ Supabase 未连接", "error"); return { ok: false }; }
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) { toast("⚠ 注册失败：" + error.message, "error"); return { ok: false }; }
    if (data.user && data.session) {
      _uid = data.user.id; _email = email;
      await syncRoundtrip(); startPolling(); showSynced();
      toast("✓ 注册成功，已同步到云端", "success");
      return { ok: true };
    }
    if (data.user && !data.session) {
      toast("📧 注册成功，请到邮箱点击验证链接后再登录", "success");
      return { ok: true, needConfirm: true };
    }
    return { ok: false };
  }

  async function signIn(email, password) {
    const client = getClient();
    if (!client) { toast("⚠ Supabase 未连接", "error"); return { ok: false }; }
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) { toast("⚠ 登录失败：" + error.message, "error"); return { ok: false }; }
    _uid = data.user.id; _email = email;
    await syncRoundtrip(); startPolling(); showSynced();
    toast("✓ 登录成功，已与云端同步", "success");
    return { ok: true };
  }

  async function signOut() {
    const client = getClient();
    if (client) { try { await client.auth.signOut(); } catch (e) { /* ignore */ } }
    _uid = null; _email = "";
    stopPolling(); showLoggedOut();
    toast("已退出云同步（本地数据保留）", "info");
  }

  async function restoreSession() {
    const client = getClient();
    if (!client) return false;
    try {
      const { data } = await client.auth.getSession();
      if (data && data.session && data.session.user) {
        _uid = data.session.user.id;
        _email = (data.session.user.email) || "";
        await syncRoundtrip(); startPolling(); showSynced();
        return true;
      }
    } catch (e) { console.warn("[cloud] 恢复 session 失败：", e.message); }
    return false;
  }

  /* ---------- UI ---------- */
  function toast(msg, kind) {
    if (window.showToast) window.showToast(msg, kind);
    else console.log("[cloud]", msg);
  }
  function el(id) { return document.getElementById(id); }

  function showSynced() {
    const b = el("cloud-btn");
    if (b) { b.textContent = "☁ 已同步"; b.classList.add("synced"); }
    const li = el("cloud-logged-in"), lo = el("cloud-logged-out");
    if (li && lo) { li.classList.remove("hidden"); lo.classList.add("hidden"); }
    if (el("cloud-user")) el("cloud-user").textContent = _email || "(已登录)";
  }
  function showLoggedOut() {
    const b = el("cloud-btn");
    if (b) { b.textContent = "☁ 云同步"; b.classList.remove("synced"); }
    const li = el("cloud-logged-in"), lo = el("cloud-logged-out");
    if (li && lo) { li.classList.add("hidden"); lo.classList.remove("hidden"); }
  }
  function openCloudModal() {
    const m = el("cloud-modal");
    if (!m) return;
    if (_uid) showSynced(); else showLoggedOut();
    m.classList.remove("hidden");
  }
  function closeCloudModal() { const m = el("cloud-modal"); if (m) m.classList.add("hidden"); }

  function bindUI() {
    const b = el("cloud-btn");
    if (b) b.addEventListener("click", openCloudModal);
    const close = document.querySelector("[data-close-cloud]");
    if (close) close.addEventListener("click", closeCloudModal);

    const signin = el("cloud-signin"), signup = el("cloud-signup"),
          signout = el("cloud-signout"), syncNow = el("cloud-sync-now");
    if (signin) signin.addEventListener("click", async () => {
      const email = (el("cloud-email") || {}).value || "";
      const pass = (el("cloud-pass") || {}).value || "";
      if (!email || pass.length < 6) { toast("请输入邮箱与至少 6 位密码", "error"); return; }
      await signIn(email, pass);
      if (!el("cloud-logged-in").classList.contains("hidden")) closeCloudModal();
    });
    if (signup) signup.addEventListener("click", async () => {
      const email = (el("cloud-email") || {}).value || "";
      const pass = (el("cloud-pass") || {}).value || "";
      if (!email || pass.length < 6) { toast("请输入邮箱与至少 6 位密码", "error"); return; }
      await signUp(email, pass);
    });
    if (signout) signout.addEventListener("click", async () => { await signOut(); closeCloudModal(); });
    if (syncNow) syncNow.addEventListener("click", async () => {
      toast("正在同步…", "info");
      await syncRoundtrip({ silent: true });
      toast("✓ 已同步", "success");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUI);
  else bindUI();

  /* 对外暴露 */
  window.CloudSync = {
    isConfigured,
    getClient,
    notifyLocalChange,
    syncNow: (opts) => syncRoundtrip(opts),
    restoreSession,
    signIn,
    signUp,
    signOut
  };
})();
