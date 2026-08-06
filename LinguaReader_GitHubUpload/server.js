/* =========================================================
 * LinguaReader Workspace · 后端服务（无依赖，Node 内置 http）
 *
 * 职责：
 *  - 托管前端静态资源
 *  - 持久化：书籍 / 阅读进度 / 知识库（data/store.json）
 *  - REST API：状态 / 书籍 / 进度 / 知识库 / AI 分析 / 全文批注
 *  - 首次启动从 js/books.js、js/analysis.js 播种示例数据
 *
 * 启动：node server.js   （可选：复制 .env.example 为 .env 配置 LLM）
 * ========================================================= */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { analyzeRecord, annotateRecords, isLLMEnabled, loadEnv } = require("./llm.js");

loadEnv();

const PORT = process.env.PORT || 3007;
const DATA_DIR = process.env.LR_DATA_DIR || path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const BOOKS_DIR = path.join(DATA_DIR, "books");   // 每本用户上传的书单独存一个文件（固定文件夹）
const PUBLIC_DIR = __dirname;

/* ---------- 持久化存储 ---------- */
function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

let store = null;

function seedStore() {
  // 从源文件捕获示例书籍与精读样例（单一数据源，避免重复）
  const booksCode = fs.readFileSync(path.join(__dirname, "js", "books.js"), "utf8");
  // eslint-disable-next-line no-eval
  eval(booksCode + "\n;globalThis.__SB = BOOKS; globalThis.__SP = BOOK_PROGRESS;");
  const analysisCode = fs.readFileSync(path.join(__dirname, "js", "analysis.js"), "utf8");
  // eslint-disable-next-line no-eval
  eval(analysisCode + "\n;globalThis.__SC = CURATED_ANALYSES;");

  const books = globalThis.__SB;
  const progress = globalThis.__SP || {};
  const cur = globalThis.__SC || {};
  const kb = [];
  const sampleKeys = [
    "proviser",
    "on aurait dit que",
    "nous étions à l'étude quand le proviseur entra, suivi d'un nouveau habillé en bourgeois, et d'un garçon de classe qui portait un grand pupitre."
  ];
  sampleKeys.forEach((k) => {
    const s = cur[k];
    if (!s) return;
    kb.unshift({
      id: newId("kb"),
      category: s.category,
      tags: s.tags || [],
      fields: s.data || {},
      book: "Madame Bovary",
      author: "Gustave Flaubert",
      page: "p. 1–3",
      note: "",
      createdAt: new Date().toISOString()
    });
  });
  return { books, progress, kb, prefs: { enabledDicts: ["Le Robert", "Larousse", "CNRTL", "Oxford Dictionary"], categories: [] }, reading: { seconds: {}, byDate: {}, byBookDay: {} }, checkins: {}, lastBookId: null };
}

function loadStore() {
  ensureStore();
  // 依次尝试：主文件 → .bak 备份 → 才重新播种（避免文件被写坏时静默清空全部数据）
  const candidates = [STORE_FILE, STORE_FILE + ".bak"];
  for (const f of candidates) {
    try {
      const raw = fs.readFileSync(f, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        store = parsed;
        normalizeStore();
        if (f !== STORE_FILE) console.warn(`[store] 主文件损坏，已从备份恢复：${path.basename(f)}`);
        return;
      }
    } catch (e) { /* 尝试下一个候选 */ }
  }
  store = seedStore();
  saveStore();
}

/* 补齐所有字段默认值（加载后 / 播种后共用），并合并 data/books/ 兜底 */
function normalizeStore() {
  if (!store.books) store.books = [];
  if (!store.progress || typeof store.progress !== "object") store.progress = {};
  if (!store.kb) store.kb = [];
  if (!store.prefs || !Array.isArray(store.prefs.enabledDicts)) {
    store.prefs = { enabledDicts: ["Le Robert", "Larousse", "CNRTL", "Oxford Dictionary"] };
  }
  if (!Array.isArray(store.prefs.categories)) store.prefs.categories = [];
  if (!store.reading || typeof store.reading !== "object") store.reading = { seconds: {}, byDate: {}, byBookDay: {} };
  if (!store.reading.seconds) store.reading.seconds = {};
  if (!store.reading.byDate) store.reading.byDate = {};
  if (!store.reading.byBookDay || typeof store.reading.byBookDay !== "object") store.reading.byBookDay = {};
  if (!store.checkins || typeof store.checkins !== "object") store.checkins = {};
  if (!store.lastBookId) store.lastBookId = null;
  // 已删除书籍的持久化清单（tombstone）：删除书籍时写入，所有「合并/补齐」路径都要跳过，确保删除永久生效
  if (!Array.isArray(store.deletedBookIds)) store.deletedBookIds = [];
  // 合并固定文件夹 data/books/ 中、但 store.json 里缺失的书籍（防 store.json 损坏时丢书）
  mergeBooksFolder();
}

/* 原子写入：先写临时文件再 rename 替换目标；覆盖前把当前好文件备份为 .bak。
 * 这样即使进程在保存途中被强杀，主文件也不会处于半写入状态，下次启动可正常解析。 */
function saveStore() {
  ensureStore();
  const tmp = STORE_FILE + ".tmp";
  const data = JSON.stringify(store, null, 2);
  try {
    if (fs.existsSync(STORE_FILE)) {
      try { fs.copyFileSync(STORE_FILE, STORE_FILE + ".bak"); } catch (e) { /* 备份失败不阻断 */ }
    }
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, STORE_FILE); // 原子替换
  } catch (e) {
    // 极少数情况下 rename 失败，退回直接写入（仍保证不丢历史 .bak）
    try { fs.writeFileSync(STORE_FILE, data, "utf-8"); } catch (e2) { console.error("保存 store 失败：", e2.message); }
  }
  // 云端持久化（可选）：配置了 Supabase 时把整包 store 异步写入 kb_store，避免免费主机本地磁盘临时导致数据丢失
  pushToSupabase();
}

/* =========================================================
 * 可选：Supabase 云端持久化（公网部署时用，避免免费主机本地磁盘临时丢数据）
 * 通过环境变量开启：SUPABASE_URL + SUPABASE_SERVICE_ROLE（+ 可选 LR_USER_ID）。
 * 未配置时完全不生效，本地文件存储行为不变。
 * 使用 service_role 密钥（绕过 RLS），仅放在服务端环境变量，切勿进前端/仓库。
 * ========================================================= */
let _sbClient = null; // null=尚未尝试；false=未配置/失败
function getSupabase() {
  if (_sbClient !== null) return _sbClient || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) { _sbClient = false; return null; }
  try {
    const { createClient } = require("@supabase/supabase-js");
    _sbClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  } catch (e) {
    console.warn("[supabase] 初始化失败（请确认已 npm install @supabase/supabase-js）：", e.message);
    _sbClient = false;
  }
  return _sbClient || null;
}
const LR_USER_ID = process.env.LR_USER_ID || "00000000-0000-0000-0000-000000000001";

function pushToSupabase() {
  const sb = getSupabase();
  if (!sb) return;
  sb.from("kb_store").upsert(
    { user_id: LR_USER_ID, payload: store, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  ).then(({ error }) => {
    if (error) console.warn("[supabase] 写入失败：", error.message);
  }).catch((e) => console.warn("[supabase] 写入异常：", e.message));
}
async function pullFromSupabase() {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { data, error } = await sb.from("kb_store").select("payload").eq("user_id", LR_USER_ID).maybeSingle();
    if (error) { console.warn("[supabase] 读取失败：", error.message); return false; }
    if (data && data.payload && typeof data.payload === "object") {
      store = data.payload;
      normalizeStore();
      console.log("[supabase] 已从云端拉取最新状态");
    }
    return true;
  } catch (e) { console.warn("[supabase] 读取异常：", e.message); return false; }
}

/* 把整本书单独写入 data/books/<id>.json（固定文件夹，便于用户查看与备份） */
function writeBookFile(book) {
  try {
    if (!fs.existsSync(BOOKS_DIR)) fs.mkdirSync(BOOKS_DIR, { recursive: true });
    const safeId = String(book.id).replace(/[\\/:*?"<>|]/g, "_");
    fs.writeFileSync(path.join(BOOKS_DIR, safeId + ".json"), JSON.stringify(book, null, 2), "utf-8");
  } catch (e) {
    console.warn("写入 books 文件夹失败：", e.message);
  }
}

/* 启动时扫描 data/books/，把 store.json 中缺失的书籍补齐（按 id 去重；跳过已删除清单中的书） */
function mergeBooksFolder() {
  try {
    if (!fs.existsSync(BOOKS_DIR)) return;
    const files = fs.readdirSync(BOOKS_DIR).filter((f) => f.endsWith(".json"));
    const have = new Set(store.books.map((b) => b.id));
    const deleted = new Set((store.deletedBookIds || []).map(String));
    for (const f of files) {
      try {
        const fb = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), "utf8"));
        if (fb && fb.id && !have.has(fb.id) && !deleted.has(String(fb.id))) { store.books.push(fb); have.add(fb.id); }
      } catch (e) { /* 跳过损坏文件 */ }
    }
  } catch (e) {
    console.warn("读取 books 文件夹失败：", e.message);
  }
}

/* 逐键取最大值合并两个数值对象（用于阅读时长，多端互不覆盖） */
function mergeMaxObj(dst, src) {
  const out = Object.assign({}, dst || {});
  for (const k in (src || {})) out[k] = Math.max(out[k] || 0, src[k] || 0);
  return out;
}

/* ---------- 注入浏览器分析引擎（用于骨架回退与 LLM 结果渲染） ---------- */
// analysis.js 用经典脚本写法；这里用 eval 注入，其函数声明会进入本模块作用域。
const analysisCode = fs.readFileSync(path.join(__dirname, "js", "analysis.js"), "utf8");
// eslint-disable-next-line no-eval
eval(analysisCode);

const TYPE_LABELS = {
  word: "A · 单词",
  phrase: "B · 短语",
  expression: "C · 固定表达",
  sentence: "D · 完整句子",
  paragraph: "E · 段落"
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* 本地日期 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// 把 LLM 返回的 {category, tags, data} 渲染成前端所需的 blocks
function recordToBlocks(rec) {
  const d = rec.data || {};
  const mode = rec.category;
  if (mode === "vocabulary") return vocabToBlocks(d);
  if (mode === "expressions") return expressionToBlocks(d);
  if (mode === "sentencePatterns" || mode === "beautifulSentences") return sentenceToBlocks(d);
  // writingMaterials / literary 等：通用渲染
  const order = Object.keys(d);
  if (!order.length) return [{ title: "内容", html: esc("(无结构化数据)") }];
  return order.map((k) => {
    let v = d[k];
    if (Array.isArray(v)) v = "<ul>" + v.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>";
    else if (v && typeof v === "object") v = esc(JSON.stringify(v));
    else v = esc(String(v));
    return { title: k, html: v };
  });
}

async function analyzeText(text, ctx, cfg) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  const type = detectType(t);
  if (isLLMEnabled(cfg)) {
    try {
      const rec = await analyzeRecord(t, type, ctx.language === "fr" ? "fr" : "en", cfg);
      const blocks = recordToBlocks(rec);
      const src = [ctx.bookTitle, ctx.page].filter(Boolean).join(" · ");
      if (src) blocks.push({ title: "Source", html: "来源：《" + esc(ctx.bookTitle || "") + "》" + (ctx.page ? " " + esc(ctx.page) : ""), kind: "source" });
      if (type === "expression" || type === "sentence")
        blocks.unshift({ title: "reminder", html: "💡 这是值得收藏的表达 / 句型。", kind: "reminder" });
      return {
        raw: t, type, typeLabel: TYPE_LABELS[type] || type, mode: rec.category,
        curated: true, blocks, tags: rec.tags || [],
        record: { mode: rec.category, category: rec.category, tags: rec.tags || [], data: rec.data }
      };
    } catch (e) {
      console.warn("LLM 分析失败，回退骨架：", e.message);
    }
  }
  return analyze(t, ctx); // 浏览器分析引擎的骨架/精读输出
}

/* ---------- HTTP 工具 ---------- */
function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8"
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, { error: "forbidden" });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: "not found" });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

/* ---------- API 路由 ---------- */
async function handleApi(req, res, urlPath) {
  const method = req.method;
  const p = urlPath;

  try {
    // 配置（AI 是否在线）
    if (p === "/api/config" && method === "GET") {
      return send(res, 200, { llmEnabled: isLLMEnabled(), model: process.env.LLM_MODEL || "（未配置）" });
    }

    // 整体状态
    if (p === "/api/state" && method === "GET") {
      return send(res, 200, { books: store.books, progress: store.progress, kb: store.kb, prefs: store.prefs, reading: store.reading, checkins: store.checkins, lastBookId: store.lastBookId, deletedBookIds: store.deletedBookIds || [] });
    }

    // 整体读写（云端同步用：pull 拉取整包 / push 写回整包；原子写 + 备份）
    if (p === "/api/store" && method === "GET") {
      return send(res, 200, store);
    }
    if (p === "/api/store" && method === "PUT") {
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return send(res, 400, { error: "无效的 store 载荷" });
      }
      // 合并而非整体替换：以服务端现有数据为基础吸收新增，并按 tombstone 移除已删书。
      // 这样即便客户端发来「缺书/缺笔记」的载荷（云端合并异常），服务端也绝不会丢数据；
      // 用户在某端删除的书会通过 body.deletedBookIds 正确传播并被移除。
      const tomb = new Set([...(store.deletedBookIds || []), ...(Array.isArray(body.deletedBookIds) ? body.deletedBookIds : [])].map(String));

      // 书籍：保留服务端已有的，吸收 body 新增的，最后按 tombstone 移除。
      // 关键安全约束：tombstone 只能删除「客户端明确省略（即真删了）的书」。
      // 只要 body.books 仍包含某书，说明它未被删除，tomb 不可移除之——
      // 否则一旦云端 deletedBookIds 被污染（例如旧合并写入了多余 id），
      // 就会被反复传播并最终清空整个书库。
      if (Array.isArray(body.books)) {
        const have = new Set(store.books.map((b) => b.id));
        const bodyIds = new Set(body.books.filter((b) => b && b.id).map((b) => String(b.id)));
        body.books.forEach((b) => {
          if (b && b.id && !have.has(b.id)) { store.books.push(b); have.add(b.id); }
        });
        store.books = store.books.filter((b) => b && b.id && (!tomb.has(String(b.id)) || bodyIds.has(String(b.id))));
      } else {
        // body 未携带 books（如仅同步阅读时长/笔记）→ 绝不动书籍，更不按 tomb 清空
        store.books = store.books.filter((b) => b && b.id && !tomb.has(String(b.id)));
      }

      // 笔记：同理由 id 并集，绝不丢弃
      if (Array.isArray(body.kb)) {
        const khave = new Set(store.kb.map((k) => k.id));
        body.kb.forEach((k) => {
          if (k && k.id && !khave.has(k.id)) { store.kb.push(k); khave.add(k.id); }
        });
      }

      // 阅读时长：逐键取 max（多端互不覆盖）
      if (body.reading && typeof body.reading === "object") {
        const r = body.reading;
        store.reading.seconds = mergeMaxObj(store.reading.seconds, r.seconds);
        store.reading.byDate = mergeMaxObj(store.reading.byDate, r.byDate);
        if (r.byBookDay && typeof r.byBookDay === "object") {
          store.reading.byBookDay = store.reading.byBookDay || {};
          for (const d in r.byBookDay) {
            store.reading.byBookDay[d] = mergeMaxObj(store.reading.byBookDay[d] || {}, r.byBookDay[d]);
          }
        }
      }
      // 进度 / 打卡：以传入为准（absorbed），避免回退
      if (body.progress && typeof body.progress === "object") Object.assign(store.progress, body.progress);
      if (body.checkins && typeof body.checkins === "object") Object.assign(store.checkins, body.checkins);
      if (body.prefs && typeof body.prefs === "object") store.prefs = body.prefs;
      if (body.lastBookId) store.lastBookId = body.lastBookId;

      store.deletedBookIds = [...tomb];
      // 卫生清理：凡是「仍存在于书库」的书，其 id 不应留在 deletedBookIds（防污染长期滞留）。
      // 仅保留真正已删且不在书库中的 id，删除标记才有效。
      {
        const liveIds = new Set((store.books || []).filter((b) => b && b.id).map((b) => String(b.id)));
        const pruned = (store.deletedBookIds || []).filter((id) => !liveIds.has(String(id)));
        store.deletedBookIds = pruned;
      }
      normalizeStore();
      saveStore(); // 复用原子写 + .bak 备份
      return send(res, 200, { ok: true, lastBookId: store.lastBookId });
    }

    // 词典偏好（可勾选显示哪些词典）+ 用户自定义分类
    if (p === "/api/prefs" && method === "PUT") {
      const body = await readBody(req);
      store.prefs = {
        enabledDicts: Array.isArray(body.enabledDicts) ? body.enabledDicts : (store.prefs.enabledDicts || []),
        categories: Array.isArray(body.categories) ? body.categories : (store.prefs.categories || [])
      };
      saveStore();
      return send(res, 200, store.prefs);
    }

    // 书籍集合
    if (p === "/api/books" && method === "POST") {
      const body = await readBody(req);
      const book = Object.assign({ id: newId("book") }, body);
      if (!book.chapters || !book.chapters.length) book.chapters = [{ title: "全文", pages: "", paragraphs: ["（空）"] }];
      store.books.push(book);
      store.progress[book.id] = 0;
      saveStore();
      writeBookFile(book);   // 同时保存到固定文件夹 data/books/
      return send(res, 200, book);
    }

    // 书籍进度
    let m = p.match(/^\/api\/books\/([^/]+)\/progress$/);
    if (m && method === "PUT") {
      const id = decodeURIComponent(m[1]);
      const body = await readBody(req);
      if (typeof body.chapter === "number") store.progress[id] = body.chapter;
      saveStore();
      return send(res, 200, { ok: true });
    }

    // 记录「上次阅读的书」（用于重开时续读）
    if (p === "/api/lastbook" && method === "PUT") {
      const body = await readBody(req);
      if (body && body.id) { store.lastBookId = body.id; saveStore(); }
      return send(res, 200, { ok: true, lastBookId: store.lastBookId });
    }

    // 书籍更新（如修改分类）
    m = p.match(/^\/api\/books\/([^/]+)$/);
    if (m && method === "PUT") {
      const id = decodeURIComponent(m[1]);
      const body = await readBody(req);
      const book = store.books.find((b) => b.id === id);
      if (!book) return send(res, 404, { error: "book not found" });
      if (typeof body.category === "string") book.category = body.category;
      if (typeof body.title === "string") book.title = body.title;
      if (typeof body.author === "string") book.author = body.author;
      saveStore();
      return send(res, 200, book);
    }

    // 删除书籍
    m = p.match(/^\/api\/books\/([^/]+)$/);
    if (m && method === "DELETE") {
      const id = decodeURIComponent(m[1]);
      store.books = store.books.filter((b) => b.id !== id);
      delete store.progress[id];
      // 写入「已删除清单」：之后本地备份 reconcile、云端并集合并、books 文件夹补齐都会跳过它，删除永久生效
      if (!Array.isArray(store.deletedBookIds)) store.deletedBookIds = [];
      if (!store.deletedBookIds.includes(id)) store.deletedBookIds.push(id);
      saveStore();
      try { fs.unlinkSync(path.join(BOOKS_DIR, String(id).replace(/[\\/:*?"<>|]/g, "_") + ".json")); } catch (e) { /* 文件可能不存在 */ }
      return send(res, 200, { ok: true, deletedBookIds: store.deletedBookIds });
    }

    // 阅读时长上报（累加：按书 + 按天 + 按书按天）
    if (p === "/api/reading" && method === "PUT") {
      const body = await readBody(req);
      const bookId = body.bookId;
      const secs = Number(body.seconds) || 0;
      if (bookId && secs > 0) {
        store.reading.seconds[bookId] = (store.reading.seconds[bookId] || 0) + secs;
        const t = todayStr();
        store.reading.byDate[t] = (store.reading.byDate[t] || 0) + secs;
        if (!store.reading.byBookDay[t]) store.reading.byBookDay[t] = {};
        store.reading.byBookDay[t][bookId] = (store.reading.byBookDay[t][bookId] || 0) + secs;
        saveStore();
      }
      return send(res, 200, { ok: true });
    }

    // 阅读打卡（按天标记，返回连续天数由前端计算）
    if (p === "/api/checkin" && method === "POST") {
      const body = await readBody(req);
      const t = (body && body.date) || todayStr();
      store.checkins[t] = true;
      saveStore();
      return send(res, 200, { ok: true, date: t, checkedInToday: t === todayStr() });
    }

    // 知识库集合
    if (p === "/api/kb" && method === "GET") {
      return send(res, 200, store.kb);
    }
    if (p === "/api/kb" && method === "POST") {
      const body = await readBody(req);
      const entry = Object.assign({ id: newId("kb"), createdAt: new Date().toISOString(), note: "" }, body);
      if (!entry.fields) entry.fields = entry.data || {};
      store.kb.unshift(entry);
      saveStore();
      return send(res, 200, entry);
    }
    if (p === "/api/kb" && method === "DELETE") {
      store.kb = [];
      saveStore();
      return send(res, 200, { ok: true });
    }

    // 单条知识库
    m = p.match(/^\/api\/kb\/([^/]+)$/);
    if (m && (method === "PUT" || method === "DELETE")) {
      const id = decodeURIComponent(m[1]);
      if (method === "DELETE") {
        store.kb = store.kb.filter((e) => e.id !== id);
        saveStore();
        return send(res, 200, { ok: true });
      }
      const body = await readBody(req);
      const e = store.kb.find((x) => x.id === id);
      if (!e) return send(res, 404, { error: "not found" });
      Object.assign(e, body);
      saveStore();
      return send(res, 200, e);
    }

    // AI 分析（划线）
    if (p === "/api/analyze" && method === "POST") {
      const body = await readBody(req);
      const result = await analyzeText(body.text, {
        bookTitle: body.bookTitle, author: body.author, page: body.page, language: body.language
      }, body.llm || null);
      return send(res, 200, result);
    }

    // 全文智能批注
    if (p === "/api/annotate" && method === "POST") {
      const body = await readBody(req);
      if (!isLLMEnabled(body.llm || null)) return send(res, 400, { error: "LLM 未配置（请在 ☁ 设置中填入你自己的 API Key）" });
      const book = store.books.find((b) => b.id === body.bookId);
      if (!book) return send(res, 404, { error: "book not found" });
      const records = await annotateRecords(book, 30, body.llm || null);
      const entries = records.map((r) => {
        const entry = {
          id: newId("kb"), category: r.category, tags: r.tags || [], fields: r.data,
          book: r.book, author: r.author, page: r.page, note: "", createdAt: new Date().toISOString()
        };
        store.kb.unshift(entry);
        return entry;
      });
      saveStore();
      return send(res, 200, { added: entries.length, entries });
    }

    return send(res, 404, { error: "unknown endpoint" });
  } catch (e) {
    console.error("API error:", e);
    return send(res, 500, { error: e.message || "server error" });
  }
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  // 允许跨域（手机端可指向本机局域网 IP / 公网后端）；仅对 /api/ 放行，静态资源保持同源
  if (urlPath.startsWith("/api/")) {
    // 可选访问令牌：设置 LR_TOKEN 环境变量后，所有 /api 请求必须带 ?token= 或 header x-lr-token，否则 401。
    // 公网部署时用它做基本防护，避免数据裸奔。本地不设置则完全不生效。
    const LR_TOKEN = process.env.LR_TOKEN;
    if (LR_TOKEN) {
      const q = new URL(req.url, "http://localhost").searchParams.get("token");
      const h = req.headers["x-lr-token"];
      if (q !== LR_TOKEN && h !== LR_TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    return handleApi(req, res, urlPath);
  }
  return serveStatic(req, res);
});

loadStore();
server.listen(PORT, () => {
  console.log(`\n  LinguaReader Workspace 已启动`);
  console.log(`  ➜  前端：  http://localhost:${PORT}/`);
  console.log(`  ➜  后端 API：http://localhost:${PORT}/api/state`);
  console.log(`  ➜  LLM：${isLLMEnabled() ? "已配置（真实分析 + 全文批注）" : "未配置（演示骨架模式）"}\n`);
  // 公网部署时：启动后从 Supabase 拉取云端最新状态（覆盖本地），保证实时一致；未配置则无操作
  pullFromSupabase().then((ok) => { if (ok && store) saveStore(); });
});
