/* =========================================================
 * LinguaReader Workspace · 知识库系统
 * 管理 6 个库、智能标签、导出。
 * 持久化统一走后端（见 js/api.js），KB 仅作内存缓存。
 * ========================================================= */

const CATEGORY_LABEL = {
  vocabulary: "Vocabulary 词汇",
  expressions: "Expressions 表达",
  sentencePatterns: "Sentence Patterns 句型",
  beautifulSentences: "Beautiful Sentences 精彩句",
  writingMaterials: "Writing Materials 写作素材",
  literary: "Literary Notes 文学笔记",
  annotation: "批注 Annotation"
};

/* AI 面板标签 → 知识库分类键（用户点选标签后，入库主分类按标签走） */
const TAG_TO_CATEGORY = {
  "Vocabulary": "vocabulary",
  "Sentence Pattern": "sentencePatterns",
  "Native Expression": "expressions",
  "Beautiful Sentence": "beautifulSentences",
  "Writing Material": "writingMaterials",
  "Literary Analysis": "literary"
};

/* 批注类型（写批注第二步选择）：默认四个 + 用户自定义 */
const ANNOTATION_TYPES = ["启发性观点", "联想的例子", "疑问", "其他"];
const ANNO_TYPES_KEY = "lingua_anno_custom_types";

/* 读取批注分类：默认四个在前，用户自定义在后（与默认去重合并） */
function getAnnotationTypes() {
  let custom = [];
  try {
    const raw = (typeof localStorage !== "undefined") && localStorage.getItem(ANNO_TYPES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) custom = arr.filter(t => typeof t === "string" && t.trim());
    }
  } catch (e) { /* 忽略损坏数据 */ }
  const seen = new Set(ANNOTATION_TYPES);
  const merged = ANNOTATION_TYPES.slice();
  custom.forEach(t => { if (!seen.has(t)) { seen.add(t); merged.push(t); } });
  return merged;
}

/* 新增一个自定义分类（去重校验）；返回 true 表示真正新增 */
function addAnnotationType(name) {
  name = (name || "").trim();
  if (!name) return false;
  if (getAnnotationTypes().indexOf(name) !== -1) return false;
  const custom = getAnnotationTypes().filter(t => ANNOTATION_TYPES.indexOf(t) === -1);
  custom.push(name);
  try { localStorage.setItem(ANNO_TYPES_KEY, JSON.stringify(custom)); } catch (e) { /* 忽略 */ }
  return true;
}

let KB = [];
let lastKbFilter = "all";   // 当前选中的分类（对应 #kb-filter）
let kbBookFilter = "";      // 当前选中的书名（对应 #kb-book-filter，""=全部书籍）

/* 词形还原（Lemma）开关：默认开启，仅保存原型。
 * 关闭后保持原始词形（与改动前行为一致）。持久化于 localStorage。 */
let KB_USE_LEMMA = loadKbLemmaPref();
function loadKbLemmaPref() {
  try { return localStorage.getItem("lingua_use_lemma") !== "false"; } catch (e) { return true; }
}
function setKbLemmaEnabled(on) {
  KB_USE_LEMMA = !!on;
  try { localStorage.setItem("lingua_use_lemma", on ? "true" : "false"); } catch (e) { /* ignore */ }
}
function getKbLemmaEnabled() { return KB_USE_LEMMA; }
/* 由书名查书籍语言（用于 lemmatize 选择英法规则） */
function bookLangOf(title) {
  if (typeof BOOKS !== "undefined" && Array.isArray(BOOKS)) {
    const b = BOOKS.find(x => x && x.title === title);
    if (b && b.language) return b.language;
  }
  return null;
}

/* 填充「按书筛选」下拉；每次书库/知识库变化时调用 */
function populateKbBookFilter() {
  const sel = document.getElementById("kb-book-filter");
  if (!sel) return;
  const books = (typeof BOOKS !== "undefined" && Array.isArray(BOOKS)) ? BOOKS : [];
  const keep = sel.value; // 尽量保留当前选择
  const counts = {};
  KB.forEach(e => { if (e.book) counts[e.book] = (counts[e.book] || 0) + 1; });
  // 收集所有有知识库的书（按书库顺序），以及知识库里有但书库已被删的书
  const seen = new Set();
  const opts = [{ v: "", label: "📚 全部书籍" }];
  books.forEach(b => {
    if (!b || !b.title) return;
    seen.add(b.title);
    if (counts[b.title]) opts.push({ v: b.title, label: `📖 ${b.title} (${counts[b.title]})` });
  });
  Object.keys(counts).forEach(t => { if (!seen.has(t)) opts.push({ v: t, label: `📖 ${t} (${counts[t]})` }); });
  sel.innerHTML = opts.map(o => `<option value="${escapeHtml(o.v)}">${escapeHtml(o.label)}</option>`).join("");
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  else sel.value = "";
  kbBookFilter = sel.value;
}

/* 书名归一化（用于把知识库条目关联到书库里的书） */
function normTitle(s) { return (s || "").trim().toLowerCase(); }

function newId(prefix) {
  const c = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : (prefix + Date.now() + Math.random());
  return prefix + "_" + c;
}

/* ---------- 浏览器本地兜底（localStorage） ----------
 * 与书籍兜底同款：即使后端暂时不可用 / 后端 store.json 被写坏重置，
 * 收藏的词汇、批注等也不会因刷新而丢失；联网后自动补传后端。 */
const KB_LS_KEY = "lr_kb_v1";
function backupKB() {
  try { localStorage.setItem(KB_LS_KEY, JSON.stringify(KB)); } catch (e) { /* 容量满忽略 */ }
}
function loadKbBackup() {
  try {
    const raw = localStorage.getItem(KB_LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/* ---------- 用户确认的原型（Lemma）覆盖表 ----------
 * key = `${lang}|${surfaceLower}` → 原型字符串。
 * 优先级：用户显式编辑 > AI 识别 > 本地 lemmatize。
 * 再次遇到相同词条时，优先使用此处已确认的原型，不再被 AI 覆盖。 */
const LEMMA_LS_KEY = "lr_lemma_overrides_v1";
let LEMMA_OVERRIDES = {};
function loadLemmaOverrides() {
  try {
    const raw = localStorage.getItem(LEMMA_LS_KEY);
    LEMMA_OVERRIDES = raw ? JSON.parse(raw) : {};
    if (!LEMMA_OVERRIDES || typeof LEMMA_OVERRIDES !== "object") LEMMA_OVERRIDES = {};
  } catch (e) { LEMMA_OVERRIDES = {}; }
}
function saveLemmaOverrides() {
  try { localStorage.setItem(LEMMA_LS_KEY, JSON.stringify(LEMMA_OVERRIDES)); } catch (e) { /* 容量满忽略 */ }
}
function lemmaOverrideKey(lang, surface) {
  return (lang || "?") + "|" + String(surface || "").trim().toLowerCase();
}
/* 取用户确认的原型：先查覆盖表，再回退 KB 中已确认原型的同形条目 */
function getLemmaOverride(lang, surface) {
  const key = lemmaOverrideKey(lang, surface);
  if (LEMMA_OVERRIDES[key]) return LEMMA_OVERRIDES[key];
  const sf = String(surface || "").trim().toLowerCase();
  if (!sf) return null;
  const hit = KB.find((e) => e.category === "vocabulary" && e.fields && e.fields.lemmaConfirmed && (function () {
    const f = e.fields;
    const s = (f.originalForm && String(f.originalForm).trim()) || (f.word && String(f.word).trim()) || "";
    return s.toLowerCase() === sf;
  })() && bookLangOf(e.book) === lang);
  return hit ? hit.fields.word : null;
}
/* 写入用户确认的原型：更新覆盖表 + 同步已有 KB 条目 + 异步备份到服务端 */
function setLemmaOverride(lang, surface, lemma) {
  if (!lang || !surface) return;
  const key = lemmaOverrideKey(lang, surface);
  const val = String(lemma || "").trim();
  if (!val) return;
  LEMMA_OVERRIDES[key] = val;
  saveLemmaOverrides();
  if (window.ApiClient) ApiClient.setLemmaOverride(key, val).catch(() => {});
  // 同步已有 KB 条目（同语言、同原文词形）改为新原型并标记已确认
  const sf = String(surface).trim().toLowerCase();
  KB.forEach((e) => {
    if (e.category !== "vocabulary") return;
    const f = e.fields || {};
    const s = (f.originalForm && String(f.originalForm).trim()) || (f.word && String(f.word).trim()) || "";
    if (s.toLowerCase() === sf && bookLangOf(e.book) === lang) {
      f.word = val;
      f.lemmaConfirmed = true;
      if (window.ApiClient) ApiClient.updateKb(e.id, { fields: f }).catch(() => {});
    }
  });
}
/* 服务端覆盖表合并到本地（云端 / 其他设备同步） */
function mergeServerLemmaOverrides(obj) {
  if (!obj || typeof obj !== "object") return;
  let changed = false;
  for (const k in obj) {
    if (obj[k] && !LEMMA_OVERRIDES[k]) { LEMMA_OVERRIDES[k] = obj[k]; changed = true; }
  }
  if (changed) saveLemmaOverrides();
}
loadLemmaOverrides();

/* 把本地备份里、服务端没有的条目并入内存并（联网时）补传到后端 */
function reconcileKB() {
  const backup = loadKbBackup();
  if (!backup.length) return;
  const have = new Set(KB.map((e) => e.id));
  const toUpload = [];
  backup.forEach((e) => {
    if (e && e.id && !have.has(e.id)) { KB.unshift(e); have.add(e.id); toUpload.push(e); }
  });
  toUpload.forEach((e) => {
    if (window.ApiClient) ApiClient.addKb(e).catch(() => {});
  });
  if (toUpload.length) renderKB(lastKbFilter);
  healKbLemmas();
}

/* ---------- 存量条目词形修复（一次性，幂等） ----------
 * 早期版本把动词变位直接存进了 KB / 导出。本函数把仍保留变位形式的
 * vocabulary 条目还原为原型（Lemma），原词形记入 originalForm。
 * 仅在确定书籍语言时执行，避免把英文词误判为法文。 */
function healKbLemmas() {
  if (!KB_USE_LEMMA || typeof lemmatize !== "function") return;
  let changed = 0;
  KB.forEach((e) => {
    const f = e.fields || {};
    if (e.category === "vocabulary" && f.word && !f.originalForm) {
      const lang = bookLangOf(e.book);
      if (!lang) return;
      const lemma = lemmatize(f.word, lang);
      if (lemma && lemma !== String(f.word).trim().toLowerCase()) {
        f.originalForm = f.word;
        f.word = lemma;
        changed++;
        if (window.ApiClient) ApiClient.updateKb(e.id, { fields: f }).catch(() => {});
      }
    }
  });
  if (changed) { backupKB(); renderKB(lastKbFilter); }
}

/* ---------- 从后端状态加载（内存缓存） ---------- */
function loadKB(arr) {
  KB = Array.isArray(arr) ? arr.slice() : [];
  backupKB();
  healKbLemmas();
  return KB;
}
/* 保留占位以兼容旧调用方；实际持久化由 ApiClient 完成 */
function saveKB() { /* no-op：增删改已实时同步后端 */ }

/* ---------- 条目增删（实时同步后端） ---------- */
function addEntry(entry) {
  entry.id = entry.id || newId("kb");
  entry.createdAt = entry.createdAt || new Date().toISOString();
  KB.unshift(entry);
  backupKB();
  if (window.ApiClient) ApiClient.addKb(entry).catch((e) => console.warn("保存笔记失败：", e.message));
  return entry;
}
function removeEntry(id) {
  KB = KB.filter((e) => e.id !== id);
  backupKB();
  if (window.ApiClient) ApiClient.deleteKb(id).catch(() => {});
}
/* 更新标签 / 笔记等字段 */
function updateKb(id, patch) {
  const e = KB.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  backupKB();
  if (window.ApiClient) ApiClient.updateKb(id, patch).catch(() => {});
}

/* 内联编辑原型（Lemma）：把 kb-main 替换为输入框，确认后更新条目 + 写覆盖表 */
function startLemmaEdit(id) {
  const e = KB.find((x) => x.id === id);
  if (!e) return;
  const item = document.querySelector('.kb-item[data-id="' + id + '"]');
  if (!item) return;
  const main = item.querySelector(".kb-main");
  if (!main) return;
  const f = e.fields || {};
  const cur = (f.word && String(f.word).trim()) || "";
  main.innerHTML = `<input class="kb-lemma-input" type="text" value="${escapeHtml(cur)}" />` +
    `<button class="kb-lemma-ok" data-id="${id}">✓</button>` +
    `<button class="kb-lemma-cancel" data-id="${id}">✕</button>`;
  const input = main.querySelector(".kb-lemma-input");
  input.focus(); input.select();
  main.querySelector(".kb-lemma-ok").addEventListener("click", (ev) => { ev.stopPropagation(); commitLemmaEdit(id, input.value); });
  main.querySelector(".kb-lemma-cancel").addEventListener("click", (ev) => { ev.stopPropagation(); renderKB(lastKbFilter); });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.stopPropagation(); commitLemmaEdit(id, input.value); }
    else if (ev.key === "Escape") { ev.stopPropagation(); renderKB(lastKbFilter); }
  });
}
function commitLemmaEdit(id, value) {
  const newLemma = String(value || "").trim();
  if (!newLemma) { renderKB(lastKbFilter); return; }
  const e = KB.find((x) => x.id === id);
  if (!e) return;
  const f = e.fields || {};
  const surface = (f.originalForm && String(f.originalForm).trim()) || (f.word && String(f.word).trim()) || "";
  const lang = bookLangOf(e.book);
  f.word = newLemma;
  f.lemmaConfirmed = true;
  if (!f.originalForm && surface && surface.toLowerCase() !== newLemma.toLowerCase()) f.originalForm = surface;
  updateKb(id, { fields: f });
  if (lang && surface) setLemmaOverride(lang, surface, newLemma);
  renderKB(lastKbFilter);
  if (typeof flash === "function") flash("已更新原型为「" + newLemma + "」（同类词条将自动沿用）");
}

/* 从分析结果构造并保存 */
function saveFromAnalysis(record, source, tags) {
  const data = record.data || {};
  // 词形还原优先级：用户已确认原型 > AI 返回原型 > 本地 lemmatize。
  // 用户确认的原型为最终结果，不再被 AI 覆盖。
  if (KB_USE_LEMMA && data.word && typeof lemmatize === "function") {
    const surface = String(data.word).trim();
    const lang = bookLangOf(source.book);
    let lemma = null;
    if (lang && surface) lemma = getLemmaOverride(lang, surface);           // 1) 用户已确认优先
    if (!lemma) {                                                          // 2) AI 返回原型（权威，已 WSD）
      lemma = (data.lemma && String(data.lemma).trim()) ? String(data.lemma).trim().toLowerCase() : null;
      if (!lemma || lemma === surface.toLowerCase()) lemma = lemmatize(surface, lang); // 3) 本地兜底
    }
    if (lemma && lemma !== surface.toLowerCase()) {
      data.originalForm = surface; // 保留原文词形（变位形式）
      data.word = lemma;           // 入库改为原型
      data.lemmaConfirmed = true;
    } else if (lemma && lemma === surface.toLowerCase()) {
      data.lemmaConfirmed = true;  // 原词即原型（用户/AI 确认）
    }
  }
  return addEntry({
    category: record.category,
    tags: tags && tags.length ? tags : (record.tags || []),
    fields: data,
    book: source.book || "",
    author: source.author || "",
    page: source.page || "",
    note: ""
  });
}

/* ---------- 展示字段提取 ---------- */
function entryTitle(e) {
  const f = e.fields || {};
  if (e.category === "annotation") return f.note || "（批注）";
  return f.word || f.expression || f.sentence || f.text || f.quote || "（未命名）";
}
function entrySubtitle(e) {
  const f = e.fields || {};
  if (e.category === "annotation") return f.quote || "";
  if (f.context) return f.context;
  if (f.meaning) return f.meaning;
  if (f.translation) return f.translation;
  if (f.grammar) return f.grammar.slice(0, 80) + (f.grammar.length > 80 ? "…" : "");
  if (f.text) return f.text.slice(0, 80) + (f.text.length > 80 ? "…" : "");
  return "";
}

/* 词典释义：把 [{dict, text}] 渲染成可读文本（含 string 兜底） */
function defsToText(defs) {
  if (!Array.isArray(defs) || !defs.length) return "";
  return defs.map(d => {
    if (typeof d === "string") return d;
    return `${d.dict || "词典"}：${d.text || ""}`;
  }).join("；");
}
/* 汇总知识库里出现过的所有词典名（用于导出时的词典筛选下拉） */
function collectDicts() {
  const set = new Set();
  KB.forEach(e => {
    const ds = (e.fields && e.fields.defs) || [];
    if (Array.isArray(ds)) ds.forEach(d => { if (d && d.dict) set.add(d.dict); });
  });
  return Array.from(set).sort();
}
/* 词典优先级 / 默认词典（全局，读取 USER_PREFS；USER_PREFS 在 app.js 定义，运行时可用） */
function buildFullDictList() {
  const set = new Set();
  if (typeof collectDicts === "function") collectDicts().forEach(d => set.add(d));
  if (typeof DICT_OPTIONS !== "undefined") DICT_OPTIONS.forEach(d => set.add(d.key));
  return Array.from(set).sort();
}
/* 当前词典优先级（有序数组）。用户未设置时退回「全部已知词典」顺序；
 * 用户已设置时保留其顺序，并把新出现（KB 里才有）的词典补到末尾，避免遗漏。 */
function getDictPriorityList() {
  const all = buildFullDictList();
  if (USER_PREFS && Array.isArray(USER_PREFS.dictPriority) && USER_PREFS.dictPriority.length) {
    const seen = new Set(USER_PREFS.dictPriority);
    const merged = USER_PREFS.dictPriority.slice();
    all.forEach(d => { if (!seen.has(d)) { merged.push(d); seen.add(d); } });
    return merged;
  }
  return all;
}
/* 默认词典 = 优先级第一位 */
function getDefaultDict() {
  const pri = getDictPriorityList();
  return pri.length ? pri[0] : null;
}
/* 按导出策略筛选 defs：
 *   strategy === "all"   ：仅保留用户在「词典来源」中勾选的词典（dicts 为空则全部）
 *   strategy === "default"：仅默认词典（若缺，按优先级自动补充下一本）
 *   strategy === "best"  ：按优先级取第一个有释义的词典，返回其第一条释义（一个最佳释义）
 */
function pickDefsByStrategy(defs, filter) {
  if (!Array.isArray(defs) || !defs.length) return [];
  const strat = (filter && filter.strategy) || "all";
  if (strat === "default" || strat === "best") {
    const pri = (filter && filter.priority) || getDictPriorityList();
    for (const dk of pri) {
      const ds = defs.filter(d => d && d.dict === dk);
      if (ds.length) return (strat === "best") ? [ds[0]] : ds;
    }
    return [];
  }
  const sel = (filter && filter.dicts) || null;
  if (sel && sel.length) return defs.filter(d => sel.indexOf(d.dict) !== -1);
  return defs;
}
/* 导出时把 defs 渲染成文本（按策略） */
function defsToTextForExport(defs, filter) {
  const picked = pickDefsByStrategy(defs, filter);
  if (!picked.length) return "";
  const strat = (filter && filter.strategy) || "all";
  if (strat === "best") {
    const d = picked[0];
    return `${d.text || ""}（来自 ${d.dict || "词典"}）`;
  }
  return picked.map(d => `${d.dict || "词典"}：${d.text || ""}`).join("；");
}
/* 导出时单字段的值格式化（defs 是对象数组，需特殊处理，否则会变成 [object Object]）
 * filter：导出筛选条件（含 strategy / dicts / priority）。非 defs 字段不受影响。 */
function formatFieldValue(k, v, filter) {
  if (k === "learningValue") return ""; // 导出不含 learning value
  if (k === "originalForm") return "";  // 原文词形由导出「显示原文词形」选项单独处理
  if (k === "lemmaConfirmed") return ""; // 原型确认内部标记，不导出
  if (k === "defs" && Array.isArray(v)) return defsToTextForExport(v, filter);
  if (Array.isArray(v)) return v.map(x => (typeof x === "object" ? JSON.stringify(x) : x)).join("；");
  if (v && typeof v === "object") return JSON.stringify(v);
  return v;
}
/* 导出「原文形式」辅助：仅当勾选「显示原文词形」且原词形 ≠ 原型时返回原词形 */
function originalFormText(f, filter) {
  if (filter && filter.showOriginalForm && f && f.originalForm &&
      String(f.originalForm).trim().toLowerCase() !== String(f.word || "").trim().toLowerCase()) {
    return f.originalForm;
  }
  return null;
}
/* 导出「释义/翻译」列：按策略筛选词典释义，回退通用副标题 */
function entryDefinition(e, filter) {
  const f = e.fields || {};
  const d = defsToTextForExport(f.defs, filter);
  if (d) {
    const strat = (filter && filter.strategy) || "all";
    if (strat === "all") {
      const extra = [f.meaning, f.translation].filter(Boolean).join("；");
      return extra ? d + "；" + extra : d;
    }
    return d; // default / best 模式已含词典来源标注
  }
  return entrySubtitle(e);
}

/* ---------- 词典偏好（可勾选显示哪些词典） ---------- */
let ENABLED_DICTS = null; // null => 显示全部
function setEnabledDicts(arr) {
  ENABLED_DICTS = (arr && arr.length) ? arr.slice() : null;
}
function filterDefs(defs) {
  if (!Array.isArray(defs)) return defs;
  if (!ENABLED_DICTS) return defs;
  return defs.filter((d) => ENABLED_DICTS.indexOf(d.dict) !== -1);
}
function fieldsToHtml(e) {
  const f = e.fields || {};
  const row = (k, v) => `<div class="fld"><span class="fld-k">${escapeHtml(k)}</span><span class="fld-v">${escapeHtml(v)}</span></div>`;
  const out = [];
  if (f.word) out.push(row("Word", f.word));
  if (Array.isArray(f.defs)) {
    const ds = filterDefs(f.defs);
    if (ds.length) {
      out.push(`<div class="fld"><span class="fld-k">Dictionary Definition</span><div class="fld-defs">` +
        ds.map((d) => `<div class="fld-def"><b>${escapeHtml(d.dict)}</b>：${escapeHtml(d.text || "")}</div>`).join("") + `</div></div>`);
    } else {
      out.push(`<div class="fld fld-muted">（已隐藏全部词典，可在 ⚙ 词典偏好 中开启）</div>`);
    }
  }
  if (f.context) out.push(row("Context Meaning", f.context));
  if (f.meaning) out.push(row("Meaning", f.meaning));
  if (f.usage) out.push(row("Usage", f.usage));
  if (f.example) out.push(row("Example", f.example));
  if (Array.isArray(f.similar) && f.similar.length) out.push(row("Similar Expression", f.similar.join("；")));
  if (f.translation) out.push(row("Translation", f.translation));
  if (Array.isArray(f.structure) && f.structure.length) out.push(row("Sentence Structure", f.structure.join("；")));
  if (f.grammar) out.push(row("Grammar", f.grammar));
  if (f.pattern) out.push(row("Transferable Pattern", f.pattern));
  if (f.writingUsage) out.push(row("Writing Usage", f.writingUsage));
  if (f.text) out.push(row("Text", f.text));
  if (f.summary) out.push(row("Summary", f.summary));
  if (f.rhetoric) out.push(row("Rhetoric", f.rhetoric));
  if (f.authorStyle) out.push(row("Author Style", f.authorStyle));
  if (Array.isArray(f.collocations) && f.collocations.length) out.push(row("Collocations", f.collocations.join("；")));
  if (Array.isArray(f.examples) && f.examples.length) out.push(row("Example Sentences", f.examples.join("；")));
  if (typeof f.learningValue === "boolean") out.push(row("Learning Value", f.learningValue ? "值得收藏" : "一般"));
  if (f.note) out.push(row("Note", f.note));
  return out.join("");
}

/* ---------- 渲染 ---------- */
function renderKB(filter) {
  const list = document.getElementById("kb-list");
  const stats = document.getElementById("kb-stats");
  const countEl = document.getElementById("kb-count");
  if (!list) return;

  const category = (typeof filter === "string" && filter) ? filter : (lastKbFilter || "all");
  lastKbFilter = category;

  // 组合过滤：分类 + 书名
  let items = KB;
  if (category !== "all") items = items.filter(e => e.category === category);
  if (kbBookFilter) items = items.filter(e => e.book === kbBookFilter);

  // 统计条：显示当前筛选结果的总览
  const cats = ["vocabulary", "expressions", "sentencePatterns", "beautifulSentences", "writingMaterials", "literary"];
  stats.innerHTML = cats.map(c => {
    const n = items.filter(e => e.category === c).length;
    return `<span class="kb-stat">${CATEGORY_LABEL[c].split(" ")[0]} · ${n}</span>`;
  }).join("");
  countEl.textContent = items.length + " 条";

  if (!items.length) {
    const catName = category === "all" ? "" : (CATEGORY_LABEL[category] || category);
    const bookName = kbBookFilter ? `《${kbBookFilter}》` : "";
    const hint = [catName, bookName].filter(Boolean).join(" · ") || "知识库";
    list.innerHTML = `<div class="kb-empty">${hint} 暂无条目。<br>选中原文后点「AI 分析」或「直接收藏」即可沉淀。</div>`;
    return;
  }
  paintKbItems(list, items);
}

/* 渲染知识库条目列表（书库分类 / 书籍分类共用） */
function paintKbItems(list, items, prefixHtml) {
  list.innerHTML = (prefixHtml || "") + items.map(e => {
    const tags = (e.tags || []).map(t => `<span class="kb-tag">${t}</span>`).join("");
    const src = [e.book, e.page].filter(Boolean).join(" · ");
    let extra = "";
    if (e.category === "annotation") {
      const at = (e.fields && e.fields.annotationType) || "其他";
      const exp = e.exportable !== false;
      extra = `<span class="kb-tag atype">${escapeHtml(at)}</span>` +
        `<button class="kb-exp-toggle${exp ? "" : " off"}" data-id="${e.id}" title="切换是否纳入导出">${exp ? "📤 导出" : "🚫 不导"}</button>`;
    }
    return `<div class="kb-item" data-id="${e.id}">
      <button class="kb-del" data-id="${e.id}" title="删除这条">✕</button>
      <div class="kb-cat">${CATEGORY_LABEL[e.category] || e.category}</div>
      ${e.category === "vocabulary" ? `<button class="kb-lemma-edit" data-id="${e.id}" title="编辑原型（Lemma）">✎ 原型</button>` : ""}
      <div class="kb-main">${escapeHtml(entryTitle(e))}</div>
      <div class="kb-sub">${escapeHtml(entrySubtitle(e))}</div>
      <div class="kb-tags">${tags}${extra}</div>
      ${src ? `<div class="kb-src">📌 ${escapeHtml(src)}</div>` : ""}
      <button class="kb-toggle" data-id="${e.id}">▸ 详情</button>
      <div class="kb-detail" id="kb-detail-${e.id}" style="display:none">${fieldsToHtml(e)}</div>
    </div>`;
  }).join("");
  list.querySelectorAll(".kb-toggle").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const d = document.getElementById("kb-detail-" + btn.dataset.id);
      if (!d) return;
      const open = d.style.display === "none";
      d.style.display = open ? "block" : "none";
      btn.textContent = open ? "▾ 收起" : "▸ 详情";
    });
  });
  // 批注：切换「是否纳入导出」
  list.querySelectorAll(".kb-exp-toggle").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      const e = KB.find(x => x.id === id);
      if (!e) return;
      const next = e.exportable === false; // 当前不导出 → 改为导出
      updateKb(id, { exportable: next });
      btn.textContent = next ? "📤 导出" : "🚫 不导";
      btn.classList.toggle("off", !next);
      if (typeof flash === "function") flash(next ? "已标记为「纳入导出」" : "已移出导出（导出时将跳过）");
    });
  });
  // 删除条目（带二次确认）
  list.querySelectorAll(".kb-del").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm("确定删除这条知识库条目吗？删除后不可恢复。")) return;
      removeEntry(id);
      renderKB(lastKbFilter);
      if (typeof flash === "function") flash("已删除该条目");
    });
  });
  // 编辑原型（Lemma）：词汇条目内联改成原型（用户确认后，同类词条自动沿用）
  list.querySelectorAll(".kb-lemma-edit").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      startLemmaEdit(btn.dataset.id);
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ---------- 导出 ---------- */
function download(filename, content, mime) {
  // 二进制内容（如 .docx 的 zip）直接 Blob，不加 charset；文本加 utf-8
  const blob = (content instanceof Uint8Array || content instanceof ArrayBuffer)
    ? new Blob([content], { type: mime })
    : new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/* ---------- 真正的 .docx 生成（OOXML，零依赖 zip store） ---------- */
// CRC32（用于 zip 校验）
function _crc32(buf) {
  let table = _crc32._t;
  if (!table) {
    table = _crc32._t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 生成 zip（store 不压缩），files: [{name, data: Uint8Array}]
function _makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const UF_UTF8 = 0x0800;
  files.forEach(f => {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc = _crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);          // version needed
    dv.setUint16(6, UF_UTF8, true);     // flags（UTF-8 文件名）
    dv.setUint16(8, 0, true);           // store
    dv.setUint16(10, 0, true);          // time
    dv.setUint16(12, 0x21, true);       // date 1980-01-01
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cen.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, UF_UTF8, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0x21, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + data.length;
  });
  let cdSize = 0;
  central.forEach(c => cdSize += c.length);
  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);
  chunks.push(...central, end);
  let total = 0;
  chunks.forEach(c => total += c.length);
  const out = new Uint8Array(total);
  let p = 0;
  chunks.forEach(c => { out.set(c, p); p += c.length; });
  return out;
}

function _xmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function _wRun(text, opt) {
  opt = opt || {};
  let rpr = "";
  let inner = "";
  if (opt.bold) inner += "<w:b/>";
  if (opt.italic) inner += "<w:i/>";
  if (opt.color) inner += `<w:color w:val="${opt.color}"/>`;
  if (opt.size) inner += `<w:sz w:val="${opt.size}"/>`;
  if (inner) rpr = `<w:rPr>${inner}</w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${_xmlEscape(text)}</w:t></w:r>`;
}
function _wPara(runs, style) {
  const inner = Array.isArray(runs) ? runs.join("") : runs;
  const ppr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${ppr}${inner}</w:p>`;
}

const _DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const _DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="word/styles.xml"/>
</Relationships>`;

const _DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Times New Roman"/><w:sz w:val="21"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="6C5CE7"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="00A884"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
</w:styles>`;

function _buildDocxXml(filter) {
  const by = kbByCategory(filter);
  let body = "";
  body += _wPara([_wRun("LinguaReader 个人知识库", { bold: true, size: "36", color: "6C5CE7" })]);
  body += _wPara([_wRun("导出时间：" + new Date().toLocaleString())]);
  const scope = exportScopeText(filter);
  if (scope) body += _wPara([_wRun("导出范围：", { bold: true }), _wRun(scope)]);
  const sec = {
    vocabulary: "词汇库 (Vocabulary)",
    expressions: "表达库 (Expressions)",
    sentencePatterns: "句型库 (Sentence Patterns)",
    beautifulSentences: "精彩句库 (Beautiful Sentences)",
    writingMaterials: "写作素材库 (Writing Materials)",
    literary: "文学笔记 (Literary Notes)",
    annotation: "批注 (Annotations)"
  };
  Object.keys(sec).forEach(cat => {
    if (filter && filter.cats && !filter.cats.has(cat)) return;
    body += _wPara([_wRun(sec[cat], { bold: true, size: "28", color: "00A884" })]);
    const items = by[cat];
    if (!items.length) { body += _wPara([_wRun("（暂无）", { italic: true })]); return; }
    items.forEach(e => {
      const f = e.fields || {};
      if (e.category === "annotation") {
        body += _wPara([_wRun(entryTitle(e), { bold: true, size: "24" })]);
        body += _wPara([_wRun("引用：", { bold: true }), _wRun(f.quote || "")]);
        body += _wPara([_wRun("批注：", { bold: true }), _wRun(f.note || "")]);
        body += _wPara([_wRun("分类：", { bold: true }), _wRun((f.annotationType || "其他") + " ｜ 来源：" + [e.book, e.author, e.page].filter(Boolean).join(" · "))]);
        return;
      }
      body += _wPara([_wRun(entryTitle(e), { bold: true, size: "24" })]);
      body += _wPara([_wRun("来源：", { bold: true }), _wRun([e.book, e.author, e.page].filter(Boolean).join(" · ")), _wRun(" ｜ 标签：", { bold: true }), _wRun((e.tags || []).join(", "))]);
      Object.keys(f).forEach(k => {
        const val = formatFieldValue(k, f[k], filter);
        if (!val) return; // 指定词典却无对应释义等情况下跳过空字段
        const label = (k === "defs") ? "词典释义" : k;
        body += _wPara([_wRun(label + "：", { bold: true }), _wRun(val)]);
      });
      const ofTxt = originalFormText(f, filter);
      if (ofTxt) body += _wPara([_wRun("原文形式：", { bold: true }), _wRun(ofTxt)]);
    });
  });
  body += `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/* 从导出弹窗读取筛选条件：
 *   books: Set<书名> | null（null=不过滤，即全选）
 *   cats:  Set<category> | null
 * 书籍复选框 value 为书名；"__none__" 表示 book 字段为空的条目。
 */
function getExportFilter() {
  const bookEls = document.querySelectorAll('#export-book-list input[type=checkbox]:checked');
  const catEls = document.querySelectorAll('#export-cat-list input[type=checkbox]:checked');
  const books = Array.from(bookEls).map(e => e.value);
  const cats = Array.from(catEls).map(e => e.value);
  const dictEls = document.querySelectorAll('#export-dict-list input[type=checkbox]:checked');
  const dicts = Array.from(dictEls).map(e => e.value);
  const stratEl = document.querySelector('input[name=exp-strategy]:checked');
  const strategy = stratEl ? stratEl.value : "all";
  const ofEl = document.getElementById("export-original-form");
  const showOriginalForm = !!(ofEl && ofEl.checked);
  const priority = (typeof getDictPriorityList === "function") ? getDictPriorityList() : null;
  const defaultDict = (typeof getDefaultDict === "function") ? getDefaultDict() : null;
  return {
    books: books.length ? new Set(books) : null,
    cats: cats.length ? new Set(cats) : null,
    dicts: dicts,
    strategy: strategy,
    priority: priority,
    defaultDict: defaultDict,
    showOriginalForm: showOriginalForm
  };
}
/* 预览导出内容（取前若干词汇条目，按当前筛选即时渲染） */
function buildExportPreview(filter, maxN) {
  maxN = maxN || 6;
  const items = KB.filter(e => e.category === "vocabulary" && passFilter(e, filter)).slice(0, maxN);
  if (!items.length) return "（词汇库为空，或无匹配内容）";
  return items.map(e => {
    const f = e.fields || {};
    const title = (f.word && f.word.trim()) || entryTitle(e);
    const def = defsToTextForExport(f.defs, filter);
    let line = `• ${title}`;
    if (def) line += `：${def}`;
    const of = originalFormText(f, filter);
    if (of) line += `  ［原文：${of}］`;
    return line;
  }).join("\n");
}
/* 单条是否通过筛选 */
function passFilter(e, filter) {
  if (e.exportable === false) return false; // 显式取消导出的条目（当前用于批注）永远跳过
  if (!filter) return true;
  if (filter.books) {
    const hit = filter.books.has(e.book) || (filter.books.has("__none__") && !e.book);
    if (!hit) return false;
  }
  if (filter.cats) {
    if (!filter.cats.has(e.category)) return false;
  }
  return true;
}
/* 文件名安全化 */
function safeName(s, n) {
  n = n || 24;
  return String(s).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, n).replace(/_+$/,"") || "知识库";
}
/* 导出范围说明（用于文件头/文件名） */
function exportScopeText(filter) {
  if (!filter) return "";
  const parts = [];
  if (filter.books) {
    const names = Array.from(filter.books).filter(x => x !== "__none__");
    const none = filter.books.has("__none__");
    let t = `书籍 ${names.length} 本` + (names.length && names.length <= 2 ? `（${names.join("、")}）` : "");
    if (none) t += " + 未指定";
    parts.push(t);
  }
  if (filter.cats) {
    const CAT_SHORT = { vocabulary:"词汇", expressions:"表达", sentencePatterns:"句型", beautifulSentences:"精彩句", writingMaterials:"写作素材", literary:"文学笔记" };
    const labels = Array.from(filter.cats).map(c => CAT_SHORT[c] || (CATEGORY_LABEL[c] || c).split(" ")[0]);
    parts.push(`类型 ${filter.cats.size} 类（${labels.join("/")}）`);
  }
  const s = filter.strategy || "all";
  if (s === "default") parts.push("仅默认词典" + (filter.defaultDict ? `（${filter.defaultDict}）` : ""));
  else if (s === "best") parts.push("每词最佳释义");
  else if (filter.dicts && filter.dicts.length) parts.push(`词典来源 ${filter.dicts.length} 个`);
  return parts.join(" · ");
}

/* 各库内容转行（已按 filter 过滤） */
function kbByCategory(filter) {
  const cats = ["vocabulary", "expressions", "sentencePatterns", "beautifulSentences", "writingMaterials", "literary", "annotation"];
  const out = {};
  cats.forEach(c => {
    let items = KB.filter(e => e.category === c);
    if (filter) items = items.filter(e => passFilter(e, filter));
    out[c] = items;
  });
  return out;
}

/* Markdown（全文 / Notion / Obsidian 变体） */
function buildMarkdown(variant, filter) {
  const by = kbByCategory(filter);
  const L = [];
  L.push("# LinguaReader 个人知识库");
  L.push(`> 导出时间：${new Date().toLocaleString()}`);
  const scope = exportScopeText(filter);
  if (scope) L.push(`> 导出范围：${scope}`);
  L.push("");
  if (variant === "obsidian") {
    L.push("## 📚 书籍");
    L.push("");
  }
  const sectionTitle = {
    vocabulary: "## 🔤 词汇库 (Vocabulary)",
    expressions: "## ✨ 表达库 (Expressions)",
    sentencePatterns: "## 🧩 句型库 (Sentence Patterns)",
    beautifulSentences: "## 🌟 精彩句库 (Beautiful Sentences)",
    writingMaterials: "## ✍️ 写作素材库 (Writing Materials)",
    literary: "## 📖 文学笔记 (Literary Notes)",
    annotation: "## 📝 我的批注 (Annotations)"
  };
  Object.keys(sectionTitle).forEach(cat => {
    if (filter && filter.cats && !filter.cats.has(cat)) return; // 跳过未选类型
    const items = by[cat];
    L.push(sectionTitle[cat]);
    if (!items.length) { L.push("_（暂无）_"); L.push(""); return; }
    items.forEach(e => {
      const f = e.fields || {};
      const title = entryTitle(e);
      const bookTag = (variant === "obsidian" && e.book) ? ` #${e.book.replace(/\s+/g, "")}` : "";
      // 批注：用友好标签呈现（引用 / 批注 / 分类）
      if (e.category === "annotation") {
        L.push(`### ${title}`);
        L.push(`- **引用**：${f.quote || ""}`);
        L.push(`- **批注**：${f.note || ""}`);
        L.push(`- **分类**：${f.annotationType || "其他"}`);
        L.push(`- **来源**：${[e.book, e.author, e.page].filter(Boolean).join(" · ")}`);
        if ((e.tags || []).length) L.push(`- **标签**：${(e.tags || []).join(", ")}`);
        L.push("");
        return;
      }
      L.push(`### ${title}`);
      L.push(`- **来源**：${[e.book, e.author, e.page].filter(Boolean).join(" · ")}`);
      L.push(`- **标签**：${(e.tags || []).join(", ")}`);
      Object.keys(f).forEach(k => {
        const label = (k === "defs") ? "词典释义" : k;
        const val = formatFieldValue(k, f[k], filter);
        if (!val) return;
        L.push(`- **${label}**：${val}`);
      });
      const ofTxt = originalFormText(f, filter);
      if (ofTxt) L.push(`- **原文形式**：${ofTxt}`);
      if (variant === "obsidian" && e.tags) L.push(`- #${e.tags.join(" #")}${bookTag}`);
      L.push("");
    });
  });
  return L.join("\n");
}

/* 导出文件名后缀：按「导出模式」标注，便于区分 */
function exportSuffix(filter) {
  if (!filter) return "";
  const s = filter.strategy || "all";
  if (s === "default") return "_默认词典" + (filter.defaultDict ? "_" + safeName(filter.defaultDict, 12) : "");
  if (s === "best") return "_最佳释义";
  // all 模式：若用户只勾选了部分来源词典，则标注
  const all = buildFullDictList();
  if (filter.dicts && filter.dicts.length && filter.dicts.length < all.length) {
    return "_" + filter.dicts.map(d => safeName(d, 8)).join("_");
  }
  return "";
}
function exportMarkdown(variant, filter) {
  const md = buildMarkdown(variant, filter);
  const scope = exportScopeText(filter);
  const bookSuffix = (filter && filter.books && filter.books.size === 1 && !filter.books.has("__none__"))
    ? "_" + safeName(Array.from(filter.books)[0]) : "";
  const dictSuffix = exportSuffix(filter);
  if (variant === "notion") download(`LinguaReader_KB${bookSuffix}${dictSuffix}_Notion.md`, md, "text/markdown");
  else if (variant === "obsidian") download(`LinguaReader_KB${bookSuffix}${dictSuffix}_Obsidian.md`, md, "text/markdown");
  else download(`LinguaReader_KB${bookSuffix}${dictSuffix}.md`, md, "text/markdown");
}

/* Excel / CSV（分库，每个被选中的库一个独立文件） */
function exportExcel(filter) {
  const by = kbByCategory(filter);
  const catFile = {
    vocabulary: "词汇库",
    expressions: "表达库",
    sentencePatterns: "句型库",
    beautifulSentences: "精彩句库",
    writingMaterials: "写作素材库",
    literary: "文学笔记",
    annotation: "批注"
  };
  let idx = 0;
  const bookSuffix = (filter && filter.books && filter.books.size === 1 && !filter.books.has("__none__"))
    ? "_" + safeName(Array.from(filter.books)[0]) : "";
  const dictSuffix = exportSuffix(filter);
  Object.keys(catFile).forEach(cat => {
    if (filter && filter.cats && !filter.cats.has(cat)) return; // 只导出被选中的库
    const items = by[cat];
    const showOF = !!(filter && filter.showOriginalForm);
    const header = ["内容", "释义/翻译", "标签", "来源书籍", "作者", "页码", "来源"];
    if (showOF) header.push("原文词形");
    const rows = [header];
    items.forEach(e => {
      const f = e.fields || {};
      const row = [
        entryTitle(e),
        entryDefinition(e, filter),
        (e.tags || []).join(" | "),
        e.book || "", e.author || "", e.page || "",
        CATEGORY_LABEL[cat] || cat
      ];
      if (showOF) row.push(originalFormText(f, filter) || "");
      rows.push(row);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    setTimeout(() => download(`LinguaReader_${catFile[cat]}${bookSuffix}${dictSuffix}.csv`, "﻿" + csv, "text/csv"), idx * 250);
    idx++;
  });
}

/* HTML（手机浏览器 / 微信直接预览，最稳的手机查看方式） */
function buildHtml(filter) {
  const by = kbByCategory(filter);
  const scope = exportScopeText(filter);
  const bookSuffix = (filter && filter.books && filter.books.size === 1 && !filter.books.has("__none__"))
    ? "_" + safeName(Array.from(filter.books)[0]) : "";
  let html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>LinguaReader 个人知识库</title>
    <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;max-width:820px;margin:0 auto;padding:20px;line-height:1.7;color:#222}h1{color:#6c5ce7}h2{color:#00a884;border-bottom:1px solid #eee;padding-bottom:6px;margin-top:32px}h3{margin:18px 0 6px}.scope{color:#555;background:#f5f3ff;padding:8px 12px;border-radius:8px;display:inline-block}em{color:#888}</style></head><body>
    <h1>LinguaReader 个人知识库</h1><p>导出时间：${new Date().toLocaleString()}</p>`;
  if (scope) html += `<p class="scope"><b>导出范围：</b>${scope}</p>`;
  const sec = {
    vocabulary: "词汇库 (Vocabulary)",
    expressions: "表达库 (Expressions)",
    sentencePatterns: "句型库 (Sentence Patterns)",
    beautifulSentences: "精彩句库 (Beautiful Sentences)",
    writingMaterials: "写作素材库 (Writing Materials)",
    literary: "文学笔记 (Literary Notes)",
    annotation: "批注 (Annotations)"
  };
  Object.keys(sec).forEach(cat => {
    if (filter && filter.cats && !filter.cats.has(cat)) return;
    html += `<h2>${sec[cat]}</h2>`;
    const items = by[cat];
    if (!items.length) { html += "<p><em>（暂无）</em></p>"; return; }
    items.forEach(e => {
      const f = e.fields || {};
      if (e.category === "annotation") {
        html += `<h3>${escapeHtml(entryTitle(e))}</h3>`;
        html += `<p><b>引用：</b>${escapeHtml(f.quote || "")}</p>`;
        html += `<p><b>批注：</b>${escapeHtml(f.note || "")}</p>`;
        html += `<p><b>分类：</b>${escapeHtml(f.annotationType || "其他")} ｜ <b>来源：</b>${[e.book, e.author, e.page].filter(Boolean).join(" · ")}</p>`;
        return;
      }
      html += `<h3>${escapeHtml(entryTitle(e))}</h3>`;
      html += `<p><b>来源：</b>${[e.book, e.author, e.page].filter(Boolean).join(" · ")} ｜ <b>标签：</b>${(e.tags || []).join(", ")}</p>`;
      Object.keys(f).forEach(k => {
        const label = (k === "defs") ? "词典释义" : k;
        const val = formatFieldValue(k, f[k], filter);
        if (!val) return;
        html += `<p><b>${label}：</b>${escapeHtml(val)}</p>`;
      });
      const ofTxt = originalFormText(f, filter);
      if (ofTxt) html += `<p><b>原文形式：</b>${escapeHtml(ofTxt)}</p>`;
    });
  });
  html += "</body></html>";
  return { html, bookSuffix };
}

function exportHtml(filter) {
  const { html, bookSuffix } = buildHtml(filter);
  const dictSuffix = exportSuffix(filter);
  download(`LinguaReader_KB${bookSuffix}${dictSuffix}.html`, html, "text/html");
}

/* Word —— 真正生成 .docx（OOXML zip），手机 Word / WPS / 微信均可打开 */
function exportWord(filter) {
  const bookSuffix = (filter && filter.books && filter.books.size === 1 && !filter.books.has("__none__"))
    ? "_" + safeName(Array.from(filter.books)[0]) : "";
  const dictSuffix = exportSuffix(filter);
  const enc = new TextEncoder();
  const zip = _makeZip([
    { name: "[Content_Types].xml", data: enc.encode(_DOCX_CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(_DOCX_RELS) },
    { name: "word/document.xml", data: enc.encode(_buildDocxXml(filter)) },
    { name: "word/styles.xml", data: enc.encode(_DOCX_STYLES) }
  ]);
  download(`LinguaReader_KB${bookSuffix}${dictSuffix}.docx`, zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}
