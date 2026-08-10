/* =========================================================
 * LinguaReader Workspace · LLM 集成
 * 支持任意 OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / 智谱 /
 * 腾讯混元 等）。通过环境变量配置，未配置时由外部回退到骨架。
 *
 * 关键设计：
 *  - 让 LLM 直接输出与前端分析引擎一致的 JSON 记录
 *    { category, tags, data }，后端再复用 toBlocks 渲染。
 *  - 严格约束 JSON 形状，并提供容错解析 extractJSON。
 * ========================================================= */

/* ---------- 配置（读取 process.env，可被 .env 覆盖） ---------- */
function loadEnv() {
  try {
    const fs = require("fs");
    const p = require("path").join(__dirname, ".env");
    if (!fs.existsSync(p)) return;
    const txt = fs.readFileSync(p, "utf8");
    txt.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
    // 兼容别名：用户可用更通用的变量名，效果与 LLM_* 一致
    const aliases = {
      LLM_API_KEY: "OPENAI_API_KEY",
      LLM_API_BASE: "API_BASE_URL",
      LLM_MODEL: "MODEL_NAME",
    };
    for (const [canon, alias] of Object.entries(aliases)) {
      if (!process.env[canon] && process.env[alias]) process.env[canon] = process.env[alias];
    }
  } catch (e) { /* ignore */ }
}

function isLLMEnabled() {
  return !!(process.env.LLM_API_KEY && process.env.LLM_API_KEY.trim());
}

// 便于单元测试注入 mock fetch
function setFetchForTest(fn) { globalThis.__llmFetch = fn; }

async function callLLM(messages) {
  const fn = globalThis.__llmFetch || fetch;
  if (typeof fn !== "function") throw new Error("运行环境不支持 fetch");
  const base = (process.env.LLM_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const resp = await fn(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      messages,
      temperature: Number(process.env.LLM_TEMPERATURE || 0.3),
      max_tokens: Number(process.env.LLM_MAX_TOKENS || 1400)
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("LLM HTTP " + resp.status + ": " + t.slice(0, 200));
  }
  const j = await resp.json();
  // 观测 DeepSeek 前缀缓存命中情况，便于验证 prompt cache 优化是否生效
  if (j && j.usage) {
    const hit = j.usage.prompt_cache_hit_tokens;
    if (typeof hit === "number") console.log("[llm] prompt_cache_hit_tokens=" + hit + " / prompt_tokens=" + (j.usage.prompt_tokens != null ? j.usage.prompt_tokens : "?"));
  }
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
}

/* ---------- JSON 容错提取 ---------- */
function extractJSON(str) {
  if (!str) throw new Error("empty response");
  let s = String(str).trim();
  // 去掉代码围栏
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const firstBracket = s.search(/[[{]/);
  if (firstBracket === -1) throw new Error("no json found");
  const open = s[firstBracket];
  const close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = firstBracket; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
    }
  }
  if (end === -1) throw new Error("unbalanced json");
  return JSON.parse(s.slice(firstBracket, end + 1));
}

/* ---------- Prompt 构建 ---------- */
const COMMON_ROLE = `你是 LinguaReader Workspace 的 AI 核心助手，帮助用户阅读、理解、分析外文（英文 / 法文）原版书籍，并建立个人化的语言知识库。
核心原则：
1. 不直接翻译，要解释语言背后的逻辑与可迁移表达。
2. 优先帮助用户积累可用于写作的表达、句型与词汇。
3. 保留原文出处信息。
4. 所有输出必须是结构化、可用于数据库存储的 JSON。
5. 法文词汇的词典释义（defs）必须用目标语言法语给出（法法词典），并尽量同时引用 Le Robert、Larousse、CNRTL 三家释义；英文则用目标语言英文，优先 Oxford / Cambridge。语境义（context）可用中文说明。
6. 【上下文优先】所有分析必须优先结合用户提供的「完整句子」做语境判断，禁止仅依据单词本身或词典默认释义。若单词存在多词性（名词 / 动词 / 形容词等），必须先结合句法结构判断当前真实词性，再做解释（词性消歧 WSD）。
7. 【动词必须给原型】若识别为动词变位，必须在输出中包含原型（lemma）、时态 / 语式 / 人称，以及该句中的实际含义。知识库与导出内容统一保存原型动词，不要保存变位形式。
8. 释义必须以当前语境为准，只输出最符合本句的含义；如存在歧义，可简要说明为何选择该词性。
9. 【严格按选区分析】用户选中了什么，你就完整分析什么。绝不允许自动截断、扩展、缩减或重新划分用户选区；无论是单词、短语、完整句子、长复合句、多个句子还是跨行文本，都必须作为完整输入处理。若输入较长，系统会自动分段后合并，你只需完整分析「当前这一段」，不要遗漏其中任何部分。系统可能额外提供「语境参考」字段，它仅供你理解/词性消歧，**绝不是你的分析对象**，严禁对语境参考做任何分析或把它纳入输出。
10. 若你返回的内容未覆盖用户选区的全部要点，系统会自动要求你重新分析；请务必一次性完整覆盖，不要省略。
始终遵循：上下文 → 词性判断 → 原型识别 → 释义输出。
只输出 JSON，不要任何解释、前言或代码围栏。`;

function langName(l) { return l === "fr" ? "法语" : "英语"; }

/* 词汇模式 defs 模板：法文给 Le Robert / Larousse / CNRTL 三家法法词典，
   英文给 Oxford。要求用目标语言给出释义（法法词典 = 法语释义）。 */
function defsSchema(language) {
  const lang = langName(language);
  if (lang === "法语") {
    return `[
      { "dict": "Le Robert", "text": "法文权威释义（用目标语言法语给出，并标注词性 n.m./adj./loc. 等）" },
      { "dict": "Larousse", "text": "法文释义（拉鲁斯法法词典，用目标语言法语给出）" },
      { "dict": "CNRTL", "text": "补充释义（法语语料库，用目标语言法语给出）" }
    ]`;
  }
  return `[ { "dict": "Oxford Dictionary", "text": "权威目标语言释义" } ]`;
}

/* ---------- 固定任务模板（按 type 固定；语言相关部分按 (type,language) 记忆化，
   保证连续请求的 user 前缀一致 → 提升 DeepSeek prompt_cache_hit_tokens） ---------- */
const ANALYZE_NOTES = {
  word: "词汇模式：先结合语境做词性消歧（WSD），再输出权威词典释义（法文须同时引用 Le Robert、Larousse、CNRTL 三家法法词典，释义用法语）、原型 lemma、词性 pos、动词信息 verbInfo、语境义、语法作用、搭配、例句，并判断 learningValue（是否值得收藏）。动词变位必须给原型。",
  phrase: "短语模式：针对用户选中的短语，给出短语整体含义、构成拆解、搭配与例句，并判断 learningValue（是否值得收藏）。",
  expression: "表达检测：识别地道表达 / 习语 / 学术短语 / 文学表达，给出含义、用法、例句、相似表达。",
  sentence: "句法分析：给出自然译文、句子结构、语法讲解、可迁移句型、写作用法。若句子极具文学性，可把 category 改为 beautifulSentences 并加标签 Beautiful Sentence / Literary Analysis。",
  paragraph: "段落 / 文学分析：归纳主旨、修辞、情感效果与作者风格。"
};

function buildAnalyzeSchema(type, language) {
  if (type === "word" || type === "phrase") {
    return `{
  "category": "vocabulary",
  "tags": ["Vocabulary"],
  "data": {
    "word": "原词（用户选中的词形，可能是变位形式）",
    "lemma": "原型：动词变位务必给不定式；名词给单数原形；形容词给阳性单数原形",
    "pos": "词性：动词 / 名词 / 形容词 / 副词 / 介词 / 代词 / 连词 / 冠词 …",
    "verbInfo": "若 pos 为动词：『时态 / 语式 / 人称 + 本句实际含义』；非动词填 null",
    "defs": ${defsSchema(language)},
    "context": "当前语境含义（中文说明，必须贴合本句）",
    "grammarRole": "该词在句中的语法作用（主语 / 宾语 / 表语 / 定语 / 状语 …）",
    "collocations": ["高频搭配1", "高频搭配2"],
    "examples": ["自然例句（含中文译文）"],
    "learningValue": true
  }
}`;
  } else if (type === "expression") {
    return `{
  "category": "expressions",
  "tags": ["Native Expression"],
  "data": {
    "expression": "原表达",
    "meaning": "含义（中文）",
    "usage": "用法与适用场景（中文）",
    "example": "例句（含中文译文）",
    "similar": ["相似表达1", "相似表达2"]
  }
}`;
  } else if (type === "sentence") {
    return `{
  "category": "sentencePatterns",
  "tags": ["Sentence Pattern"],
  "data": {
    "sentence": "原句",
    "translation": "自然中文译文",
    "structure": ["主语：…", "谓语：…", "宾语：…", "修饰：…", "从句：…"],
    "grammar": "语法讲解（时态/从句/语态 + 作者为何这样表达），中文",
    "pattern": "可迁移句型（用 [占位] 表示变量）",
    "writingUsage": "写作迁移建议，中文"
  }
}`;
  }
  return `{
  "category": "writingMaterials",
  "tags": ["Writing Material"],
  "data": {
    "text": "原文段落（可节选）",
    "summary": "段落主旨（中文）",
    "rhetoric": "修辞与情感效果（中文）",
    "authorStyle": "作者风格标记（中文）"
  }
}`;
}

/* 按 (type,language) 记忆化任务模板：同一组合永远返回完全相同的字符串，
   使连续请求的 prompt 前缀稳定，最大化 DeepSeek 前缀缓存命中。 */
const _analyzeTaskCache = new Map();
function getAnalyzeTask(type, language) {
  const key = type + "|" + language;
  if (_analyzeTaskCache.has(key)) return _analyzeTaskCache.get(key);
  const note = ANALYZE_NOTES[type] || ANALYZE_NOTES.paragraph;
  const schema = buildAnalyzeSchema(type, language);
  const block = "本次任务：对一段" + langName(language) + "文本做「" + note + "」分析。\n请严格按如下 JSON Schema 输出：\n" + schema;
  _analyzeTaskCache.set(key, block);
  return block;
}

/* 构建分析消息：
   - System 角色【完全固定】= COMMON_ROLE，绝不在前缀中拼接任何动态内容（语言/类型/schema/retry）。
   - User 角色：固定任务模板 → 语境参考(仅当前句±2~3句) → 待分析选区(最后，最易变) → 重试说明(最末)。
   这样连续请求拥有相同的 prompt 前缀，且最易变的选区文本位于末尾，最大化 prompt_cache_hit_tokens。 */
function buildAnalyzeMessages(text, type, language, context, retry) {
  const taskBlock = getAnalyzeTask(type, language); // 按 (type,language) 固定
  const ctxPart = (context && String(context).trim())
    ? ("\n\n—— 语境参考（仅用于词性消歧与理解，绝不是分析对象，请勿对其做分析）：——\n" + String(context).trim())
    : "";
  const retryPart = retry
    ? "\n\n【重要重试】你上一次返回未完整覆盖用户选区的全部内容。请务必完整分析下面【待分析选区】提供的全部文本，逐词 / 逐句覆盖，不得省略、截断或仅解释其中一部分。"
    : "";
  const user = taskBlock + ctxPart + "\n\n—— 待分析选区（请完整分析下面全部内容，不得截断、扩展或重新划分）：——\n" + text + retryPart;
  return [
    { role: "system", content: COMMON_ROLE },
    { role: "user", content: user }
  ];
}

/* 按 language 记忆化批注任务模板（与单条分析同理，保证 system 固定 + user 前缀稳定） */
const _annotateTaskCache = new Map();
function getAnnotateTask(language) {
  if (_annotateTaskCache.has(language)) return _annotateTaskCache.get(language);
  const lang = langName(language);
  const schema = `[
  {
    "category": "vocabulary",
    "tags": ["Vocabulary"],
    "data": { "word":"原词", "defs":${defsSchema(language)}, "context":"语境义", "collocations":["搭配"], "examples":["例句"], "learningValue":true }
  },
  {
    "category": "expressions",
    "tags": ["Native Expression"],
    "data": { "expression":"原表达", "meaning":"含义", "usage":"用法", "example":"例句", "similar":["相似"] }
  },
  {
    "category": "sentencePatterns",
    "tags": ["Sentence Pattern"],
    "data": { "sentence":"原句", "translation":"译文", "structure":["主谓宾…"], "grammar":"讲解", "pattern":"可迁移句型", "writingUsage":"写法建议" }
  }
]`;
  const block = "本次任务：从一段" + lang + "文学原文中提取「高价值、值得个人收藏」的知识条目，建立用户的语言知识库。" +
    "条目类型尽量多样：若干词汇（vocabulary）、若干地道表达（expressions）、若干精彩/典范句子（sentencePatterns 或 beautifulSentences）。" +
    "每条都要基于原文、真实有用，不要编造。\n请严格按如下 JSON 数组 Schema 输出（6–10 条）：\n" + schema;
  _annotateTaskCache.set(language, block);
  return block;
}

function buildAnnotateMessages(bookTitle, language, chapterTitle, text) {
  const taskBlock = getAnnotateTask(language); // 按 language 固定
  // System 完全固定 = COMMON_ROLE；批注指令与 schema 放入 user 消息，原文放最后
  const user = taskBlock + "\n\n书名：《" + bookTitle + "》  章节：" + chapterTitle + "\n" + langName(language) + "原文：\n" + text;
  return [
    { role: "system", content: COMMON_ROLE },
    { role: "user", content: user }
  ];
}

/* ---------- 对外接口 ---------- */
async function analyzeRecord(text, type, language, context, retry) {
  const msgs = buildAnalyzeMessages(text, type, language, context, retry);
  const content = await callLLM(msgs);
  const obj = extractJSON(content);
  if (!obj || !obj.category || !obj.data || typeof obj.data !== "object" || !Object.keys(obj.data).length) throw new Error("LLM 返回结构不符合预期");
  // 规整 lemma：确保动词变位被还原为原型；若 LLM 未给 lemma 但有 word，留空由前端兜底
  if (obj.data && obj.data.word && !obj.data.lemma) obj.data.lemma = null;
  return { category: obj.category, tags: obj.tags || [], data: obj.data };
}

async function annotateRecords(book, cap) {
  const language = book.language === "fr" ? "fr" : "en";
  const results = [];
  const chapters = (book.chapters || []).slice(0, 12);
  for (const ch of chapters) {
    if (results.length >= cap) break;
    const text = (ch.paragraphs || []).join("\n\n").slice(0, 3500);
    if (text.length < 80) continue;
    try {
      const msgs = buildAnnotateMessages(book.title, language, ch.title || "", text);
      const content = await callLLM(msgs);
      const arr = extractJSON(content);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (results.length >= cap) break;
          if (item && item.data && item.category) {
            results.push({
              category: item.category,
              tags: item.tags || [],
              data: item.data,
              book: book.title,
              author: book.author,
              page: ch.title || ""
            });
          }
        }
      }
    } catch (e) {
      console.warn("批注章节失败（已跳过）：", e.message);
    }
  }
  return results;
}

module.exports = { loadEnv, isLLMEnabled, setFetchForTest, callLLM, extractJSON, buildAnalyzeMessages, buildAnnotateMessages, analyzeRecord, annotateRecords };
