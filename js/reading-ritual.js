/* =========================================================
 * LinguaReader · 阅读欢迎 & 读完纪念（独立组件）
 * ---------------------------------------------------------
 * 设计目标：
 *  - 自包含：自带样式（浅绿主题）、HTML、逻辑，方便单独维护文案/样式/触发。
 *  - 本地优先：完成记录存 localStorage（lr_completions_v1），不依赖 Supabase。
 *  - 防重复：欢迎同一次启动只显示一次；同一本书完成只记录/弹窗一次；
 *           刷新或重开不会重复记录同一次完成（以持久化记录为准）。
 *  - 温柔、克制、有仪式感，轻绿卡片，圆角，轻微入场动画，无音效。
 *
 * 对外 API（window.ReadingRitual）：
 *   init({ getBooks, getReadingSeconds, onContinue })
 *   setContext({ bookId, chapterIndex, chapterCount })   // 当前书/章变化时由 app.js 调用
 *   clearContext()                                        // 当前书被移除时调用
 *   showWelcomeOnce()                                     // 启动后调用一次
 *   onReadingScroll()                                     // 阅读区滚动时调用（检测读完）
 *   maybeComplete()                                       // 主动触发一次检测（可选）
 *   isCompleted(bookId) / completedCount()                // 查询
 * ========================================================= */
const ReadingRitual = (function () {
  "use strict";

  const LS_COMPLETIONS = "lr_completions_v1";

  /* ---------- 完成弹窗寄语库（内置、随机、克制温柔） ---------- */
  const QUOTES = [
    "读完一本书，不是结束，而是它开始在你心里慢慢发生。",
    "愿你读过的文字，最后都变成自己的风景。",
    "一本书的终点，也可以是下一段阅读的起点。",
    "慢慢读，慢慢长成自己喜欢的样子。",
    "你读过的每一本书，都会悄悄成为你的一部分。",
    "合上书页的那一刻，有些东西已经在心里生了根。",
    "读过的句子会忘，但被它轻轻改变过的你不会。",
    "安静地读完一本，也是认真生活的一种方式。",
    "今天读完的，是别人写的故事，也是你自己的片刻。",
    "让阅读像呼吸一样，轻一点，再轻一点。",
  ];

  /* ---------- 运行期状态 ---------- */
  let _getBooks = () => [];
  let _getReadingSeconds = () => 0;
  let _onContinue = null;
  let _ctx = null;                 // { bookId, chapterIndex, chapterCount }
  let _welcomeShown = false;       // 同一次启动只显示一次欢迎
  let _welcomeData = null;         // 本次启动选定的（书+书摘），期间不变
  const _completionSessionShown = new Set();  // 本次启动已弹过完成弹窗的 bookId
  const _openOverlays = {};        // id -> overlay 元素（避免重复叠加）

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, m =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function pick(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function uid() {
    return "rr-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- 日期 / 问候 ---------- */
  function formatDate(d) {
    const wd = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 · " + wd[d.getDay()];
  }
  function greeting() {
    const h = new Date().getHours();
    if (h < 11) return "早上好";
    if (h < 18) return "下午好";
    return "晚上好";
  }

  /* ---------- 阅读时长中文格式化（复用系统 READING.seconds，不新建数据） ---------- */
  function fmtReadingCN(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + " 秒";
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return s ? (m + " 分钟 " + s + " 秒") : (m + " 分钟");
    const h = Math.floor(m / 60), rm = m % 60;
    return rm ? (h + " 小时 " + rm + " 分钟") : (h + " 小时");
  }

  /* ---------- 书摘抽取：仅来自书库真实正文 ---------- */
  function stripTags(s) {
    return String(s == null ? "" : s).replace(/<[^>]*>/g, " ");
  }
  function collectParagraphs(book) {
    const out = [];
    (book.chapters || []).forEach(ch => {
      (ch.paragraphs || []).forEach(p => {
        if (typeof p === "string" && p.trim()) out.push(p);
      });
    });
    return out;
  }
  // 把一段正文拆成「完整、有意义」的句子（保留句末标点）
  function splitSentences(text) {
    const segs = text.match(/[^.!?]+[.!?]+[\]\)’”'»”]*|[^.!?]+$/g);
    if (segs) return segs.map(s => s.trim()).filter(Boolean);
    return [text.trim()].filter(Boolean);
  }
  function extractSentences(book) {
    const sentences = [];
    try {
      collectParagraphs(book).forEach(para => {
        let t = stripTags(para).replace(/\r/g, " ").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
        if (!t) return;
        splitSentences(t).forEach(seg => {
          const letters = (seg.match(/[A-Za-zÀ-ÿ0-9一-鿿]/g) || []).length;
          // 长度门槛：去掉过短碎片与过长段落；需有实质字符
          if (seg.length >= 28 && seg.length <= 340 && letters >= 8) sentences.push(seg);
        });
      });
    } catch (e) { /* 任何异常都回退普通欢迎，不报错 */ }
    return sentences;
  }

  /* ---------- 完成记录：localStorage 优先，不依赖 Supabase ---------- */
  function loadCompletions() {
    try {
      const raw = localStorage.getItem(LS_COMPLETIONS);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveCompletions(arr) {
    try { localStorage.setItem(LS_COMPLETIONS, JSON.stringify(arr)); } catch (e) { /* 容量满忽略 */ }
  }
  function isCompleted(bookId) {
    if (!bookId) return false;
    return loadCompletions().some(c => String(c.bookId) === String(bookId));
  }
  function completedCount() {
    const set = new Set(loadCompletions().map(c => String(c.bookId)));
    return set.size; // 同一本书只计一次，重复阅读不重复计数
  }
  // 记录一次完成；返回完成序号（第 X 本）。已存在则只返回序号、不再新增。
  function recordCompletion(bookId, totalReadingTime) {
    const list = loadCompletions();
    const exist = list.find(c => String(c.bookId) === String(bookId));
    if (exist) return exist.completedOrder;
    const order = completedCount() + 1;
    list.push({
      bookId: String(bookId),
      completedAt: new Date().toISOString(),
      completedOrder: order,
      totalReadingTime: Math.round(totalReadingTime || 0),
    });
    saveCompletions(list);
    return order;
  }

  /* ---------- DOM 根 & 样式注入（自包含，浅绿主题） ---------- */
  function ensureRoot() {
    let root = document.getElementById("reading-ritual-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "reading-ritual-root";
      document.body.appendChild(root);
    }
    return root;
  }
  function injectStyle() {
    if (document.getElementById("reading-ritual-style")) return;
    const css = `
#reading-ritual-root{position:fixed;inset:0;z-index:9999;pointer-events:none;}
.rr-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  padding:20px;background:rgba(46,78,58,.16);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  pointer-events:auto;opacity:0;transition:opacity .22s ease;}
.rr-overlay.rr-show{opacity:1;}
.rr-card{width:min(430px,92vw);box-sizing:border-box;text-align:center;color:#2f4734;
  background:linear-gradient(180deg,#f4faf4 0%,#eaf6ec 100%);
  border:1px solid rgba(122,180,140,.55);border-radius:22px;padding:28px 26px 24px;
  box-shadow:0 12px 44px rgba(40,90,60,.20);position:relative;
  transform:translateY(12px) scale(.98);opacity:0;
  transition:transform .28s cubic-bezier(.2,.8,.3,1),opacity .28s ease;}
.rr-overlay.rr-show .rr-card{transform:translateY(0) scale(1);opacity:1;}
.rr-leaf{font-size:26px;line-height:1;margin-bottom:6px;opacity:.9;}
.rr-greeting{margin:4px 0 2px;font-size:21px;font-weight:700;letter-spacing:.4px;color:#356b47;}
.rr-date{font-size:13.5px;color:#6f8d78;margin-bottom:14px;letter-spacing:.3px;}
.rr-quote-wrap{margin:6px 0 4px;}
.rr-label{display:inline-block;font-size:12px;color:#5b9172;background:rgba(122,180,140,.16);
  border:1px solid rgba(122,180,140,.4);border-radius:999px;padding:2px 12px;margin-bottom:10px;letter-spacing:.5px;}
.rr-quote{margin:0;padding:0 6px;font-size:16px;line-height:1.7;color:#34503c;font-style:italic;
  word-break:break-word;white-space:pre-wrap;}
.rr-quote--center{text-align:center;}
.rr-quote--soft{font-style:normal;color:#5f7d68;}
.rr-attrib{margin-top:10px;font-size:13.5px;color:#5b9172;text-align:right;padding-right:4px;}
.rr-hint{margin-top:14px;font-size:13.5px;color:#6f8d78;line-height:1.65;}
.rr-actions{display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap;}
.rr-btn{flex:1 1 auto;min-width:120px;max-width:200px;border:none;border-radius:12px;padding:11px 16px;
  font-size:14.5px;font-weight:600;cursor:pointer;transition:transform .12s ease,background .15s ease,box-shadow .15s ease;}
.rr-btn:active{transform:scale(.97);}
.rr-btn-primary{background:linear-gradient(180deg,#7cc196,#5fae7c);color:#fff;
  box-shadow:0 4px 14px rgba(95,174,124,.35);}
.rr-btn-primary:hover{background:linear-gradient(180deg,#74bb8f,#56a573);}
.rr-btn-ghost{background:transparent;color:#4f7d61;border:1px solid rgba(95,174,124,.5);}
.rr-btn-ghost:hover{background:rgba(122,180,140,.12);}
.rr-badge{display:inline-block;font-size:12.5px;font-weight:600;color:#fff;
  background:linear-gradient(180deg,#7cc196,#5fae7c);border-radius:999px;padding:4px 14px;
  letter-spacing:.5px;box-shadow:0 3px 10px rgba(95,174,124,.3);margin-bottom:12px;}
.rr-title{margin:2px 0 6px;font-size:22px;font-weight:700;color:#356b47;letter-spacing:.4px;}
.rr-book{font-size:17px;font-weight:600;color:#34503c;margin:2px 0 6px;}
.rr-count{font-size:14.5px;color:#4f7d61;margin-bottom:12px;}
.rr-check{color:#3f9d63;font-weight:700;}
.rr-time{font-size:13.5px;color:#6f8d78;margin:10px 0 2px;letter-spacing:.3px;}
@media (max-width:480px){
  .rr-card{padding:24px 18px 20px;border-radius:18px;}
  .rr-greeting{font-size:19px;}
  .rr-quote{font-size:15px;}
  .rr-btn{min-width:0;flex:1 1 100%;max-width:none;}
  .rr-actions{gap:8px;}
}`;
    const style = document.createElement("style");
    style.id = "reading-ritual-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---------- 通用弹窗开关 ---------- */
  function openOverlay(id, html) {
    const root = ensureRoot();
    closeOverlay(id); // 同 id 不叠加
    const overlay = document.createElement("div");
    overlay.className = "rr-overlay";
    overlay.dataset.rrId = id;
    overlay.innerHTML = html;
    root.appendChild(overlay);
    _openOverlays[id] = overlay;

    // 关闭交互：背景点击 / 关闭按钮 / Esc
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeOverlay(id);
    });
    overlay.querySelectorAll("[data-rr-close]").forEach(btn =>
      btn.addEventListener("click", () => closeOverlay(id)));
    const onKey = (e) => { if (e.key === "Escape") { closeOverlay(id); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);

    // 触发入场动画
    void overlay.offsetWidth;
    requestAnimationFrame(() => overlay.classList.add("rr-show"));
    return overlay;
  }
  function closeOverlay(id) {
    const overlay = _openOverlays[id];
    if (!overlay) return;
    overlay.classList.remove("rr-show");
    delete _openOverlays[id];
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
  }

  /* ---------- 欢迎弹窗 ---------- */
  function buildWelcomeData() {
    let books = [];
    try { books = _getBooks() || []; } catch (e) { books = []; }
    if (!books.length) return { empty: true };
    const book = pick(books);
    if (!book) return { empty: true };
    const sentences = extractSentences(book);
    if (!sentences.length) return { empty: true }; // 无可用原文 → 普通欢迎，不报错
    return { empty: false, book, quote: pick(sentences) };
  }
  function renderWelcome() {
    const data = _welcomeData || buildWelcomeData();
    _welcomeData = data;
    const dateText = formatDate(new Date());
    const greet = greeting() + "，今天也读一点吧";
    let inner;
    if (data.empty) {
      inner = `
        <div class="rr-leaf" aria-hidden="true">🌿</div>
        <h2 class="rr-greeting">${esc(greet)}</h2>
        <div class="rr-date">${esc(dateText)}</div>
        <div class="rr-quote-wrap">
          <blockquote class="rr-quote rr-quote--soft">书架还空着，先去添一本书，让阅读慢慢开始吧。</blockquote>
        </div>
        <div class="rr-hint">今天也读一点，让思想慢慢发生。</div>`;
    } else {
      inner = `
        <div class="rr-leaf" aria-hidden="true">🌿</div>
        <h2 class="rr-greeting">${esc(greet)}</h2>
        <div class="rr-date">${esc(dateText)}</div>
        <div class="rr-quote-wrap">
          <div class="rr-label">今日书摘</div>
          <blockquote class="rr-quote">${esc(data.quote)}</blockquote>
          <div class="rr-attrib">—— 《${esc(data.book.title)}》</div>
        </div>
        <div class="rr-hint">愿今天的阅读，也成为你生活里安静而美好的一部分。</div>`;
    }
    const html = `<div class="rr-card rr-welcome">${inner}
        <div class="rr-actions">
          <button class="rr-btn rr-btn-primary" data-rr-start>开始阅读</button>
        </div>
      </div>`;
    const overlay = openOverlay("welcome", html);
    const startBtn = overlay.querySelector("[data-rr-start]");
    if (startBtn) startBtn.addEventListener("click", () => closeOverlay("welcome"));
  }
  function showWelcomeOnce() {
    if (_welcomeShown) return;
    _welcomeShown = true;
    // 延迟一帧，确保工作台已渲染完成、阅读区就绪
    requestAnimationFrame(() => renderWelcome());
  }

  /* ---------- 完成检测 & 完成弹窗 ---------- */
  function atBookEnd() {
    const area = document.getElementById("reading-area");
    if (!area) return false;
    if (area.scrollHeight <= area.clientHeight) {
      // 末章内容不足一屏：需用户确有滚动/交互才会被 onReadingScroll 触发，这里仅判位置
      return area.scrollHeight - area.scrollTop - area.clientHeight <= 12;
    }
    return area.scrollTop + area.clientHeight >= area.scrollHeight - 12;
  }
  // 由 app.js 在阅读区滚动时调用；仅在「最后一章 + 滚到正文实际末尾」时判定读完
  function onReadingScroll() { maybeComplete(); }
  function maybeComplete() {
    if (!_ctx || !_ctx.bookId) return;
    // 必须真在最后一章
    if (!(_ctx.chapterCount > 0 && _ctx.chapterIndex === _ctx.chapterCount - 1)) return;
    if (!atBookEnd()) return;
    const bookId = _ctx.bookId;
    if (isCompleted(bookId)) return;           // 已记录过 → 不重复
    if (_completionSessionShown.has(bookId)) return; // 本次启动已弹过 → 不重复
    const seconds = Math.round((typeof _getReadingSeconds === "function" ? _getReadingSeconds(bookId) : 0) || 0);
    const order = recordCompletion(bookId, seconds);   // 先持久化（刷新/重开都不会重复）
    _completionSessionShown.add(bookId);
    let book = null;
    try { book = (_getBooks() || []).find(b => String(b.id) === String(bookId)); } catch (e) {}
    renderCompletion(book || { title: "（这本书）" }, order, seconds);
  }
  function renderCompletion(book, order, seconds) {
    const quote = pick(QUOTES);
    const timeBlock = seconds > 0
      ? `<div class="rr-time">累计阅读：${esc(fmtReadingCN(seconds))}</div>` : "";
    const html = `<div class="rr-card rr-complete">
        <div class="rr-badge">阅读完成 ✓</div>
        <h2 class="rr-title">恭喜你，读完了！</h2>
        <div class="rr-book">《${esc(book.title)}》</div>
        <div class="rr-count">这是你读完的第 ${order} 本书 <span class="rr-check">✓</span></div>
        <blockquote class="rr-quote rr-quote--center">${esc(quote)}</blockquote>
        ${timeBlock}
        <div class="rr-hint">下一本书，也许正在等你。</div>
        <div class="rr-actions">
          <button class="rr-btn rr-btn-primary" data-rr-continue>继续阅读其他书</button>
          <button class="rr-btn rr-btn-ghost" data-rr-close>关闭</button>
        </div>
      </div>`;
    const overlay = openOverlay("complete", html);
    const contBtn = overlay.querySelector("[data-rr-continue]");
    if (contBtn) contBtn.addEventListener("click", () => {
      closeOverlay("complete");
      if (typeof _onContinue === "function") { try { _onContinue(); } catch (e) {} }
    });
  }

  /* ---------- 对外 API ---------- */
  function init(opts) {
    opts = opts || {};
    if (typeof opts.getBooks === "function") _getBooks = opts.getBooks;
    if (typeof opts.getReadingSeconds === "function") _getReadingSeconds = opts.getReadingSeconds;
    if (typeof opts.onContinue === "function") _onContinue = opts.onContinue;
    injectStyle();
    ensureRoot();
  }
  function setContext(ctx) { _ctx = ctx || null; }
  function clearContext() { _ctx = null; }

  return {
    init,
    setContext,
    clearContext,
    showWelcomeOnce,
    onReadingScroll,
    maybeComplete,
    isCompleted,
    completedCount,
    // 调试用
    _extractSentences: extractSentences,
    _buildWelcomeData: buildWelcomeData,
  };
})();

if (typeof window !== "undefined") window.ReadingRitual = ReadingRitual;
