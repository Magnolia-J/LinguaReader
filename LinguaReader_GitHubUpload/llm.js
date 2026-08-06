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
  } catch (e) { /* ignore */ }
}

/* ---------- 配置解析（客户端优先，服务端 .env 兜底） ----------
 * provided: 前端随请求传入的用户自填配置 { apiKey, apiBase, model }；
 * 为空时回落到服务端环境变量（兼容旧版 .env 配置）。
 * 这样「开源模板」既能让用户在界面里填自己的密钥，也能让本地已有
 * .env 的用户继续免配置使用，且密钥绝不进入前端代码 / 仓库。 */
function resolveLLMEnv(provided) {
  const p = provided && typeof provided === "object" ? provided : {};
  return {
    apiKey: (p.apiKey && p.apiKey.trim()) || (process.env.LLM_API_KEY || "").trim() || "",
    apiBase: (p.apiBase && p.apiBase.trim()) || (process.env.LLM_API_BASE || "").trim() || "",
    model: (p.model && p.model.trim()) || (process.env.LLM_MODEL || "").trim() || ""
  };
}

function isLLMEnabled(provided) {
  const env = resolveLLMEnv(provided);
  return !!(env.apiKey);
}

// 便于单元测试注入 mock fetch
function setFetchForTest(fn) { globalThis.__llmFetch = fn; }

async function callLLM(messages, provided) {
  const fn = globalThis.__llmFetch || fetch;
  if (typeof fn !== "function") throw new Error("运行环境不支持 fetch");
  const env = resolveLLMEnv(provided);
  const base = (env.apiBase || "https://api.openai.com/v1").replace(/\/$/, "");
  const key = env.apiKey;
  const model = env.model || "gpt-4o-mini";
  if (!key) throw new Error("LLM 未配置（请在 ☁ 设置中填入你自己的 API Key）");
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

function buildAnalyzeMessages(text, type, language) {
  const lang = langName(language);
  let schema = "";
  let note = "";
  if (type === "word" || type === "phrase") {
    schema = `{
  "category": "vocabulary",
  "tags": ["Vocabulary"],
  "data": {
    "word": "原词",
    "defs": ${defsSchema(language)},
    "context": "当前语境含义（中文说明）",
    "collocations": ["高频搭配1", "高频搭配2"],
    "examples": ["自然例句（含中文译文）"],
    "learningValue": true
  }
}`;
    note = "词汇模式：给出权威词典释义（法文须同时引用 Le Robert、Larousse、CNRTL 三家法法词典，释义用法语）、语境义、搭配、例句，并判断 learningValue（是否值得收藏）。";
  } else if (type === "expression") {
    schema = `{
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
    note = "表达检测：识别地道表达 / 习语 / 学术短语 / 文学表达，给出含义、用法、例句、相似表达。";
  } else if (type === "sentence") {
    schema = `{
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
    note = "句法分析：给出自然译文、句子结构、语法讲解、可迁移句型、写作用法。若句子极具文学性，可把 category 改为 beautifulSentences 并加标签 Beautiful Sentence / Literary Analysis。";
  } else {
    schema = `{
  "category": "writingMaterials",
  "tags": ["Writing Material"],
  "data": {
    "text": "原文段落（可节选）",
    "summary": "段落主旨（中文）",
    "rhetoric": "修辞与情感效果（中文）",
    "authorStyle": "作者风格标记（中文）"
  }
}`;
    note = "段落 / 文学分析：归纳主旨、修辞、情感效果与作者风格。";
  }

  return [
    { role: "system", content: COMMON_ROLE + "\n\n本次任务：对一段" + lang + "文本做「" + note + "」分析。\n请严格按如下 JSON Schema 输出：\n" + schema },
    { role: "user", content: "类型：" + type + "\n" + lang + "原文：\n" + text }
  ];
}

function buildAnnotateMessages(bookTitle, language, chapterTitle, text) {
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
  return [
    {
      role: "system",
      content: COMMON_ROLE +
        "\n\n本次任务：从一段" + lang + "文学原文中提取「高价值、值得个人收藏」的知识条目，建立用户的语言知识库。" +
        "条目类型尽量多样：若干词汇（vocabulary）、若干地道表达（expressions）、若干精彩/典范句子（sentencePatterns 或 beautifulSentences）。" +
        "每条都要基于原文、真实有用，不要编造。\n请严格按如下 JSON 数组 Schema 输出（6–10 条）：\n" + schema
    },
    {
      role: "user",
      content: "书名：《" + bookTitle + "》  章节：" + chapterTitle + "\n" + lang + "原文：\n" + text
    }
  ];
}

/* ---------- 对外接口 ---------- */
async function analyzeRecord(text, type, language, provided) {
  const msgs = buildAnalyzeMessages(text, type, language);
  const content = await callLLM(msgs, provided);
  const obj = extractJSON(content);
  if (!obj || !obj.category || !obj.data || typeof obj.data !== "object" || !Object.keys(obj.data).length) throw new Error("LLM 返回结构不符合预期");
  return { category: obj.category, tags: obj.tags || [], data: obj.data };
}

async function annotateRecords(book, cap, provided) {
  const language = book.language === "fr" ? "fr" : "en";
  const results = [];
  const chapters = (book.chapters || []).slice(0, 12);
  for (const ch of chapters) {
    if (results.length >= cap) break;
    const text = (ch.paragraphs || []).join("\n\n").slice(0, 3500);
    if (text.length < 80) continue;
    try {
      const msgs = buildAnnotateMessages(book.title, language, ch.title || "", text);
      const content = await callLLM(msgs, provided);
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
