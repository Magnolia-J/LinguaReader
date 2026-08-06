/* =========================================================
 * LinguaReader Workspace · 主控逻辑
 * 串联：书库切换 → 阅读 → 划线 → AI 分析 → 收藏 → 导出
 * ========================================================= */

let currentBookId = null;
let currentChapter = 0;
let currentAnalysis = null;     // 当前 AI 分析结果
let currentSource = null;       // 来源信息 {book, author, page}
let selectedTags = [];          // 当前待收藏标签
let libSearch = "";             // 书库搜索关键字
let libCategory = "all";        // 书库当前分类（"all" 表示全部）
let DELETED_BOOK_IDS = new Set(); // 已删除书籍清单（tombstone）：服务端返回，渲染/合并都须跳过
let READING = { seconds: {}, byDate: {}, byBookDay: {} };  // 阅读时长（每书 / 每日 / 每日每书）
let CHECKINS = {};              // 阅读打卡（日期 -> true）
let readingStartTs = 0;         // 当前书本阅读会话起点
let readingPending = 0;         // 已累计但尚未上报的秒数
let readingTimer = null;        // 计时器句柄
let readingPaused = false;      // 空闲超过阈值 → 暂停计时
let lastActivityTs = 0;         // 最后一次「阅读动作」（交互）时间戳
const READING_IDLE_LIMIT_MS = 15 * 60 * 1000; // 同页停留超 15 分钟无操作 → 暂停计时

/* 词典偏好：可勾选在界面中显示哪些词典 */
const DICT_OPTIONS = [
  { key: "Le Robert", group: "法语" },
  { key: "Larousse", group: "法语" },
  { key: "CNRTL", group: "法语" },
  { key: "Oxford Dictionary", group: "英语" }
];
let USER_PREFS = { enabledDicts: DICT_OPTIONS.map(d => d.key), categories: [] };

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
/* AI 面板里的词典释义：按偏好过滤（立即生效，无需重跑 LLM） */
function renderDefsHtml(defs) {
  const ds = (typeof filterDefs === "function" ? filterDefs(defs) : defs) || [];
  if (!ds.length) return `<div class="ai-muted">（已隐藏全部词典，可在 ⚙ 词典偏好 中开启）</div>`;
  return ds.map(d => `<div class="ai-def"><b>${escHtml(d.dict)}</b>：${escHtml(d.text || "")}</div>`).join("");
}

/* ---------- 初始化（从后端加载） ---------- */
async function init() {
  let state = null;
  try {
    state = await ApiClient.getState();
    syncFromState(state);
  } catch (e) {
    showBackendError();
    // 静态部署 / 后端不可用时，尝试从内置快照恢复数据（不影响本地有后端的正常使用）
    try {
      const snap = await fetch("snapshot.json", { cache: "no-store" });
      if (snap && snap.ok) { state = await snap.json(); syncFromState(state); }
    } catch (_) { /* 无快照则保持空白，不阻塞界面 */ }
    // 不 return：即使后端不可用，也继续加载本地备份，避免完全空白（退出重进至少能看到离线数据）
  }
  // 无论后端是否在线，都加载本地兜底（在线时会自动补传后端），杜绝「退出重进数据清空」
  reconcileUserBooks();
  reconcileKB();
  renderBookList();
  renderCategoryChips();
  renderStats();
  renderKB("all");
  bindEvents();
  // 显示 AI 在线状态（综合考虑：本机界面配置 + 服务端 .env 兜底）
  refreshAIStatus();
  setupAutoSave();
  // 续读：优先打开「上次阅读的书」，否则打开第一本（state 可能为 null，需守卫）
  const lastId = (state && state.lastBookId && BOOKS.some(b => b.id === state.lastBookId)) ? state.lastBookId : (BOOKS[0] && BOOKS[0].id);
  if (lastId) selectBook(lastId);

  // 云端同步：已配置 Supabase 时，恢复已有登录会话并拉取云端数据（异步、不阻塞渲染）
  if (window.CloudSync && window.CloudSync.isConfigured()) {
    window.CloudSync.restoreSession().catch((e) => console.warn("[cloud] 恢复会话失败：", e && e.message));
  }
  // 远端数据写回本地后，重新渲染界面（不重置当前阅读进度/计时器）
  window.onCloudDataApplied = reloadFromServer;

  setupMobileTabs();
  registerServiceWorker();
}

/* 云端数据写回本地后，从后端重新拉取并渲染（不重置当前阅读与计时器） */
async function reloadFromServer() {
  try {
    const state = await ApiClient.getState();
    syncFromState(state);
    reconcileUserBooks();
    reconcileKB();
    renderBookList();
    renderCategoryChips();
    renderStats();
    const filterEl = document.getElementById("kb-filter");
    renderKB(filterEl ? filterEl.value : "all");
    updateBookTimes();
    updateLiveTimer();
  } catch (e) { /* 后端不可用时忽略，保留内存状态 */ }
}

/* ---------- 自动保存指示器（可点击：立即保存当前阅读进度） ---------- */
let _autosaveTimer = null;
function setupAutoSave() {
  const el = document.getElementById("autosave-status");
  if (!el) return;
  if (window.ApiClient && typeof ApiClient.setOnSave === "function") {
    ApiClient.setOnSave((status) => {
      if (status === "saved") {
        el.textContent = "✓ 已自动保存";
        el.className = "autosave-status saved";
        clearTimeout(_autosaveTimer);
        _autosaveTimer = setTimeout(() => {
          el.textContent = "💾 自动保存";
          el.className = "autosave-status";
        }, 2200);
      } else if (status === "error") {
        el.textContent = "⚠ 保存失败（服务未连接）";
        el.className = "autosave-status error";
        clearTimeout(_autosaveTimer);
        _autosaveTimer = setTimeout(() => {
          el.textContent = "💾 自动保存";
          el.className = "autosave-status";
        }, 3000);
      }
    });
  }
  // 点击：真正结算并上报阅读时长（手动兜底），成功后弹出「保存成功」提示
  el.addEventListener("click", async () => {
    el.textContent = "💾 保存中…";
    el.className = "autosave-status saving";
    let ok = true;
    if (readingPending > 0 && currentBookId) {
      ok = await flushReading().catch(() => false);   // 有未结算时长 → 真正上报
    } else if (window.ApiClient) {
      ok = await ApiClient.getState().then(() => true).catch(() => false); // 无新增时长 → 确认服务在线
    } else {
      ok = false;
    }
    if (ok) {
      el.textContent = "✓ 已保存";
      el.className = "autosave-status saved";
      showToast("✓ 保存成功，阅读进度已记录", "success");
    } else {
      el.textContent = "⚠ 保存失败";
      el.className = "autosave-status error";
      showToast("⚠ 保存失败：无法连接本地服务", "error");
    }
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
      el.textContent = "💾 自动保存";
      el.className = "autosave-status";
    }, ok ? 1800 : 3000);
  });
}

/* 轻量提示 toast（保存成功 / 失败等） */
let _toastTimer = null;
function showToast(msg, type) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast toast-" + (type || "info");
  void el.offsetWidth;          // 强制重排以重启出现动画
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

/* 用后端状态同步内存中的书籍 / 进度 / 知识库（就地修改，兼容 const 声明） */
function syncFromState(state) {
  // 已删除书籍清单（tombstone）：服务端返回，所有渲染/合并都要跳过，确保删除永久生效
  DELETED_BOOK_IDS = new Set((state.deletedBookIds || []).map(String));
  // 快照前端示例书籍的分类（含新加的 category 字段），用于回填已持久化但缺字段的旧数据
  const seedCat = {};
  BOOKS.forEach(b => { if (b.category) seedCat[b.id] = b.category; });
  if (Array.isArray(state.books)) {
    // 注意：此处不再用 DELETED_BOOK_IDS 过滤显示。已删除的书由服务端在 /api/state
    // 返回时就已移出 books；tombstone 只用于「文件夹扫描 / 云端合并」防复活，
    // 若拿它来过滤显示，一旦云端 deletedBookIds 被污染就会把正常书籍也藏掉。
    BOOKS.length = 0;
    state.books.forEach((b) => {
      if (!b.category && seedCat[b.id]) b.category = seedCat[b.id];
      BOOKS.push(b);
    });
  }
  if (state.progress) {
    Object.keys(BOOK_PROGRESS).forEach((k) => delete BOOK_PROGRESS[k]);
    Object.assign(BOOK_PROGRESS, state.progress);
  }
  if (Array.isArray(state.kb)) loadKB(state.kb);
  if (state.prefs && Array.isArray(state.prefs.enabledDicts)) {
    USER_PREFS = {
      enabledDicts: state.prefs.enabledDicts,
      categories: Array.isArray(state.prefs.categories) ? state.prefs.categories : []
    };
  }
  if (state.reading && typeof state.reading === "object") {
    READING = {
      seconds: state.reading.seconds || {},
      byDate: state.reading.byDate || {},
      byBookDay: state.reading.byBookDay || {}
    };
  }
  if (state.checkins && typeof state.checkins === "object") CHECKINS = state.checkins;
  if (typeof setEnabledDicts === "function") setEnabledDicts(USER_PREFS.enabledDicts);
}

function showBackendError() {
  document.getElementById("reading-area").innerHTML =
    `<div class="backend-error">
      <h3>⚠ 无法连接后端服务</h3>
      <p>本工作台已从本地存储改为<strong>后端持久化</strong>。请先在本项目目录启动服务：</p>
      <pre>node server.js</pre>
      <p>然后刷新页面（访问 <code>http://localhost:3007/</code>）。</p>
      <p class="be-hint">（你之前离线添加的书籍已从浏览器本地缓存恢复，可在联网后自动同步。）</p>
    </div>`;
  // 即使连不上后端，也把浏览器本地备份的用户书恢复出来，避免刷新即丢失
  reconcileUserBooks();
  renderBookList();
  renderCategoryChips();
}

/* ---------- 浏览器本地备份（localStorage） ----------
 * 作为后端不可用时的兜底：上传的书会同时写到这里，刷新不会丢；
 * 联网后 init 会自动把缺失的备份书补传到后端。 */
const USERBOOKS_LS_KEY = "lr_userbooks_v1";

function backupUserBook(book) {
  try {
    const arr = loadUserBooksBackup();
    const i = arr.findIndex((b) => b.id === book.id);
    if (i >= 0) arr[i] = book; else arr.push(book);
    localStorage.setItem(USERBOOKS_LS_KEY, JSON.stringify(arr));
  } catch (e) { /* 容量满等忽略 */ }
}
function removeUserBookBackup(id) {
  try {
    const arr = loadUserBooksBackup().filter((b) => b.id !== id);
    localStorage.setItem(USERBOOKS_LS_KEY, JSON.stringify(arr));
  } catch (e) {}
}
function loadUserBooksBackup() {
  try {
    const raw = localStorage.getItem(USERBOOKS_LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveUserBooksBackup(arr) {
  try { localStorage.setItem(USERBOOKS_LS_KEY, JSON.stringify(Array.isArray(arr) ? arr : [])); } catch (e) { /* 容量满忽略 */ }
}

/* 把本地备份里、服务端没有的书并入内存，并（在联网时）补传到后端。
 * 关键：已删除清单中的书绝不重新加入（否则删除会「复活」）。 */
function reconcileUserBooks() {
  const backup = loadUserBooksBackup().filter((b) => b && !DELETED_BOOK_IDS.has(String(b.id)));
  if (!backup.length) {
    // 顺手清理备份里残留的已删除书
    const raw = loadUserBooksBackup();
    if (raw.some((b) => b && DELETED_BOOK_IDS.has(String(b.id)))) {
      saveUserBooksBackup(raw.filter((b) => b && !DELETED_BOOK_IDS.has(String(b.id))));
    }
    return;
  }
  const have = new Set(BOOKS.map((b) => b.id));
  const toUpload = [];
  backup.forEach((b) => {
    if (!have.has(b.id) && !DELETED_BOOK_IDS.has(String(b.id))) {
      BOOKS.push(b);
      BOOK_PROGRESS[b.id] = BOOK_PROGRESS[b.id] || 0;
      have.add(b.id);
      toUpload.push(b);
    }
  });
  // 仅在确实连着后端时补传（init 已成功拿到 state 才会调用本函数）
  toUpload.forEach((b) => {
    if (window.ApiClient) {
      ApiClient.addBook(b).then(() => removeUserBookBackup(b.id)).catch(() => {});
    }
  });
}

/* ---------- 书库 ---------- */
function bookCategory(b) {
  return b.category || (b.language === "fr" ? "Français" : "English");
}

/* 所有可用分类 = 书库已有分类 ∪ 用户自定义分类 */
function getCategories() {
  const set = new Set();
  BOOKS.forEach(b => set.add(bookCategory(b)));
  (USER_PREFS.categories || []).forEach(c => set.add(c));
  return [...set].sort();
}

/* 时长格式化：秒 → 紧凑文本 */
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60), rm = m % 60;
  return h + "h" + (rm ? " " + rm + "m" : "");
}

function renderBookList() {
  const el = document.getElementById("book-list");
  const q = libSearch.trim().toLowerCase();
  const filtered = BOOKS.filter(b => {
    const matchCat = libCategory === "all" || bookCategory(b) === libCategory;
    const matchQ = !q || b.title.toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if (!filtered.length) {
    el.innerHTML = `<div class="lib-empty">未找到匹配的书籍</div>`;
    return;
  }

  const cats = getCategories();
  el.innerHTML = filtered.map(b => {
    const prog = Math.round(((BOOK_PROGRESS[b.id] || 0) + 1) / b.chapters.length * 100);
    const secs = READING.seconds[b.id] || 0;
    const opts = cats.map(c => `<option value="${escHtml(c)}" ${c === bookCategory(b) ? "selected" : ""}>${escHtml(c)}</option>`).join("");
    return `<div class="book-card ${b.id === currentBookId ? "active" : ""}" data-id="${b.id}">
      <button class="bc-remove" data-id="${b.id}" title="从书架移除" aria-label="移除">✕</button>
      <div class="bc-title">${b.title}</div>
      <div class="bc-author">${b.author}</div>
      <div class="bc-meta-row">
        <span class="bc-lang">${b.language === "fr" ? "Français" : "English"}</span>
        <span class="bc-time" data-bid="${b.id}">⏱ ${fmtDur(secs)}</span>
      </div>
      <select class="bc-cat-select" data-id="${b.id}" title="修改分类">${opts}</select>
      <div class="bc-progress"><i style="width:${prog}%"></i></div>
    </div>`;
  }).join("");
}

/* 从书架移除一本书（仅移书；已收藏到知识库的内容是按书名字段冗余存储的，不受牵连） */
function removeBookFromShelf(id) {
  const book = BOOKS.find(b => b.id === id);
  if (!book) return;
  if (!confirm(`确定把《${book.title}》从书架移除吗？\n（仅移除书架，已收藏的知识库内容会保留）`)) return;
  // 1) 后端 + 本地存储删除（localThen 会写回 localStorage，离线也持久）
  if (window.ApiClient) ApiClient.deleteBook(id).catch(() => {});
  // 2) 内存：移除书籍 + 进度
  const i = BOOKS.findIndex(b => b.id === id);
  if (i >= 0) BOOKS.splice(i, 1);
  delete BOOK_PROGRESS[id];
  // 3) 记入已删除清单 + 清掉用户书本地备份，避免离线 reconcile / 云端合并把它重新加回来
  DELETED_BOOK_IDS.add(String(id));
  removeUserBookBackup(id);
  // 4) 若正在读这本书，安全重置阅读区
  if (currentBookId === id) {
    flushReading();
    currentBookId = null;
    currentChapter = 0;
    const area = document.getElementById("reading-area");
    if (area) area.innerHTML = `<div class="backend-error" style="border:none;padding:34px 12px"><p>请选择一本书开始阅读。</p></div>`;
    const bt = document.getElementById("book-title");
    const bm = document.getElementById("book-meta");
    const rs = document.getElementById("reading-status");
    if (bt) bt.textContent = "未选择书籍";
    if (bm) bm.textContent = "";
    if (rs) rs.textContent = "请先在书库选择一本书";
    updateLiveTimer();
  }
  // 5) 重渲染
  renderCategoryChips();
  renderBookList();
}

/* ---------- 删除重复书籍 ---------- */
/* 归一化书名/作者，用于判定「同一本书」 */
function normKey(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function bookDupKey(b) {
  return normKey(b.title) + " || " + normKey(b.author);
}
/* 找出所有「书名+作者」重复的组（每组多于 1 本） */
function findDuplicateGroups() {
  const map = new Map();
  BOOKS.forEach(b => {
    const k = bookDupKey(b);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(b);
  });
  return [...map.values()].filter(g => g.length > 1);
}
/* 在重复组内挑选「保留本」：阅读进度（章节 + 时长）最多者优先 */
function pickKeeper(group) {
  const score = b => (BOOK_PROGRESS[b.id] || 0) * 1000 + (READING.seconds[b.id] || 0);
  return [...group].sort((a, b) => score(b) - score(a))[0];
}
/* 静默删除一本书（删除接口持久化 + 内存 + 本地备份；不弹确认、不重置阅读区） */
function deleteBookSilently(id) {
  if (window.ApiClient) ApiClient.deleteBook(id).catch(() => {});
  const i = BOOKS.findIndex(b => b.id === id);
  if (i >= 0) BOOKS.splice(i, 1);
  delete BOOK_PROGRESS[id];
  DELETED_BOOK_IDS.add(String(id));
  removeUserBookBackup(id);
}
/* 主入口：扫描重复 → 弹窗列出将删除项 → 确认后保留每组一本、删除其余 */
function removeDuplicates() {
  const groups = findDuplicateGroups();
  if (!groups.length) {
    showToast("✓ 没有发现重复书籍", "success");
    return;
  }
  const removable = groups.reduce((s, g) => s + g.length - 1, 0);
  const detail = groups.map(g => {
    const keeper = pickKeeper(g);
    const others = g.filter(b => b.id !== keeper.id);
    return `• 《${g[0].title}》 ${g[0].author || ""}：共 ${g.length} 本，保留《${keeper.title}》，删除 ${others.length} 本`;
  }).join("\n");
  if (!confirm(`检测到 ${groups.length} 组重复书籍，将删除 ${removable} 本冗余：\n\n${detail}\n\n确定执行？`)) return;
  groups.forEach(g => {
    const keeper = pickKeeper(g);
    g.filter(b => b.id !== keeper.id).forEach(b => {
      if (b.id === currentBookId) {
        currentBookId = keeper.id;
        selectBook(keeper.id);
      }
      deleteBookSilently(b.id);
    });
  });
  renderCategoryChips();
  renderBookList();
  showToast(`🧹 已删除 ${removable} 本重复书籍`, "success");
}

/* 分类标签：动态生成（含「全部」+「＋ 自定义」） */
function renderCategoryChips() {
  const el = document.getElementById("lib-cats");
  if (!el) return;
  const arr = ["all", ...getCategories()];
  el.innerHTML = arr.map(c => {
    const label = c === "all" ? "全部" : c;
    const on = c === libCategory ? " on" : "";
    return `<button class="lib-cat${on}" data-cat="${escHtml(c)}">${escHtml(label)}</button>`;
  }).join("") + `<button class="lib-cat lib-cat-add" id="lib-cat-add" title="新建自定义分类">＋ 自定义</button>`;
  el.querySelectorAll(".lib-cat[data-cat]").forEach(btn => btn.addEventListener("click", () => {
    libCategory = btn.dataset.cat;
    renderCategoryChips();
    renderBookList();
  }));
  const addBtn = document.getElementById("lib-cat-add");
  if (addBtn) addBtn.addEventListener("click", openAddCategory);
}

/* 新建自定义分类（内联输入） */
function openAddCategory() {
  const el = document.getElementById("lib-cats");
  if (!el) return;
  el.innerHTML = `<input id="lib-cat-input" class="lib-cat-input" type="text" placeholder="输入新分类名…" maxlength="24">`;
  const inp = document.getElementById("lib-cat-input");
  inp.focus();
  const commit = () => {
    const name = inp.value.trim();
    if (name) addCustomCategory(name);
    renderCategoryChips();
  };
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") renderCategoryChips();
  });
  inp.addEventListener("blur", commit);
}

function addCustomCategory(name) {
  if (!(USER_PREFS.categories || []).includes(name)) {
    USER_PREFS.categories.push(name);
    if (window.ApiClient) ApiClient.setPrefs(USER_PREFS).catch(() => {});
  }
  // 若有当前书籍，自动把新分类赋给它（可随时在卡片下拉中更改）
  const book = BOOKS.find(b => b.id === currentBookId);
  if (book) {
    book.category = name;
    if (window.ApiClient) ApiClient.updateBook(book.id, { category: name }).catch(() => {});
  }
  renderBookList();
  renderStats();
  flash("已新建分类：" + name + (book ? "（已应用到《" + book.title + "》）" : ""));
}

/* 本地日期 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/* ---------- 阅读时长 + 打卡 ---------- */
function startReadingTimer() {
  readingStartTs = Date.now();
  readingPending = 0;
  readingPaused = false;
  lastActivityTs = Date.now();
  if (!readingTimer) readingTimer = setInterval(tickReading, 1000); // 每秒 tick：实时显示计时
  updateLiveTimer();
}

/* 当前某本书的「实时」已读秒数 = 已结算 + 尚未结算的 pending + 当前这一秒的零头 */
function liveSeconds(id) {
  let s = READING.seconds[id] || 0;
  if (id === currentBookId && document.visibilityState === "visible" && readingTimer) {
    const tail = readingPaused ? 0 : Math.floor((Date.now() - readingStartTs) / 1000);
    s += readingPending + tail;
  }
  return s;
}

/* 任何「阅读动作」（滚动 / 点击 / 键盘 / 触摸）都刷新活跃时间；若已暂停则恢复计时 */
function onReadingActivity() {
  const now = Date.now();
  lastActivityTs = now;
  if (readingPaused) {
    readingPaused = false;
    readingStartTs = now; // 从这次动作起继续计时
  }
}

function tickReading() {
  if (document.visibilityState !== "visible" || !currentBookId) return;
  const now = Date.now();
  const idleMs = now - lastActivityTs;
  if (idleMs >= READING_IDLE_LIMIT_MS) {
    // 同页停留超 15 分钟无操作 → 暂停：仅结算到「最后一次活跃时刻」为止的有效时长，并冻结起点
    if (!readingPaused) {
      const validDelta = Math.max(0, Math.floor((lastActivityTs - readingStartTs) / 1000));
      if (validDelta > 0) readingPending += validDelta;
      readingStartTs = lastActivityTs; // 冻结：恢复前不再把空闲时间计入
      readingPaused = true;
    }
    if (readingPending >= 10) flushReading(); // 仍把已结算时长上报
    updateBookTimes();
    updateLiveTimer();
    return;
  }
  // 活跃：正常累计
  const delta = Math.floor((now - readingStartTs) / 1000);
  if (delta >= 1) { readingPending += delta; readingStartTs = now; }
  if (readingPending >= 10) flushReading(); // 每累计 10s 才上报后端一次（减少请求）；显示仍每秒更新
  updateBookTimes();
  updateLiveTimer();
  autoCheckIn(); // 当日有效阅读满 1 分钟 → 自动打卡
}

/* 把未结算的 pending 计入内存统计，并重置计时起点（避免重复累计） */
function commitReading() {
  if (readingPending > 0 && currentBookId) {
    const secs = readingPending;
    const t = todayStr();
    READING.seconds[currentBookId] = (READING.seconds[currentBookId] || 0) + secs;
    READING.byDate[t] = (READING.byDate[t] || 0) + secs;
    READING.byBookDay[t] = READING.byBookDay[t] || {};
    READING.byBookDay[t][currentBookId] = (READING.byBookDay[t][currentBookId] || 0) + secs;
    readingPending = 0;
    readingStartTs = Date.now();
    return secs;
  }
  return 0;
}

/* 结算并上报阅读时长；返回 Promise<boolean>（true=上报成功） */
function flushReading() {
  if (!currentBookId || readingPending <= 0 || !window.ApiClient) return Promise.resolve(false);
  const secs = readingPending;
  const unloading = document.visibilityState !== "visible";
  commitReading();           // 先把秒数计入内存（即便上报失败也不丢）
  renderStats();
  updateBookTimes();
  updateLiveTimer();
  return ApiClient.reportReading(currentBookId, secs, unloading)
    .then(() => true)
    .catch(() => false);
}

/* 书卡上的实时时长（含当前未结算秒数） */
function updateBookTimes() {
  document.querySelectorAll(".bc-time").forEach(span => {
    const id = span.dataset.bid;
    span.textContent = "⏱ " + fmtDur(liveSeconds(id));
  });
}

/* 顶栏实时计时器 + 今日/总时长（实时、含未结算秒数） */
function updateLiveTimer() {
  const liveEl = document.getElementById("reading-timer");
  if (liveEl) {
    if (currentBookId) {
      liveEl.textContent = (readingPaused ? "⏸ " : "⏱ ") + fmtClock(liveSeconds(currentBookId));
      liveEl.title = readingPaused ? "已暂停计时（超过 15 分钟无阅读操作，有操作即恢复）" : "";
      liveEl.classList.remove("hidden");
    } else {
      liveEl.classList.add("hidden");
    }
  }
  const visible = document.visibilityState === "visible" && !!currentBookId;
  const tail = (visible && !readingPaused) ? Math.floor((Date.now() - readingStartTs) / 1000) : 0;
  const add = visible ? readingPending + tail : 0;
  const tEl = document.getElementById("ts-total");
  if (tEl) {
    const total = Object.values(READING.seconds).reduce((a, b) => a + b, 0) + add;
    tEl.textContent = fmtDur(total);
  }
  const dEl = document.getElementById("ts-today");
  if (dEl) dEl.textContent = fmtDur((READING.byDate[todayStr()] || 0) + add);
}

/* 秒 → MM:SS（超过 1 小时显示 H:MM:SS），用于顶栏实时计时器 */
function fmtClock(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? h + ":" + p(m) + ":" + p(s) : p(m) + ":" + p(s);
}

/* 连续打卡天数（以今天或昨天为起点向后数） */
function computeStreak() {
  let streak = 0;
  const p = (n) => String(n).padStart(2, "0");
  const fmt = (x) => x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
  const cursor = new Date();
  if (!CHECKINS[fmt(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (CHECKINS[fmt(cursor)]) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

function renderStats() {
  const total = Object.values(READING.seconds).reduce((a, b) => a + b, 0);
  const today = READING.byDate[todayStr()] || 0;
  const tEl = document.getElementById("ts-total");
  const dEl = document.getElementById("ts-today");
  const sEl = document.getElementById("ts-streak");
  if (tEl) tEl.textContent = fmtDur(total);
  if (dEl) dEl.textContent = fmtDur(today);
  if (sEl) sEl.textContent = computeStreak() + " 天";
  const ci = document.getElementById("ts-checkin");
  if (ci) ci.classList.toggle("done", !!CHECKINS[todayStr()]);
}

/* 自动打卡：当日有效阅读时长累计超过 1 分钟即视为打卡成功（无需手动点） */
const CHECKIN_AUTO_SECONDS = 60;
function autoCheckIn() {
  const today = todayStr();
  if (CHECKINS[today]) return; // 今日已打卡则不再触发
  const live = (READING.byDate[today] || 0) + readingPending; // 含当前未结算的有效秒数
  if (live >= CHECKIN_AUTO_SECONDS) doCheckIn();
}

async function doCheckIn() {
  const today = todayStr();
  if (CHECKINS[today]) return;
  try {
    await ApiClient.checkIn(today);
    CHECKINS[today] = true;
    renderStats();
    flash("打卡成功 🔥 连续 " + computeStreak() + " 天");
  } catch (e) {
    flash("打卡失败：" + e.message);
  }
}

function selectBook(id) {
  const book = BOOKS.find(b => b.id === id);
  if (!book) return;
  flushReading();                 // 先结算上一本书的时长
  currentBookId = id;
  currentChapter = BOOK_PROGRESS[id] || 0;
  // 记住「上次阅读的书」，重开时续读（先结算再记，避免记到刚切走的书）
  if (window.ApiClient) ApiClient.setLastBook(id).catch(() => {});
  renderBookList();
  renderChapterSelect(book);
  renderReadingArea(book, currentChapter);
  document.getElementById("book-title").textContent = book.title;
  document.getElementById("book-meta").textContent =
    `${book.author} · ${book.publish.year} · ${book.language === "fr" ? "法文" : "英文"}`;
  document.getElementById("reading-status").textContent = `正在阅读：${book.title}`;
  // 重置 AI 面板
  resetAIPanel();
  startReadingTimer();            // 开启本书阅读计时会话
  // 移动端：打开书后自动切到「阅读」标签，体验更顺
  if (document.getElementById("bottom-tabs") && getComputedStyle(document.getElementById("bottom-tabs")).display !== "none") {
    document.body.setAttribute("data-tab", "reading");
    document.querySelectorAll("#bottom-tabs .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "reading"));
  }
}

function renderChapterSelect(book) {
  const sel = document.getElementById("chapter-select");
  sel.innerHTML = book.chapters.map((c, i) => `<option value="${i}">${c.title}</option>`).join("");
  sel.value = currentChapter;
}

function renderReadingArea(book, idx) {
  const chap = book.chapters[idx];
  const area = document.getElementById("reading-area");
  let html = `<div class="chapter-head" style="font-weight:700;margin-bottom:10px">${chap.title}</div>`;
  html += chap.paragraphs.map(p => `<p>${p}</p>`).join("");
  html += `<div class="page-mark">${chap.pages}</div>`;
  area.innerHTML = html;
}

/* ---------- 章节导航 ---------- */
function gotoChapter(delta) {
  const book = BOOKS.find(b => b.id === currentBookId);
  if (!book) return;
  let i = currentChapter + delta;
  i = Math.max(0, Math.min(book.chapters.length - 1, i));
  currentChapter = i;
  BOOK_PROGRESS[book.id] = i;
  if (window.ApiClient) ApiClient.setProgress(book.id, i).catch(() => {});
  renderChapterSelect(book);
  renderReadingArea(book, i);
}

/* ---------- 划线选择 ---------- */
function bindEvents() {
  // 书库点击（忽略分类下拉与移除按钮，避免误触切换）
  document.getElementById("book-list").addEventListener("click", e => {
    const rm = e.target.closest(".bc-remove");
    if (rm) { removeBookFromShelf(rm.dataset.id); return; }
    if (e.target.closest(".bc-cat-select")) return;
    const card = e.target.closest(".book-card");
    if (card) selectBook(card.dataset.id);
  });
  // 书卡分类下拉变更
  document.getElementById("book-list").addEventListener("change", e => {
    const sel = e.target.closest(".bc-cat-select");
    if (!sel) return;
    const book = BOOKS.find(b => b.id === sel.dataset.id);
    if (book) {
      book.category = sel.value;
      if (window.ApiClient) ApiClient.updateBook(book.id, { category: sel.value }).catch(() => {});
    }
    renderCategoryChips();
    renderBookList();
  });
  // 书库搜索
  const libSearchEl = document.getElementById("lib-search");
  if (libSearchEl) libSearchEl.addEventListener("input", e => { libSearch = e.target.value; renderBookList(); });
  // 删除重复书籍
  const dedupBtn = document.getElementById("dedup-btn");
  if (dedupBtn) dedupBtn.addEventListener("click", removeDuplicates);
  // 今日打卡已改为「阅读满 1 分钟自动打卡」（见 autoCheckIn），不再需要手动按钮
  // 离开页面时上报阅读时长（beforeunload + pagehide 双保险；keepalive 保证卸载时也能送达）
  window.addEventListener("beforeunload", flushReading);
  window.addEventListener("pagehide", flushReading);
  // 阅读动作（滚动/点击/键盘/触摸）→ 刷新活跃时间；空闲超 15 分钟会暂停，有动作自动续上
  ["scroll", "keydown", "pointerdown", "wheel", "touchstart"].forEach(ev =>
    window.addEventListener(ev, onReadingActivity, { passive: true }));
  // 切到后台（切标签 / 最小化 / 关闭）时立即结算，避免时长丢失；切回前台视为有动作，恢复计时
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushReading();
    else onReadingActivity();
  });
  // 章节导航
  document.getElementById("prev-chap").addEventListener("click", () => gotoChapter(-1));
  document.getElementById("next-chap").addEventListener("click", () => gotoChapter(1));
  document.getElementById("chapter-select").addEventListener("change", e => {
    currentChapter = +e.target.value;
    const book = BOOKS.find(b => b.id === currentBookId);
    BOOK_PROGRESS[book.id] = currentChapter;
    if (window.ApiClient) ApiClient.setProgress(book.id, currentChapter).catch(() => {});
    renderReadingArea(book, currentChapter);
  });
  // 阅读区选中 → 弹出工具条（桌面 mouseup + 移动端 selectionchange 双保险）
  const area = document.getElementById("reading-area");
  area.addEventListener("mouseup", onSelection);
  // 移动端长按选词不会触发 mouseup，用 selectionchange 兜底（桌面也会被它覆盖，幂等）
  document.addEventListener("selectionchange", onSelectionChange);
  // 屏蔽阅读区原生长按菜单（仅当有选区时，让自研弹条成为操作入口；无选区保留系统菜单便于复制）
  area.addEventListener("contextmenu", e => { if (window.getSelection().toString().trim()) e.preventDefault(); });
  document.addEventListener("mousedown", e => {
    if (!e.target.closest("#selection-popup") && !e.target.closest("#reading-area"))
      hidePopup();
  });
  // 浮动工具条
  document.getElementById("selection-popup").addEventListener("click", e => {
    const btn = e.target.closest(".sp-btn");
    if (!btn) return;
    const text = currentSelectionText;
    if (btn.dataset.action === "analyze") doAnalyze(text);
    else if (btn.dataset.action === "annotate") openAnnotation(text);
    else doQuickSave(text);
    hidePopup();
  });
  // 知识库筛选
  document.getElementById("kb-filter").addEventListener("change", e => renderKB(e.target.value));
  document.getElementById("clear-kb-btn").addEventListener("click", () => {
    if (confirm("确定清空全部知识库？此操作不可撤销，且会同步删除后端数据。")) {
      KB = [];
      renderKB(document.getElementById("kb-filter").value);
      if (window.ApiClient) ApiClient.clearKb().catch(() => {});
    }
  });
  // 一键智能批注（调用后端 LLM 全文批注）
  const annoBtn = document.getElementById("annotate-btn");
  if (annoBtn) annoBtn.addEventListener("click", runAnnotation);
  // 导出弹窗
  document.getElementById("export-btn").addEventListener("click", () => openModal());
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));
  document.getElementById("export-modal").addEventListener("click", e => { if (e.target.id === "export-modal") closeModal(); });
  bindExportAll("export-all-books", "export-book-list");
  bindExportAll("export-all-cats", "export-cat-list");
  document.querySelectorAll(".export-do").forEach(b => b.addEventListener("click", () => {
    const fmt = b.dataset.fmt;
    const filter = getExportFilter();
    const note = document.getElementById("export-note");
    if ((filter.books && filter.books.size === 0) || (filter.cats && filter.cats.size === 0)) {
      if (note) { note.textContent = "请至少选择一本书和一个内容类型"; note.classList.add("warn"); }
      return;
    }
    if (note) { note.textContent = ""; note.classList.remove("warn"); }
    if (fmt === "markdown") exportMarkdown("full", filter);
    else if (fmt === "excel") exportExcel(filter);
    else if (fmt === "word") exportWord(filter);
    else if (fmt === "html") exportHtml(filter);
    else if (fmt === "notion") exportMarkdown("notion", filter);
    else if (fmt === "obsidian") exportMarkdown("obsidian", filter);
    closeModal();
  }));
  // 写批注弹窗（两步：写内容 → 选分类 + 是否导出）
  document.querySelectorAll("[data-close-anno]").forEach(b => b.addEventListener("click", closeAnnotation));
  document.getElementById("annotation-modal").addEventListener("click", e => { if (e.target.id === "annotation-modal") closeAnnotation(); });
  document.getElementById("anno-next").addEventListener("click", annoNext);
  document.getElementById("anno-back").addEventListener("click", () => showAnnoStep(1));
  document.getElementById("anno-finish").addEventListener("click", annoFinish);
  // 批注自定义分类：内联输入框（事件委托，避免被 renderAnnoTypes 清空按钮区）
  const annoAddWrap = document.getElementById("anno-add-wrap");
  if (annoAddWrap) {
    annoAddWrap.addEventListener("click", e => {
      if (e.target.id === "anno-add-type") {
        annoAddWrap.innerHTML = `<input id="anno-new-type" class="anno-inline-input" type="text" placeholder="输入分类名…" maxlength="20">` +
          `<button class="btn btn-primary anno-new-ok" type="button">确定</button>` +
          `<button class="btn anno-new-cancel" type="button">取消</button>`;
        const inp = document.getElementById("anno-new-type");
        if (inp) inp.focus();
      } else if (e.target.classList.contains("anno-new-ok")) {
        const inp = document.getElementById("anno-new-type");
        const name = inp ? inp.value.trim() : "";
        if (!name) { flash("分类名不能为空"); return; }
        if (!addAnnotationType(name)) { flash("该分类已存在"); return; }
        renderAnnoTypes();
        restoreAnnoAddBtn(annoAddWrap);
        document.querySelectorAll('input[name="anno-type"]').forEach(r => { r.checked = (r.value === name); });
        flash("已添加自定义分类：" + name);
      } else if (e.target.classList.contains("anno-new-cancel")) {
        restoreAnnoAddBtn(annoAddWrap);
      }
    });
    annoAddWrap.addEventListener("keydown", e => {
      if (e.target.id === "anno-new-type") {
        if (e.key === "Enter") { e.preventDefault(); const ok = annoAddWrap.querySelector(".anno-new-ok"); if (ok) ok.click(); }
        else if (e.key === "Escape") { restoreAnnoAddBtn(annoAddWrap); }
      }
    });
  }
  // 上传书籍
  document.getElementById("add-book-btn").addEventListener("click", openUploadModal);
  initUpload();
  // 词典偏好（可勾选显示哪些词典）
  setupDictPrefs();
  // 阅读统计：日历 / 周报 / 月报
  setupStats();
}

/* 词典偏好弹窗：勾选即时生效（AI 面板与知识库均按偏好过滤） */
function setupDictPrefs() {
  const btn = document.getElementById("dict-prefs-btn");
  const pop = document.getElementById("dict-prefs-popover");
  if (!btn || !pop) return;
  btn.addEventListener("click", e => { e.stopPropagation(); pop.classList.toggle("hidden"); buildDictPrefs(); });
  document.addEventListener("mousedown", e => {
    if (!e.target.closest("#dict-prefs-popover") && !e.target.closest("#dict-prefs-btn")) pop.classList.add("hidden");
  });
}
function buildDictPrefs() {
  const pop = document.getElementById("dict-prefs-popover");
  if (!pop) return;
  const groups = {};
  DICT_OPTIONS.forEach(d => { (groups[d.group] = groups[d.group] || []).push(d); });
  let h = `<div class="dp-title">选择要显示的词典</div>`;
  Object.keys(groups).forEach(g => {
    h += `<div class="dp-group"><div class="dp-group-h">${g}</div>`;
    groups[g].forEach(d => {
      const on = USER_PREFS.enabledDicts.includes(d.key) ? "checked" : "";
      h += `<label class="dp-item"><input type="checkbox" data-dict="${escHtml(d.key)}" ${on}> ${escHtml(d.key)}</label>`;
    });
    h += `</div>`;
  });
  pop.innerHTML = h;
  pop.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", () => {
      const key = cb.dataset.dict;
      if (cb.checked) { if (!USER_PREFS.enabledDicts.includes(key)) USER_PREFS.enabledDicts.push(key); }
      else { USER_PREFS.enabledDicts = USER_PREFS.enabledDicts.filter(x => x !== key); }
      if (typeof setEnabledDicts === "function") setEnabledDicts(USER_PREFS.enabledDicts);
      if (window.ApiClient) ApiClient.setPrefs(USER_PREFS).catch(() => {});
      renderAIPanel();
      renderKB(document.getElementById("kb-filter").value);
      flash("词典偏好已更新");
    });
  });
}

let currentSelectionText = "";

/* 选区锚点是否落在阅读区内（anchorNode 可能是文本节点或元素节点） */
function selectionInReadingArea(sel) {
  const node = sel.anchorNode;
  if (!node) return false;
  const el = node.nodeType === 3 ? node.parentNode : node;
  return !!(el && el.closest && el.closest("#reading-area"));
}

/* 把选中文字弹到浮动工具条；按视口边界夹紧，避免手机上溢出屏幕 */
function showSelectionPopup(sel) {
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return;
  currentSelectionText = sel.toString().trim();
  const popup = document.getElementById("selection-popup");
  popup.classList.remove("hidden"); // 先显示才能取到 offset 尺寸
  const pw = popup.offsetWidth || 210, ph = popup.offsetHeight || 40;
  let left = rect.left + rect.width / 2 - pw / 2;
  left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
  let top = rect.top - ph - 8;
  if (top < 4) top = rect.bottom + 8; // 顶部空间不足则放到选区下方
  popup.style.left = left + "px";
  popup.style.top = top + "px";
}

function onSelection() {
  const sel = window.getSelection();
  const text = sel.toString().trim();
  if (!text || !sel.rangeCount || !selectionInReadingArea(sel)) { hidePopup(); return; }
  showSelectionPopup(sel);
}

/* 移动端长按选词由 selectionchange 触发（mouseup 不触发）；桌面也会被覆盖，幂等 */
function onSelectionChange() {
  const sel = window.getSelection();
  const text = sel.toString().trim();
  if (!text || !sel.rangeCount || !selectionInReadingArea(sel)) { hidePopup(); return; }
  showSelectionPopup(sel);
}

function hidePopup() { document.getElementById("selection-popup").classList.add("hidden"); }

/* ---------- AI 在线状态（结合本机 LLM 配置与服务端兜底） ---------- */
function refreshAIStatus() {
  const el = document.getElementById("ai-status");
  if (!el) return;
  const clientOk = !!(window.LLM_CONFIG && window.LLM_CONFIG.API_KEY);
  const apply = (serverOk, serverModel) => {
    if (clientOk || serverOk) {
      const model = (window.LLM_CONFIG && window.LLM_CONFIG.MODEL) || serverModel || "";
      el.textContent = "🟢 AI 在线" + (model ? " · " + model : "");
      el.className = "ai-status on";
    } else {
      el.textContent = "🟡 AI 演示模式（未配置 LLM）";
      el.className = "ai-status off";
    }
  };
  if (window.ApiClient && typeof ApiClient.getConfig === "function") {
    ApiClient.getConfig().then((c) => apply(c && c.llmEnabled, c && c.model)).catch(() => apply(false, null));
  } else {
    apply(false, null);
  }
}
if (typeof window !== "undefined") window.refreshAIStatus = refreshAIStatus;

/* ---------- AI 分析（经后端，可接真实 LLM） ---------- */
async function doAnalyze(text) {
  const book = BOOKS.find(b => b.id === currentBookId);
  if (!book) return;
  const chap = book.chapters[currentChapter];
  currentSource = { book: book.title, author: book.author, page: chap.pages };
  flash("正在请求 AI 分析…");

  let result;
  try {
    result = await ApiClient.analyze({
      text, language: book.language, bookTitle: book.title, author: book.author, page: chap.pages
    });
  } catch (e) {
    flash("AI 分析失败：" + e.message);
    return;
  }
  currentAnalysis = result;
  renderAIPanel();
}

/* 渲染 AI 面板（不重新请求 LLM；切换词典偏好时可直接重渲染） */
function renderAIPanel() {
  if (!currentAnalysis) return;
  const panel = document.getElementById("ai-panel");
  const badge = document.getElementById("ai-mode-badge");
  badge.textContent = currentAnalysis.typeLabel;

  let html = "";
  if (currentAnalysis.curated) html += `<div class="ai-curated">✓ 真实分析（${currentSource.book}）</div>`;
  else html += `<div class="ai-curated">演示骨架 · 配置 LLM_API_KEY 后自动生成完整分析</div>`;

  currentAnalysis.blocks.forEach(b => {
    if (b.kind === "reminder") html += `<div class="ai-reminder">${b.html}</div>`;
    else if (b.kind === "source") html += `<div class="ai-source">${b.html}</div>`;
    else {
      // 词典释义块：按用户勾选的词典即时过滤（无需重跑 LLM）
      if (b.title === "Dictionary Definition" && currentAnalysis.record && Array.isArray(currentAnalysis.record.data.defs)) {
        html += `<div class="ai-block"><h4>${b.title}</h4><div class="ai-content">${renderDefsHtml(currentAnalysis.record.data.defs)}</div></div>`;
        return;
      }
      html += `<div class="ai-block"><h4>${b.title}</h4><div class="ai-content">${b.html}</div></div>`;
    }
  });

  // 智能标签
  selectedTags = (currentAnalysis.tags || []).slice();
  html += renderTagRow();
  html += `<div class="ai-actions">
      <button class="btn btn-primary" id="save-analysis">收藏到知识库</button>
      <button class="btn" id="copy-analysis">复制全文</button>
    </div>`;

  panel.innerHTML = html;
  document.getElementById("save-analysis").addEventListener("click", saveCurrentAnalysis);
  document.getElementById("copy-analysis").addEventListener("click", copyAnalysis);
  document.body.setAttribute("data-ai", "open"); // 移动端：有结果才展开 AI 面板
}

function renderTagRow() {
  let h = `<div class="tag-row" id="tag-row">`;
  ALL_TAGS.forEach(t => {
    const on = selectedTags.includes(t) ? " on" : "";
    h += `<span class="tag${on}" data-tag="${t}">${t}</span>`;
  });
  h += `</div>`;
  // 延迟绑定（innerHTML 后）
  setTimeout(() => {
    document.querySelectorAll("#tag-row .tag").forEach(el => {
      el.addEventListener("click", () => {
        const t = el.dataset.tag;
        if (selectedTags.includes(t)) { selectedTags = selectedTags.filter(x => x !== t); el.classList.remove("on"); }
        else { selectedTags.push(t); el.classList.add("on"); }
      });
    });
  }, 0);
  return h;
}

function saveCurrentAnalysis() {
  if (!currentAnalysis) return;
  saveFromAnalysis(currentAnalysis.record, currentSource, selectedTags);
  renderKB(document.getElementById("kb-filter").value);
  const btn = document.getElementById("save-analysis");
  btn.textContent = "✓ 已收藏"; btn.disabled = true; btn.classList.add("btn");
  flash("已收藏到「" + (CATEGORY_LABEL[currentAnalysis.record.category] || "") + "」");
}

function doQuickSave(text) {
  const book = BOOKS.find(b => b.id === currentBookId);
  const chap = book.chapters[currentChapter];
  const source = { book: book.title, author: book.author, page: chap.pages };
  const res = analyze(text, source);
  saveFromAnalysis(res.record, source, res.tags);
  renderKB(document.getElementById("kb-filter").value);
  flash("已直接收藏");
}

function copyAnalysis() {
  if (!currentAnalysis) return;
  let txt = currentAnalysis.raw + "\n\n";
  currentAnalysis.blocks.forEach(b => { if (b.title && b.title !== "reminder") txt += b.title + "：\n" + b.html.replace(/<[^>]+>/g, "") + "\n\n"; });
  navigator.clipboard.writeText(txt).then(() => flash("已复制分析全文"));
}

/* ---------- 一键全文智能批注（调用后端 LLM） ---------- */
async function runAnnotation() {
  if (!currentBookId) return;
  const btn = document.getElementById("annotate-btn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ 批注中…"; }
  flash("正在调用 LLM 全文智能批注，请稍候…");
  try {
    const res = await ApiClient.annotate(currentBookId);
    if (res && res.added > 0) {
      const state = await ApiClient.getState();
      syncFromState(state);
      renderKB(document.getElementById("kb-filter").value);
      flash("✅ 已新增 " + res.added + " 条批注到知识库");
    } else if (res && res.error) {
      flash("批注失败：" + res.error);
    } else {
      flash("未提取到新条目（可能文本过短）。");
    }
  } catch (e) {
    flash("批注失败：" + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⚡ 一键智能批注"; }
  }
}

function resetAIPanel() {
  document.getElementById("ai-panel").innerHTML =
    `<div class="ai-placeholder"><p>选中原文中的内容，这里会：</p>
     <ul><li>识别类型（单词 / 短语 / 表达 / 句子 / 段落）</li>
     <li>自动调用对应的分析模式</li><li>推荐智能标签并收藏进知识库</li></ul></div>`;
  document.getElementById("ai-mode-badge").textContent = "待命";
  currentAnalysis = null;
  document.body.removeAttribute("data-ai"); // 移动端：收起 AI 面板，阅读占满
}

/* ---------- 弹窗 / 提示 ---------- */
function openModal() {
  fillExportBooks();
  fillExportDicts();
  document.getElementById("export-modal").classList.remove("hidden");
}
function closeModal() { document.getElementById("export-modal").classList.add("hidden"); }

/* ---------- 写批注（两步：写内容 → 选分类 + 是否导出） ---------- */
let currentAnnoId = null;
let currentAnnoQuote = "";
let currentAnnoSource = null;

function openAnnotation(text) {
  const book = BOOKS.find(b => b.id === currentBookId);
  if (!book) return;
  const chap = book.chapters[currentChapter];
  currentAnnoSource = { book: book.title, author: book.author, page: chap.pages };
  currentAnnoQuote = text;
  currentAnnoId = null;
  const q = document.getElementById("anno-quote");
  q.textContent = "「" + (text.length > 200 ? text.slice(0, 200) + "…" : text) + "」";
  document.getElementById("anno-note").value = "";
  // 重置第二步：动态渲染分类（含用户自定义）+ 默认勾选导出
  renderAnnoTypes();
  const exp = document.getElementById("anno-exportable");
  if (exp) exp.checked = true;
  showAnnoStep(1);
  document.getElementById("annotation-modal").classList.remove("hidden");
}
function showAnnoStep(n) {
  document.getElementById("anno-step-text").classList.toggle("hidden", n !== 1);
  document.getElementById("anno-step-type").classList.toggle("hidden", n !== 2);
}
function closeAnnotation() { document.getElementById("annotation-modal").classList.add("hidden"); }
function annoNext() {
  const note = document.getElementById("anno-note").value.trim();
  if (!note) { flash("请先写下批注内容"); return; }
  const entry = addEntry({
    category: "annotation",
    tags: [],
    fields: { quote: currentAnnoQuote, note, annotationType: "其他" },
    book: currentAnnoSource.book, author: currentAnnoSource.author, page: currentAnnoSource.page,
    exportable: true
  });
  currentAnnoId = entry.id;
  showAnnoStep(2); // 写完后自动跳出选择分类
}
function annoFinish() {
  if (!currentAnnoId) return;
  const typeEl = document.querySelector('input[name="anno-type"]:checked');
  const type = typeEl ? typeEl.value : "其他";
  const exp = document.getElementById("anno-exportable").checked;
  const e = KB.find(x => x.id === currentAnnoId);
  if (!e) return;
  // 合并 fields（不覆盖 quote/note），并同步后端
  updateKb(currentAnnoId, { fields: Object.assign({}, e.fields, { annotationType: type }), exportable: exp });
  closeAnnotation();
  const filterEl = document.getElementById("kb-filter");
  if (filterEl) filterEl.value = "annotation";
  renderKB("annotation");
  flash("已保存批注（" + type + (exp ? " · 纳入导出" : " · 不导出") + "）");
}

/* 动态渲染批注分类（默认四个 + 用户自定义）；自定义项带 ✎ 标识，默认选第一项 */
function renderAnnoTypes() {
  const wrap = document.getElementById("anno-types");
  if (!wrap) return;
  const types = getAnnotationTypes();
  wrap.innerHTML = types.map((t, i) => {
    const isCustom = ANNOTATION_TYPES.indexOf(t) === -1;
    const mark = isCustom ? " ✎" : "";
    const checked = i === 0 ? " checked" : "";
    return `<label class="anno-type"><input type="radio" name="anno-type" value="${escapeHtml(t)}"${checked}> ${escapeHtml(t)}${mark}</label>`;
  }).join("");
}
/* 还原「➕ 自定义分类」按钮 */
function restoreAnnoAddBtn(wrap) {
  wrap.innerHTML = `<button class="btn btn-ghost anno-add-btn" id="anno-add-type" type="button">➕ 自定义分类</button>`;
}

/* 动态填充导出弹窗的「选择书籍」列表（每次打开都刷新，反映新书） */
function fillExportBooks() {
  const list = document.getElementById("export-book-list");
  if (!list) return;
  const titles = Array.from(new Set(BOOKS.map(b => b.title).filter(Boolean)));
  let html = "";
  titles.forEach(t => {
    html += `<label class="ef-item"><input type="checkbox" value="${escHtml(t)}" checked> ${escHtml(t)}</label>`;
  });
  html += `<label class="ef-item"><input type="checkbox" value="__none__" checked> 📌 未指定书籍</label>`;
  list.innerHTML = html;
}
/* 书籍/类型列表的「全选 / 清空」快捷 */
function bindExportAll(btnId, listId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const boxes = document.querySelectorAll(`#${listId} input[type=checkbox]`);
    if (!boxes.length) return;
    const anyUnchecked = Array.from(boxes).some(b => !b.checked);
    boxes.forEach(b => b.checked = anyUnchecked);
    btn.textContent = anyUnchecked ? "清空" : "全选";
  });
}
/* 导出弹窗的「仅导出该词典释义」下拉：
 * 既含知识库里真实出现过的词典，也含 DICT_OPTIONS 里已知的词典
 * （如英语 Oxford Dictionary），保证即使暂无英文条目也始终可选。 */
function fillExportDicts() {
  const sel = document.getElementById("export-dict-select");
  if (!sel) return;
  const set = new Set();
  if (typeof collectDicts === "function") collectDicts().forEach(d => set.add(d));
  if (typeof DICT_OPTIONS !== "undefined") DICT_OPTIONS.forEach(d => set.add(d.key));
  const dicts = Array.from(set).sort();
  let html = `<option value="">全部词典（不筛选）</option>`;
  dicts.forEach(d => { html += `<option value="${escHtml(d)}">${escHtml(d)}</option>`; });
  sel.innerHTML = html;
}
function flash(msg) {
  const s = document.getElementById("reading-status");
  const old = s.textContent;
  s.textContent = msg; s.style.color = "#00a884";
  setTimeout(() => { s.textContent = old; s.style.color = ""; }, 1800);
}

/* ---------- 移动端：底部标签栏导航 ---------- */
function setupMobileTabs() {
  const bar = document.getElementById("bottom-tabs");
  if (!bar) return;
  const btns = bar.querySelectorAll(".tab-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "stats") {
        // 统计是弹窗：打开统计模态框，保持当前面板不变
        const sb = document.getElementById("stats-btn");
        if (sb) sb.click();
        return;
      }
      document.body.setAttribute("data-tab", tab);
      btns.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  // 默认进入「书库」标签（窄屏才显示底部栏）
  document.body.setAttribute("data-tab", "library");
  btns.forEach((b) => b.classList.toggle("active", b.dataset.tab === "library"));
}

/* ---------- PWA：注册 service worker（仅安全上下文，局域网 http 下静默跳过） ---------- */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return; // localhost / https 才行；局域网 http 不注册
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => {
      console.warn("[sw] 注册失败（不影响正常使用）：", e && e.message);
    });
  });
}

/* ---------- 首次进入：后端已播种示例，无需前端注入 ---------- */

document.addEventListener("DOMContentLoaded", init);
