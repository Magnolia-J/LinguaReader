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
// 存储分层：云端只同步轻量元数据（剥离书籍完整正文），合并时保留本地章节
const LRStorage = require("./js/storage-layers.js");

/* 载入浏览器端分析引擎（detectType / analyze / *ToBlocks），使服务端 /api/analyze
 * 可直接复用，无需重复实现。原文件无 module.exports / DOM 依赖，可安全在服务端求值。
 * 仅取函数声明（function 声明会泄漏到本模块作用域），屏蔽可能覆盖本文件 module.exports 的写法。 */
try {
  const _analysisSrc = fs.readFileSync(path.join(__dirname, "js", "analysis.js"), "utf8")
    .replace(/module\s*\.\s*exports/g, "globalThis.__noexp");
  // eslint-disable-next-line no-eval
  (0, eval)(_analysisSrc);
} catch (e) {
  console.warn("[server] 载入 analysis.js 失败（/api/analyze 将不可用）：", e.message);
}

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
  return { books, progress, kb, prefs: { enabledDicts: ["Le Robert", "Larousse", "CNRTL", "Oxford Dictionary"], categories: [] }, reading: { seconds: {}, byDate: {}, byBookDay: {} }, checkins: {}, lastBookId: null, lemmaOverrides: {} };
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
  // 用户确认的原型（Lemma）覆盖表：key = `${lang}|${surfaceLower}` → 原型
  if (!store.lemmaOverrides || typeof store.lemmaOverrides !== "object") store.lemmaOverrides = {};
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
  // 本地自动备份调度（防抖；连续变更合并为一次；全程不抛错，绝不影响正常保存）
  scheduleBackup();
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
  // 云端只同步轻量数据：剥离每本书的完整正文（chapters），避免 500MB 数据库被书籍文本撑满。
  const payload = LRStorage.minimizeForCloud(store);
  sb.from("kb_store").upsert(
    { user_id: LR_USER_ID, payload, updated_at: new Date().toISOString() },
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
      // 云端只持有书籍「轻量元数据」（不含完整 chapters）。拉取时以本地章节为准合并，
      // 避免云端元数据覆盖掉本机正文导致无法阅读。
      const incoming = data.payload;
      if (Array.isArray(incoming.books)) {
        store.books = LRStorage.mergeBooksLocalFirst(store.books, incoming.books);
        incoming.books = store.books;
      }
      store = incoming;
      normalizeStore();
      console.log("[supabase] 已从云端拉取最新状态（书籍正文保留本地）");
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

/* 单段分析字符上限：远小于 LLM max_tokens 预算，避免被截断 */
const ANALYSIS_SEG_CHARS = 600;

/* 把长文本切成「句子 / 从句」单元；每段都完整送 AI，最后合并（绝不截断用户选区） */
function splitAnalysisUnits(t) {
  if (t.length <= ANALYSIS_SEG_CHARS) return [t];
  const rawParts = t.match(/[^.!?。！？…\n]+(?:[.!?。！？…]+|\n+|$)/g) || [t];
  const units = [];
  for (let part of rawParts) {
    part = part.trim();
    if (!part) continue;
    if (part.length <= ANALYSIS_SEG_CHARS) { units.push(part); continue; }
    // 超长单句：在逗号 / 空格附近断句，保证每片 ≤ 上限
    let i = 0;
    while (i < part.length) {
      let j = Math.min(part.length, i + ANALYSIS_SEG_CHARS);
      if (j < part.length) {
        let k = part.lastIndexOf("，", j);
        if (k <= i) k = part.lastIndexOf(",", j);
        if (k <= i) k = part.lastIndexOf(" ", j);
        if (k > i) j = k + 1;
      }
      const slice = part.slice(i, j).trim();
      if (slice) units.push(slice);
      i = j;
    }
  }
  return units.length ? units : [t];
}

/* 哪些 type 的输出含「源语言词元」，可做严格词元覆盖校验；
   其余（句法/段落/翻译/总结/提问/笔记）输出多为中文译文或摘要，源词元不一定出现，
   改走宽松校验（有实质内容即通过），避免对合法译文误触发重新分析。 */
function isStrictTokenType(type) {
  return /^(word|phrase|expression)$/i.test(type || "");
}

/* 覆盖率校验：AI 返回是否覆盖用户输入（用于「未覆盖则重新分析」护栏）
   - 严格型（word/phrase/expression）：要求关键源词元出现在返回中；
   - 宽松型（sentence/paragraph/translate/summary/ask/note）：仅要求返回非空即有实质内容。
   注：长文/多句由 analyzeText 自动按句分段后逐段分析再合并，天然保证不遗漏；
   本函数只作兜底护栏。 */
function analysisCoversInput(text, rec, type) {
  if (!rec || !rec.data) return false;
  if (!isStrictTokenType(type)) {
    // 宽松型：只要 data 含实质内容（非空的 {}）即视为已处理
    const out = JSON.stringify(rec.data || {}).replace(/\s+/g, " ");
    return out.length > 2;
  }
  const words = String(text).split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 3);
  if (!words.length) return true;
  const out = JSON.stringify(rec).toLowerCase();
  let hit = 0;
  for (const w of words) if (out.includes(w)) hit++;
  return hit / words.length >= 0.5;
}

/* 对单个文本单元做分析（LLM 优先，失败回退骨架）；retry=true 时附带更强「完整覆盖」指令 */
async function analyzeOne(text, ctx, type, retry) {
  const lang = ctx.language === "fr" ? "fr" : "en";
  if (isLLMEnabled()) {
    try {
      let rec = await analyzeRecord(text, type, lang, ctx.context, retry);
      if (!retry && !analysisCoversInput(text, rec, type)) {
        rec = await analyzeRecord(text, type, lang, ctx.context, true); // 未覆盖 → 重试一次（更强指令）
      }
      const blocks = recordToBlocks(rec);
      const src = [ctx.bookTitle, ctx.page].filter(Boolean).join(" · ");
      if (src) blocks.push({ title: "Source", html: "来源：《" + esc(ctx.bookTitle || "") + "》" + (ctx.page ? " " + esc(ctx.page) : ""), kind: "source" });
      if (type === "expression" || type === "sentence")
        blocks.unshift({ title: "reminder", html: "💡 这是值得收藏的表达 / 句型。", kind: "reminder" });
      return { raw: text, type, typeLabel: TYPE_LABELS[type] || type, mode: rec.category, curated: true, blocks, tags: rec.tags || [], record: { mode: rec.category, category: rec.category, tags: rec.tags || [], data: rec.data } };
    } catch (e) {
      console.warn("LLM 分析失败，回退骨架：", e.message);
    }
  }
  return analyze(text, ctx); // 浏览器分析引擎的骨架/精读输出
}

async function analyzeText(text, ctx) {
  // 严格保留用户选区的内部换行与空格，仅去掉首尾空白（不折叠、不缩减、不重新划分）
  const t = (text || "").replace(/^\s+|\s+$/g, "");
  if (!t) return analyze("", ctx);
  const units = splitAnalysisUnits(t);
  if (units.length <= 1) return await analyzeOne(t, ctx, detectType(t), false);
  // 多段：逐段分析后合并，保证完整覆盖用户选区
  const segs = [];
  for (const u of units) segs.push(await analyzeOne(u, ctx, detectType(u), false));
  const blocks = [];
  segs.forEach((s, i) => {
    blocks.push({ title: "选区片段 " + (i + 1) + "/" + segs.length, html: `<div class="seg-note">以下为第 ${i + 1} 段（共 ${segs.length} 段）的独立分析，已全部合并展示。</div>`, kind: "segment" });
    s.blocks.forEach((b) => blocks.push(b));
  });
  const records = segs.map((s) => s.record);
  const tags = Array.from(new Set(segs.flatMap((s) => s.tags || [])));
  return {
    raw: t, type: detectType(t), typeLabel: TYPE_LABELS[detectType(t)] || "文本",
    mode: segs[0].mode, curated: segs.every((s) => s.curated),
    blocks, segments: segs, records, tags
  };
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
      return send(res, 200, { books: store.books, progress: store.progress, kb: store.kb, prefs: store.prefs, reading: store.reading, checkins: store.checkins, lastBookId: store.lastBookId, deletedBookIds: store.deletedBookIds || [], lemmaOverrides: store.lemmaOverrides });
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
      // 关键安全约束：
      //  1) tombstone 只能删除「客户端明确省略（即真删了）的书」——只要 body.books 仍包含某书，tomb 不可移除之。
      //  2) 当 body.books 为空数组或未携带时，绝不动书籍、绝不以 tomb 清空——
      //     否则云端 deletedBookIds 一旦被污染（多出 id），就会被反复传播并最终清空整个书库。
      // 正常删除书的途径只有 DELETE /api/books/:id（会更新 deletedBookIds），
      // 或 PUT 一个「非空的、已省略该书」的 books（此时该书被 tomb 正确移除）。
      const booksBefore = store.books.length;
      if (Array.isArray(body.books) && body.books.length > 0) {
        const have = new Set(store.books.map((b) => b.id));
        const bodyIds = new Set(body.books.filter((b) => b && b.id).map((b) => String(b.id)));
        body.books.forEach((b) => {
          if (b && b.id && !have.has(b.id)) { store.books.push(b); have.add(b.id); }
        });
        store.books = store.books.filter((b) => b && b.id && (!tomb.has(String(b.id)) || bodyIds.has(String(b.id))));
      }
      // body.books 为空数组或未携带：保持服务端书籍不变（既不新增也不按 tomb 删除）。
      const booksAfter = store.books.length;
      if (booksAfter !== booksBefore) {
        console.log("[LR-DBG][store] PUT /api/store books " + booksBefore + " -> " + booksAfter +
          " (tomb=" + JSON.stringify([...tomb]) + ", bodyBooks=" + (Array.isArray(body.books) ? body.books.length : "absent") + ")");
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
      if (body.lemmaOverrides && typeof body.lemmaOverrides === "object") Object.assign(store.lemmaOverrides, body.lemmaOverrides);
      if (body.checkins && typeof body.checkins === "object") Object.assign(store.checkins, body.checkins);
      if (body.prefs && typeof body.prefs === "object") store.prefs = body.prefs;
      if (body.lastBookId) store.lastBookId = body.lastBookId;

      store.deletedBookIds = [...tomb];
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
      // 尊重客户端传入的 id（PDF 导入需要稳定的 id 来关联原始 PDF 文件），非法则服务端生成
      const id = (body && typeof body.id === "string" && /^[A-Za-z0-9_\-]{1,120}$/.test(body.id.trim())) ? body.id.trim() : newId("book");
      const book = Object.assign({
        id, title: "未命名", author: "未知", language: "en",
        publish: { year: "—", publisher: "用户上传" }, chapters: []
      }, body);
      book.id = id;
      if (!book.chapters || !book.chapters.length) book.chapters = [{ title: "全文", pages: "", paragraphs: ["（空）"] }];
      store.books.push(book);
      if (store.progress[book.id] === undefined) store.progress[book.id] = 0;
      saveStore();
      writeBookFile(book);   // 同时保存到固定文件夹 data/books/
      return send(res, 200, book);
    }

    // 书籍进度（精准：{c:章节索引, s:阅读区滚动位置, u:更新时间戳,
    //   pid:段落索引, off:段落内字符偏移, fp:附近文本指纹, page:页码序号, note:页码标签}）
    let m = p.match(/^\/api\/books\/([^/]+)\/progress$/);
    if (m && method === "PUT") {
      const id = decodeURIComponent(m[1]);
      const body = await readBody(req);
      const cur = (store.progress[id] && typeof store.progress[id] === "object") ? store.progress[id] : {};
      const c = (typeof body.chapter === "number") ? body.chapter : (cur.c || 0);
      const s = (typeof body.scroll === "number") ? body.scroll : (cur.s || 0);
      const prog = { c, s, u: Date.now() };
      // 精准定位附加字段（段落索引 / 偏移 / 指纹 / 页码），缺失则沿用已有
      if (typeof body.pid === "number") prog.pid = body.pid;
      else if (typeof cur.pid === "number") prog.pid = cur.pid;
      if (typeof body.off === "number") prog.off = body.off;
      else if (typeof cur.off === "number") prog.off = cur.off;
      if (typeof body.fp === "string") prog.fp = body.fp;
      else if (typeof cur.fp === "string") prog.fp = cur.fp;
      if (typeof body.page === "number") prog.page = body.page;
      else if (typeof cur.page === "number") prog.page = cur.page;
      if (typeof body.note === "string") prog.note = body.note;
      else if (typeof cur.note === "string") prog.note = cur.note;
      if (typeof body.chapter === "number" || typeof body.scroll === "number" ||
          typeof body.pid === "number" || typeof body.off === "number") {
        store.progress[id] = prog;
      }
      saveStore();
      return send(res, 200, { ok: true, progress: store.progress[id] });
    }

    // 记录「上次阅读的书」（用于重开时续读）
    if (p === "/api/lastbook" && method === "PUT") {
      const body = await readBody(req);
      if (body && body.id) { store.lastBookId = body.id; saveStore(); }
      return send(res, 200, { ok: true, lastBookId: store.lastBookId });
    }

    // 书籍更新（如修改分类 / 标题 / 作者 / 高亮批注 marks / 更新时间）
    m = p.match(/^\/api\/books\/([^/]+)$/);
    if (m && method === "PUT") {
      const id = decodeURIComponent(m[1]);
      const body = await readBody(req);
      const book = store.books.find((b) => b.id === id);
      if (!book) return send(res, 404, { error: "book not found" });
      if (typeof body.category === "string") book.category = body.category;
      if (typeof body.title === "string") book.title = body.title;
      if (typeof body.author === "string") book.author = body.author;
      // 高亮 / 批注：客户端是权威来源，整体替换为传入的 marks（保证「删除某条划线」也能正确传播）。
      // 仅当 body.marks 为数组时才覆盖；缺失该字段则不改动已有 marks。
      if (Array.isArray(body.marks)) {
        book.marks = body.marks;
      }
      if (body.updateTime) book.updateTime = body.updateTime;
      saveStore();
      writeBookFile(book);
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
        bookTitle: body.bookTitle, author: body.author, page: body.page, language: body.language,
        context: body.context || body.sentence, sentence: body.sentence
      });
      return send(res, 200, result);
    }

    // 用户确认的原型（Lemma）覆盖：key = `${lang}|${surfaceLower}` → 原型
    if (p === "/api/lemma-override" && method === "PUT") {
      const body = await readBody(req);
      if (body && body.key) {
        store.lemmaOverrides[body.key] = body.lemma || null;
        saveStore();
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: "missing key" });
    }

    // 全文智能批注
    if (p === "/api/annotate" && method === "POST") {
      if (!isLLMEnabled()) return send(res, 400, { error: "LLM 未配置（设置 LLM_API_KEY 后可用）" });
      const body = await readBody(req);
      const book = store.books.find((b) => b.id === body.bookId);
      if (!book) return send(res, 404, { error: "book not found" });
      const records = await annotateRecords(book, 30);
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

    // ===== 本地自动备份（WorkbenchBackup，仅本地磁盘，不进 Supabase）=====
    if (p === "/api/backup/config" && method === "GET") {
      return send(res, 200, getBackupConfig());
    }
    if (p === "/api/backup/config" && method === "PUT") {
      const body = await readBody(req);
      return send(res, 200, setBackupConfig(body || {}));
    }
    if (p === "/api/backup" && method === "POST") {
      const r = await createBackup("manual");
      return send(res, r.ok ? 200 : 500, r);
    }
    if (p === "/api/backups" && method === "GET") {
      return send(res, 200, { backups: listBackups(), dir: getBackupConfig().dir });
    }
    if (p === "/api/backup/restore" && method === "POST") {
      const body = await readBody(req);
      const name = body && body.name;
      if (!name) return send(res, 400, { error: "missing name" });
      const r = await restoreBackup(String(name));
      return send(res, r.ok ? 200 : 500, r);
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

/* 启动时确保统一本地数据目录存在（books / annotations / vocabulary /
 * analysis-cache / reading-progress / settings）。幂等，仅 mkdir -p。 */
function ensureLocalDirs() {
  try {
    const dirs = LRStorage.STORAGE_DIRS;
    Object.keys(dirs).forEach((k) => {
      if (k === "root") return;
      const d = dirs[k];
      if (d && !fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
    console.log("[storage] 本地数据目录已就绪：" + Object.values(dirs).filter((d) => d !== "data").join(" "));
  } catch (e) {
    console.warn("[storage] 创建本地数据目录失败：", e.message);
  }
}

/* =========================================================
 * 本地自动备份（WorkbenchBackup）
 * 设计：仅本地磁盘，绝不写入 Supabase；不做任何破坏原数据的事。
 *  - 默认目录：项目根 / WorkbenchBackup（可用 LR_BACKUP_DIR 环境变量或设置接口修改）
 *  - 备份内容：data/store.json（脱敏副本）+ data/books/*.json（仅解析后的 JSON，
 *    不含原始 PDF/EPUB/TXT 二进制——避免重复占用大量空间）
 *  - 自动备份：saveStore 后防抖触发（连续多次变更只在窗口结束后备份一次）
 *  - 立即备份：POST /api/backup（前端「立即备份」按钮）
 *  - 保留最近 retainDays 天（默认 7），自动清理过期
 *  - 失败不影响正常使用（全程 try/catch + 日志，绝不抛出）
 * ========================================================= */
const BACKUP_CONFIG_FILE = path.join(DATA_DIR, "backup-config.json");
const DEFAULT_BACKUP_DIR = process.env.LR_BACKUP_DIR || path.join(__dirname, "WorkbenchBackup");
const BACKUP_RETAIN_DEFAULT = 7;

let _backupCfgCache = null;
let _seeding = true; // 播种阶段不触发自动备份（避免备份无意义的默认数据）

function getBackupConfig() {
  if (_backupCfgCache) return _backupCfgCache;
  let cfg = { dir: DEFAULT_BACKUP_DIR, auto: true, retainDays: BACKUP_RETAIN_DEFAULT };
  try {
    const raw = fs.readFileSync(BACKUP_CONFIG_FILE, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object") {
      if (typeof j.dir === "string" && j.dir) cfg.dir = j.dir;
      if (typeof j.auto === "boolean") cfg.auto = j.auto;
      if (typeof j.retainDays === "number" && j.retainDays >= 1) cfg.retainDays = j.retainDays;
    }
  } catch (e) { /* 用默认 */ }
  _backupCfgCache = cfg;
  return cfg;
}
function setBackupConfig(patch) {
  const cfg = getBackupConfig();
  if (patch && patch.resetDir === true) cfg.dir = DEFAULT_BACKUP_DIR; // 还原默认文件夹
  else if (patch && typeof patch.dir === "string" && patch.dir.trim()) cfg.dir = patch.dir.trim();
  if (typeof patch.auto === "boolean") cfg.auto = patch.auto;
  if (typeof patch.retainDays === "number" && patch.retainDays >= 1) cfg.retainDays = patch.retainDays;
  _backupCfgCache = cfg;
  try { fs.writeFileSync(BACKUP_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8"); } catch (e) { console.warn("[backup] 写入配置失败：", e.message); }
  return cfg;
}

/* 脱敏：深拷贝并剔除敏感字段（密钥/密码/token/service_role 等），满足「不备份敏感信息」 */
const _SENSITIVE_KEY = /^(apiKey|api_key|password|passwd|secret|token|access[_-]?token|authorization|service[_-]?role|service_role|anon[_-]?key|anon_key|private[_-]?key|client[_-]?secret)$/i;
function sanitizeForBackup(obj) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k in v) {
        if (_SENSITIVE_KEY.test(k)) continue; // 跳过敏感键
        out[k] = walk(v[k]);
      }
      return out;
    }
    return v;
  };
  return walk(obj);
}

function tsFolderName(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + "-" + p(d.getMinutes()) + "-" + p(d.getSeconds());
}

/* 清理过期备份（保留最近 retainDays 天） */
function cleanOldBackups(cfg) {
  try {
    const dir = cfg.dir;
    if (!fs.existsSync(dir)) return;
    const retainMs = (cfg.retainDays || BACKUP_RETAIN_DEFAULT) * 86400000;
    const now = Date.now();
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      try {
        const st = fs.statSync(fp);
        if (now - st.mtimeMs > retainMs) {
          fs.rmSync(fp, { recursive: true, force: true });
          console.log("[backup] 已清理过期备份：" + e.name);
        }
      } catch (err) { /* 跳过损坏项 */ }
    }
  } catch (e) { console.warn("[backup] 清理过期备份失败：", e.message); }
}

/* 创建一个备份（label: manual|auto|pre-restore） */
async function createBackup(label) {
  const cfg = getBackupConfig();
  try {
    if (!fs.existsSync(cfg.dir)) fs.mkdirSync(cfg.dir, { recursive: true });
    const snap = sanitizeForBackup(store);
    const ts = new Date();
    const folder = path.join(cfg.dir, (label ? label + "-" : "auto-") + tsFolderName(ts));
    if (fs.existsSync(folder)) return { ok: false, error: "同名备份已存在" };
    fs.mkdirSync(folder, { recursive: true });
    // 1) 主数据（脱敏副本）
    fs.writeFileSync(path.join(folder, "store.json"), JSON.stringify(snap, null, 2), "utf-8");
    // 2) 书籍解析副本（仅 .json；跳过原始 PDF/EPUB/TXT 二进制）
    const bdir = path.join(folder, "books");
    fs.mkdirSync(bdir, { recursive: true });
    try {
      if (fs.existsSync(BOOKS_DIR)) {
        const files = fs.readdirSync(BOOKS_DIR).filter((f) => f.toLowerCase().endsWith(".json"));
        for (const f of files) {
          try { fs.copyFileSync(path.join(BOOKS_DIR, f), path.join(bdir, f)); } catch (e) { /* 单文件失败忽略 */ }
        }
      }
    } catch (e) { console.warn("[backup] 复制书籍文件失败：", e.message); }
    // 3) 清单
    const manifest = {
      createdAt: ts.toISOString(),
      label: label || "auto",
      books: (snap.books || []).length,
      kb: (snap.kb || []).length,
      storeBytes: fs.statSync(path.join(folder, "store.json")).size,
      note: "本地自动备份 · 不包含原始 PDF/EPUB/TXT 二进制 · 不含密钥",
      appVersion: "v1.1.4"
    };
    fs.writeFileSync(path.join(folder, "backup-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
    cleanOldBackups(cfg);
    return { ok: true, folder, manifest };
  } catch (e) {
    console.warn("[backup] 创建备份失败：", e.message);
    return { ok: false, error: e.message };
  }
}

/* 列举已有备份（按时间倒序） */
function listBackups() {
  const cfg = getBackupConfig();
  const out = [];
  try {
    if (!fs.existsSync(cfg.dir)) return out;
    const entries = fs.readdirSync(cfg.dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const e of entries) {
      const fp = path.join(cfg.dir, e.name);
      try {
        let m = null;
        const mp = path.join(fp, "backup-manifest.json");
        if (fs.existsSync(mp)) { try { m = JSON.parse(fs.readFileSync(mp, "utf8")); } catch (_) {} }
        let size = 0;
        const walkSize = (p) => {
          const st = fs.statSync(p);
          if (st.isFile()) size += st.size;
          else if (st.isDirectory()) { for (const c of fs.readdirSync(p)) walkSize(path.join(p, c)); }
        };
        walkSize(fp);
        out.push({
          name: e.name,
          createdAt: m ? m.createdAt : null,
          books: m ? m.books : null,
          kb: m ? m.kb : null,
          label: m ? m.label : null,
          size
        });
      } catch (err) { /* 跳过损坏项 */ }
    }
  } catch (e) { console.warn("[backup] 列举备份失败：", e.message); }
  out.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return out;
}

/* 恢复指定备份（先对当前状态做保险备份，再写回主 store 与书籍 JSON；绝不触碰原始二进制） */
async function restoreBackup(name) {
  if (!name) return { ok: false, error: "missing name" };
  name = String(name).replace(/[\/\\]/g, ""); // 防目录穿越
  const cfg = getBackupConfig();
  const folder = path.join(cfg.dir, name);
  try {
    if (!fs.existsSync(folder)) return { ok: false, error: "备份不存在" };
    // 保险：先备份当前状态，便于后悔时回退
    await createBackup("pre-restore");
    const storePath = path.join(folder, "store.json");
    if (!fs.existsSync(storePath)) return { ok: false, error: "备份数据损坏（缺 store.json）" };
    const incoming = JSON.parse(fs.readFileSync(storePath, "utf8"));
    store = incoming;             // 复用现有规范化与原子写
    normalizeStore();
    saveStore();
    // 恢复书籍解析副本（仅 .json；同名覆盖，不影响其它文件 / 原始二进制）
    const bsrc = path.join(folder, "books");
    if (fs.existsSync(bsrc)) {
      const files = fs.readdirSync(bsrc).filter((f) => f.toLowerCase().endsWith(".json"));
      for (const f of files) {
        try { fs.copyFileSync(path.join(bsrc, f), path.join(BOOKS_DIR, f)); } catch (e) {}
      }
    }
    return { ok: true, restored: name };
  } catch (e) {
    console.warn("[backup] 恢复失败：", e.message);
    return { ok: false, error: e.message };
  }
}

/* 自动备份调度：saveStore 后防抖触发；连续变更只在窗口结束后备份一次（最小改动、不每次操作都备份） */
let _backupDirty = false;
let _backupTimer = null;
function scheduleBackup() {
  try {
    if (_seeding) return;
    const cfg = getBackupConfig();
    if (!cfg.auto) return;
    _backupDirty = true;
    if (_backupTimer) return;
    _backupTimer = setTimeout(() => {
      _backupTimer = null;
      if (!_backupDirty) return;
      _backupDirty = false;
      createBackup("auto").then((r) => { if (!r.ok) console.warn("[backup] 自动备份跳过：" + (r.error || "")); });
    }, 120000);
  } catch (e) { /* 永不抛出，绝不影响正常使用 */ }
}

loadStore();
_seeding = false;
ensureLocalDirs();
server.listen(PORT, () => {
  console.log(`\n  LinguaReader Workspace 已启动`);
  console.log(`  ➜  前端：  http://localhost:${PORT}/`);
  console.log(`  ➜  后端 API：http://localhost:${PORT}/api/state`);
  console.log(`  ➜  LLM：${isLLMEnabled() ? "已配置（真实分析 + 全文批注）" : "未配置（演示骨架模式）"}\n`);
  // 公网部署时：启动后从 Supabase 拉取云端最新状态（覆盖本地），保证实时一致；未配置则无操作
  pullFromSupabase().then((ok) => { if (ok && store) saveStore(); });
});
