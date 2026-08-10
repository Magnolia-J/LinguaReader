/* =========================================================
 * LinguaReader Workspace · 划线 / 批注系统（独立组件）
 *
 * 设计原则（对应「PDF 导入」需求的第十、十一条）：
 *  - 划线 / 批注都绑定到文本位置，而非视觉坐标：
 *      { id, chapterIdx, paraIdx, startOff, endOff, text, color,
 *        note, kbId, annotationType, exportable, createdAt }
 *    - book_id 由各书对象自身携带（book.marks 挂在书对象上）
 *    - chapterIdx / paraIdx / startOff / endOff 可在重新渲染后精确定位
 *  - 划线与批注对 TXT / EPUB / PDF 一视同仁（都只是「章节→段落→字符偏移」）。
 *  - 所有修改只通过 ApiClient.updateBook(book.id, { marks }) 持久化，
 *    服务端以「客户端为准」整体替换 marks（保证删除也能传播）。
 *  - 重新打开书籍 / 刷新页面：marks 已随书对象持久化，render 时原样套回。
 *
 * 渲染采用「按字符偏移重建 <p> innerHTML」的方式（而非 Range.surroundContents），
 * 天然支持同一段落内多条划线、且不会因 DOM 结构变化而抛错，最稳健。
 * ========================================================= */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function uid(prefix) {
    return (prefix || "mk") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  /* 取书对象的 marks 数组（确保存在） */
  function marksOf(book) {
    if (!book) return [];
    if (!Array.isArray(book.marks)) book.marks = [];
    return book.marks;
  }

  /* ---- 操作历史栈：划线 / 删除 / 批注 均支持撤销与重做 ---- */
  function cloneMark(m) {
    return {
      id: m.id, chapterIdx: m.chapterIdx, paraIdx: m.paraIdx,
      startOff: m.startOff, endOff: m.endOff, text: m.text,
      color: m.color, note: m.note, kbId: m.kbId,
      annotationType: m.annotationType, exportable: m.exportable,
      createdAt: m.createdAt
    };
  }
  function snapshotMarks(book) {
    const arr = marksOf(book);
    return arr.map(cloneMark);
  }
  function findBook(bookId) {
    return window.BOOKS && window.BOOKS.find(b => b.id === bookId);
  }
  const History = {
    stack: [], index: -1, limit: 50,
    push(entry) {
      this.stack = this.stack.slice(0, this.index + 1);
      this.stack.push(entry);
      if (this.stack.length > this.limit) { this.stack.shift(); }
      else { this.index++; }
    },
    canUndo() { return this.index >= 0; },
    canRedo() { return this.index < this.stack.length - 1; },
    peek() { return this.canUndo() ? this.stack[this.index] : null; },
    undo() {
      if (!this.canUndo()) return false;
      const entry = this.stack[this.index];
      const book = findBook(entry.bookId);
      if (book) {
        book.marks = entry.before.map(cloneMark);
        persist(book);
        render(book, currentChapterOf(book));
      }
      this.index--;
      return true;
    },
    redo() {
      if (!this.canRedo()) return false;
      this.index++;
      const entry = this.stack[this.index];
      const book = findBook(entry.bookId);
      if (book) {
        book.marks = entry.after.map(cloneMark);
        persist(book);
        render(book, currentChapterOf(book));
      }
      return true;
    }
  };

  /* ---- 选区 → 偏移列表（支持跨多个 <p>） ---- */
  // chapterIdx 由调用方传入（当前章）；每个 <p> 需带 data-pidx。
  function captureSelection(chapterIdx) {
    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return [];
      const range = sel.getRangeAt(0);
      if (range.collapsed) return [];
      const area = document.getElementById("reading-area");
      if (!area) return [];
      const ps = Array.prototype.slice.call(area.querySelectorAll("p[data-pidx]"));
      const out = [];
      for (const p of ps) {
        if (!range.intersectsNode || !range.intersectsNode(p)) continue;
        const len = p.textContent.length;
        if (!len) continue;
        const startInside = p.contains(range.startContainer);
        const endInside = p.contains(range.endContainer);
        let sOff = startInside ? offsetIn(p, range.startContainer, range.startOffset) : 0;
        let eOff = endInside ? offsetIn(p, range.endContainer, range.endOffset) : len;
        sOff = Math.max(0, Math.min(len, sOff));
        eOff = Math.max(0, Math.min(len, eOff));
        if (eOff <= sOff) continue;
        const text = p.textContent.slice(sOff, eOff).trim();
        if (!text) continue;
        out.push({ chapterIdx: chapterIdx, paraIdx: parseInt(p.dataset.pidx, 10) || 0, startOff: sOff, endOff: eOff, text: text });
      }
      return out;
    } catch (e) { return []; }
  }

  function offsetIn(p, container, offset) {
    try {
      const r = document.createRange();
      r.selectNodeContents(p);
      r.setEnd(container, offset);
      return r.toString().length;
    } catch (e) { return 0; }
  }

  /* ---- 渲染：把某章的 marks 套回对应 <p> ---- */
  function render(book, chapterIdx) {
    const area = document.getElementById("reading-area");
    if (!area) return;
    const marks = marksOf(book).filter(m => m.chapterIdx === chapterIdx);
    const ps = Array.prototype.slice.call(area.querySelectorAll("p[data-pidx]"));
    ps.forEach(p => {
      const pid = parseInt(p.dataset.pidx, 10) || 0;
      const list = marks.filter(m => m.paraIdx === pid);
      if (!list.length) {
        // 段落内若残留旧 <mark>（理论上不会，因每次整体重建），清掉
        if (!p.querySelector("mark")) return;
      }
      const text = p.textContent; // 原文（mark 不改变 textContent）
      if (!list.length) { if (p.querySelector("mark")) p.textContent = text; return; }
      p.innerHTML = rebuildHtml(text, list);
    });
  }

  // 按字符偏移把文本切成普通段 + <mark> 段；重叠时后段跳过已覆盖部分
  function rebuildHtml(text, list) {
    const sorted = list.slice().sort((a, b) => a.startOff - b.startOff);
    let html = "", cursor = 0;
    for (const m of sorted) {
      let s = Math.max(0, m.startOff | 0);
      let e = Math.min(text.length, m.endOff | 0);
      if (e <= cursor) continue;            // 已被覆盖，跳过
      s = Math.max(s, cursor);              // 不回退到已覆盖区域之前
      if (s > cursor) html += esc(text.slice(cursor, s));
      const seg = text.slice(s, e);
      const cls = "lr-mark" + (m.note ? " has-note" : "") + (m.color ? " " + m.color : "");
      html += '<mark class="' + cls + '" data-mark-id="' + esc(m.id) + '">' + esc(seg) + "</mark>";
      cursor = e;
    }
    if (cursor < text.length) html += esc(text.slice(cursor));
    return html || esc(text);
  }

  /* ---- 创建划线 / 批注 mark ---- */
  function createMarks(book, offsetsList, opts) {
    const list = Array.isArray(offsetsList) ? offsetsList : (offsetsList ? [offsetsList] : []);
    const before = snapshotMarks(book);
    const created = [];
    list.forEach(o => {
      if (!o || typeof o.startOff !== "number" || typeof o.endOff !== "number") return;
      const m = {
        id: uid("mk"),
        chapterIdx: o.chapterIdx,
        paraIdx: o.paraIdx,
        startOff: o.startOff,
        endOff: o.endOff,
        text: o.text || "",
        color: (opts && opts.color) || "",
        note: (opts && opts.note) || "",
        kbId: (opts && opts.kbId) || null,
        annotationType: (opts && opts.annotationType) || "",
        exportable: opts && typeof opts.exportable === "boolean" ? opts.exportable : true,
        createdAt: new Date().toISOString()
      };
      marksOf(book).push(m);
      created.push(m);
    });
    if (created.length) {
      History.push({
        bookId: book.id,
        description: "划线 " + created.length + " 处",
        before: before,
        after: snapshotMarks(book),
        createdIds: created.map(m => m.id)
      });
      persist(book); render(book, currentChapterOf(book, created[0]));
    }
    return created;
  }

  function setMarkAnnotation(book, markId, kbId, note, annotationType, exportable) {
    const m = marksOf(book).find(x => x.id === markId);
    if (!m) return false;
    const before = snapshotMarks(book);
    if (kbId !== undefined) m.kbId = kbId;
    if (note !== undefined) m.note = note;
    if (annotationType !== undefined) m.annotationType = annotationType;
    if (exportable !== undefined) m.exportable = exportable;
    History.push({
      bookId: book.id,
      description: note ? "修改批注" : "添加批注",
      before: before,
      after: snapshotMarks(book),
      markId: markId
    });
    persist(book);
    render(book, m.chapterIdx);
    return true;
  }

  function removeMark(book, markId) {
    const arr = marksOf(book);
    const idx = arr.findIndex(x => x.id === markId);
    if (idx < 0) return null;
    const before = snapshotMarks(book);
    const [removed] = arr.splice(idx, 1);
    History.push({
      bookId: book.id,
      description: "删除划线",
      before: before,
      after: snapshotMarks(book),
      removedMark: cloneMark(removed)
    });
    persist(book);
    render(book, removed.chapterIdx);
    return removed;
  }

  function currentChapterOf(book, mark) {
    // marks 渲染依赖调用方当前章；这里尽量用全局 currentChapter（app.js 暴露）
    return (typeof window !== "undefined" && typeof window.currentChapter === "number") ? window.currentChapter : (mark ? mark.chapterIdx : 0);
  }

  /* ---- 持久化（防抖） ---- */
  let _timer = null;
  function persist(book) {
    if (!book || !window.ApiClient) return;
    const id = book.id;
    const marks = book.marks ? book.marks.slice() : [];
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(() => {
      window.ApiClient.updateBook(id, { marks: marks, updateTime: new Date().toISOString() })
        .catch(() => {});
    }, 250);
  }

  /* ---- 标点菜单（删除 / 写批注 / 编辑批注） ---- */
  let menuEl = null;
  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement("div");
    menuEl.id = "mark-menu";
    menuEl.className = "mark-menu hidden";
    menuEl.innerHTML =
      '<button data-act="note" class="mm-btn">✍ 批注</button>' +
      '<button data-act="edit" class="mm-btn">✎ 编辑</button>' +
      '<button data-act="del" class="mm-btn mm-del">🗑 删除</button>';
    document.body.appendChild(menuEl);
    menuEl.addEventListener("click", e => {
      const btn = e.target.closest(".mm-btn");
      if (!btn) return;
      const id = menuEl.dataset.markId;
      const book = menuEl.dataset.bookId ? (window.BOOKS && window.BOOKS.find(b => b.id === menuEl.dataset.bookId)) : null;
      hideMenu();
      if (!id || !book) return;
      const act = btn.dataset.act;
      const mark = book.marks && book.marks.find(m => m.id === id);
      if (act === "del") {
        const removed = removeMark(book, id);
        if (removed && removed.kbId && window.ApiClient) window.ApiClient.deleteKb(removed.kbId).catch(() => {});
        if (window.flash) flash("已删除划线");
      } else if (act === "note" && mark) {
        if (window.openAnnotationForMark) window.openAnnotationForMark(mark, false);
      } else if (act === "edit" && mark) {
        if (window.openAnnotationForMark) window.openAnnotationForMark(mark, true);
      }
    });
    return menuEl;
  }
  function showMenu(markEl, mark, book) {
    const menu = ensureMenu();
    menu.dataset.markId = mark.id;
    menu.dataset.bookId = book.id;
    // 仅在有 note（已是批注）时显示「编辑」
    const editBtn = menu.querySelector('[data-act="edit"]');
    if (editBtn) editBtn.style.display = mark.note ? "" : "none";
    const noteBtn = menu.querySelector('[data-act="note"]');
    if (noteBtn) noteBtn.textContent = mark.note ? "✍ 改批注" : "✍ 批注";
    menu.classList.remove("hidden");
    const r = markEl.getBoundingClientRect();
    let left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left + r.width / 2 - menu.offsetWidth / 2));
    let top = r.bottom + 6;
    if (top + menu.offsetHeight > window.innerHeight) top = r.top - menu.offsetHeight - 6;
    menu.style.left = left + "px";
    menu.style.top = Math.max(8, top) + "px";
  }
  function hideMenu() { if (menuEl) menuEl.classList.add("hidden"); }

  /* ---- Undo / Redo 提示与键盘 shortcut ---- */
  let undoToastEl = null, undoToastTimer = null;
  function showUndoToast(count, onUndo) {
    hideUndoToast();
    undoToastEl = document.createElement("div");
    undoToastEl.id = "lr-undo-toast";
    undoToastEl.innerHTML = '<span>已划线 ' + esc(String(count)) + ' 处</span>' +
      '<button class="lr-undo-btn" data-act="undo">撤销</button>' +
      '<button class="lr-undo-close" data-act="close" aria-label="关闭">×</button>';
    document.body.appendChild(undoToastEl);
    undoToastEl.addEventListener("click", e => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "undo" && typeof onUndo === "function") onUndo();
      hideUndoToast();
    });
    if (undoToastTimer) clearTimeout(undoToastTimer);
    undoToastTimer = setTimeout(hideUndoToast, 4500);
  }
  function hideUndoToast() {
    if (undoToastTimer) { clearTimeout(undoToastTimer); undoToastTimer = null; }
    if (undoToastEl && undoToastEl.parentNode) undoToastEl.parentNode.removeChild(undoToastEl);
    undoToastEl = null;
  }
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }
  function onKeyUndo(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      if (History.canUndo()) { e.preventDefault(); History.undo(); flashStatus("已撤销：" + (History.peek() ? History.peek().description : "")); }
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      if (History.canRedo()) { e.preventDefault(); History.redo(); flashStatus("已重做：" + (History.peek() ? History.peek().description : "")); }
    }
  }
  function flashStatus(msg) {
    if (typeof window.flash === "function") window.flash(msg);
    else if (window.console) console.log(msg);
  }

  /* ---- 初始化：委托点击 .lr-mark ---- */
  function init() {
    ensureMenu();
    const area = document.getElementById("reading-area");
    if (area) {
      area.addEventListener("click", e => {
        const markEl = e.target.closest && e.target.closest(".lr-mark");
        if (!markEl) return;
        const id = markEl.dataset.markId;
        const book = window.BOOKS && window.BOOKS.find(b => b.id === window.currentBookId);
        if (!book) return;
        const mark = book.marks && book.marks.find(m => m.id === id);
        if (!mark) return;
        e.preventDefault();
        showMenu(markEl, mark, book);
      });
    }
    // 点击别处关闭菜单
    document.addEventListener("mousedown", e => {
      if (menuEl && !menuEl.contains(e.target) && !(e.target.closest && e.target.closest(".lr-mark"))) hideMenu();
      if (undoToastEl && !undoToastEl.contains(e.target)) hideUndoToast();
    });
    // 全局撤销 / 重做快捷键（输入框内不拦截）
    document.addEventListener("keydown", e => {
      if (isTypingTarget(e.target)) return;
      onKeyUndo(e);
    });
  }

  /* ---- 创建 / 升级划线（重叠则合并，避免重复 mark） ---- */
  // 用于「写批注」：若选区与已有 mark 同段且范围重叠，则升级该 mark（保留 id），否则新建。
  function upsertFromOffsets(book, list, opts) {
    const arr = marksOf(book);
    const before = snapshotMarks(book);
    const touched = [];
    (list || []).forEach(o => {
      if (!o || typeof o.startOff !== "number" || typeof o.endOff !== "number") return;
      const existing = arr.find(m =>
        m.chapterIdx === o.chapterIdx && m.paraIdx === o.paraIdx &&
        m.startOff < o.endOff && m.endOff > o.startOff); // 同段且范围重叠
      if (existing) {
        if (opts) {
          if (opts.kbId !== undefined) existing.kbId = opts.kbId;
          if (opts.note !== undefined) existing.note = opts.note;
          if (opts.annotationType !== undefined) existing.annotationType = opts.annotationType;
          if (opts.exportable !== undefined) existing.exportable = opts.exportable;
          if (opts.color !== undefined) existing.color = opts.color;
        }
        touched.push(existing);
      } else {
        const m = {
          id: uid("mk"),
          chapterIdx: o.chapterIdx,
          paraIdx: o.paraIdx,
          startOff: o.startOff,
          endOff: o.endOff,
          text: o.text || "",
          color: (opts && opts.color) || "",
          note: (opts && opts.note) || "",
          kbId: (opts && opts.kbId) || null,
          annotationType: (opts && opts.annotationType) || "",
          exportable: opts && typeof opts.exportable === "boolean" ? opts.exportable : true,
          createdAt: new Date().toISOString()
        };
        arr.push(m);
        touched.push(m);
      }
    });
    if (touched.length) {
      History.push({
        bookId: book.id,
        description: opts && opts.note ? "添加批注" : "划线 " + touched.length + " 处",
        before: before,
        after: snapshotMarks(book),
        touchedIds: touched.map(m => m.id)
      });
      persist(book); render(book, currentChapterOf(book, touched[0]));
    }
    return touched;
  }

  /* ---- 高亮 Toggle（可切换）：选中→添加；完整选中同一高亮→取消 ----
   * 判定严格基于「章节+段落+字符偏移」位置，不依赖文字内容：
   *   - 某一段选区内若有 mark 被该选区「完整覆盖」（mark 起止都落在选区内）→ 取消这些 mark
   *   - 否则 → 新建一条独立高亮（不修改任何已有 mark，避免误删/误改部分高亮）
   * 多段选区逐段独立处理，互不影响。
   */
  function toggleSelection(book, chapterIdx, offsetsList) {
    const list = Array.isArray(offsetsList) ? offsetsList : (offsetsList ? [offsetsList] : []);
    if (!list.length || !book) return { action: "none", created: [], removed: [] };
    const arr = marksOf(book);
    const before = snapshotMarks(book);
    const removeIds = new Set();
    const addOffs = [];
    list.forEach(off => {
      if (!off || typeof off.startOff !== "number" || typeof off.endOff !== "number") return;
      const covered = arr.filter(m =>
        m.chapterIdx === off.chapterIdx && m.paraIdx === off.paraIdx &&
        m.startOff >= off.startOff && m.endOff <= off.endOff); // 选区完整覆盖该 mark
      if (covered.length) {
        covered.forEach(m => removeIds.add(m.id));
      } else {
        addOffs.push(off); // 未完整覆盖任何高亮 → 新增（保持原高亮不变）
      }
    });

    const removed = arr.filter(m => removeIds.has(m.id)).map(cloneMark);
    if (removeIds.size) book.marks = arr.filter(m => !removeIds.has(m.id));

    const created = [];
    addOffs.forEach(off => {
      const m = {
        id: uid("mk"),
        chapterIdx: off.chapterIdx,
        paraIdx: off.paraIdx,
        startOff: off.startOff,
        endOff: off.endOff,
        text: off.text || "",
        color: (off.color && typeof off.color === "string") ? off.color : "",
        note: "", kbId: null, annotationType: "", exportable: true,
        createdAt: new Date().toISOString()
      };
      book.marks.push(m);
      created.push(m);
    });

    if (!removeIds.size && !created.length) return { action: "none", created: [], removed: [] };

    const action = (removeIds.size && !created.length) ? "remove"
      : (created.length && !removeIds.size) ? "add" : "toggle";
    History.push({
      bookId: book.id,
      description: action === "remove" ? "取消高亮 " + removed.length + " 处"
        : action === "add" ? "添加高亮 " + created.length + " 处"
        : "切换高亮",
      before: before,
      after: snapshotMarks(book),
      toggle: true
    });
    persist(book);
    render(book, chapterIdx);
    return { action: action, created: created, removed: removed };
  }

  /* ---- 公共 API ---- */
  window.BookMarks = {
    init: init,
    captureSelection: captureSelection,
    render: render,
    createFromSelection: function (book, chapterIdx, color) {
      const offs = captureSelection(chapterIdx);
      if (!offs.length) { if (window.flash) flash("请先选中要划线的文本"); return []; }
      const created = createMarks(book, offs, { color: color || "" });
      if (created.length) {
        showUndoToast(created.length, () => { History.undo(); flashStatus("已撤销划线"); });
      }
      return created;
    },
    createAnnotationMarks: function (book, offsetsList, opts) {
      return createMarks(book, offsetsList, opts);
    },
    upsertFromOffsets: upsertFromOffsets,
    toggleSelection: toggleSelection,
    showUndoToast: showUndoToast,
    setMarkAnnotation: setMarkAnnotation,
    removeMark: removeMark,
    getMark: function (book, markId) { return book && book.marks ? book.marks.find(m => m.id === markId) : null; },
    undo: function () { return History.undo(); },
    redo: function () { return History.redo(); },
    canUndo: function () { return History.canUndo(); },
    canRedo: function () { return History.canRedo(); },
    _History: History
  };
})();
