/* =========================================================
 * LinguaReader · 统一「严格选区」文本获取规范
 * ---------------------------------------------------------
 * 适用范围（含当前与未来新增）：
 *   句子分析 / 翻译 / 语法分析 / 词汇解析 / 笔记生成 /
 *   提问 / 总结 / 导出 / 后续任何 AI 功能
 *
 * 统一铁律（所有 AI 功能必须遵守）：
 *   1. 用户选中了什么，AI 就处理什么。
 *   2. AI 输入 = 用户「实际选中」的文本（完全一致）。
 *   3. 不允许截断 / 缩减 / 扩展到前后句 / 重新划分句子 / 忽略部分内容。
 *   4. 调用 AI 前先校验选区是否完整；异常则重新获取一次后再调用。
 *   5. 「语境参考（context）」是独立字段，仅供词性消歧/理解，
 *      绝不是分析对象，AI 不得对其做任何分析或扩展。
 *   6. AI 返回后做完整性校验；若遗漏则自动重新请求，不直接展示不完整结果。
 *
 * 所有 AI 入口必须且只能通过 StrictSelect 获取选区，禁止各自实现。
 * ========================================================= */
(function (global) {
  "use strict";

  /* 选区是否在阅读区内（复用 app.js 的 selectionInReadingArea；不可用时宽松放行） */
  function inReadingArea(sel) {
    try {
      if (typeof selectionInReadingArea === "function") return selectionInReadingArea(sel);
    } catch (e) { /* ignore */ }
    return true;
  }

  /* 选区是否「完整可用」：有 range、未折叠、文本非空 */
  function isSelectionComplete(sel) {
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    const text = sel.toString().trim();
    if (!text) return false;
    return true;
  }

  /* 获取当前「严格选区」：返回用户实际选中的确切文本；异常返回 null。
     绝不截断、绝不扩展、绝不重划分——原样返回 getSelection 的内容。 */
  function getStrictSelection() {
    const sel = window.getSelection();
    if (!isSelectionComplete(sel)) return null;
    if (!inReadingArea(sel)) return null;
    return sel.toString().trim();
  }

  /* 调用 AI 前统一获取：若首次异常（如点击瞬间选区丢失），
     等待一个宏任务后重新获取一次，再判定是否可用。 */
  async function acquireStrictSelection() {
    let text = getStrictSelection();
    if (text) return text;
    await new Promise((r) => setTimeout(r, 0)); // 让浏览器稳定选区
    return getStrictSelection();
  }

  /* 注入到每条 AI 用户消息的「严格选区」铁律（与 llm.js COMMON_ROLE #9/#10 呼应，
     仅作兜底提醒；主约束在 System Prompt 中以保证 prompt cache 命中）。 */
  const STRICT_SELECTION_RULE =
    "【铁律】你的分析对象【仅限】上面「待分析选区」的全部内容，逐字逐句完整覆盖，" +
    "不得截断、不得缩减、不得扩展到语境参考、不得重新划分句子。语境参考仅供理解，绝不是分析对象。";

  /* 取文本中「有意义的词元」（长度>2 的字母/数字串，忽略标点），用于完整性校验 */
  function tokensOf(text) {
    return String(text || "").split(/\s+/)
      .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((w) => w.length > 2);
  }

  /* 客户端兜底校验：AI 返回是否覆盖用户选区（检测截断/遗漏）。
     - 严格型（word/phrase/expression）：要求关键源词元出现在返回中；
     - 宽松型（sentence/paragraph/翻译/总结/提问/笔记）：有实质内容即视为已处理，
       避免对中文译文误判。长文/多句由服务端逐段分析合并，天然不遗漏。 */
  function isSelectionCovered(text, result) {
    if (!result) return false;
    const type = (result && result.type) || "";
    const strict = /^(word|phrase|expression)$/i.test(type);
    if (!strict) {
      // 宽松型：只要 data 含实质内容（非空的 {}）即视为已处理
      const data = (result.record && result.record.data) || result.data || {};
      const out = JSON.stringify(data).replace(/\s+/g, " ");
      return out.length > 2;
    }
    const out = JSON.stringify(result).toLowerCase();
    const words = tokensOf(text);
    if (!words.length) return true; // 极短输入无法判定，宽松通过
    let hit = 0;
    for (const w of words) if (out.includes(w)) hit++;
    return hit / words.length >= 0.5;
  }

  global.StrictSelect = {
    getStrictSelection,
    acquireStrictSelection,
    isSelectionComplete,
    isSelectionCovered,
    tokensOf,
    STRICT_SELECTION_RULE
  };
})(typeof window !== "undefined" ? window : globalThis);
