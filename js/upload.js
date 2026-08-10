/* =========================================================
 * LinguaReader Workspace · 书籍上传模块
 * 支持：拖拽 / 点击上传 .txt .md（自动分章、识别书名/作者/语言）
 *       .epub（浏览器原生 DecompressionStream 解压，无依赖）
 *       PDF 请先转为文本后粘贴。
 * 流程：读取文件 → 解析 → 弹出元数据确认 → 加入书库。
 * ========================================================= */

let pendingBook = null;   // 待确认的解析结果

/* ---------- 入口绑定 ---------- */
function initUpload() {
  const dz = document.getElementById("drop-zone");
  const fi = document.getElementById("file-input");

  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", e => {
    e.preventDefault(); dz.classList.remove("drag");
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fi.addEventListener("change", e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  document.getElementById("paste-import").addEventListener("click", handlePaste);

  // 关闭
  document.querySelectorAll("[data-close-upload]").forEach(b => b.addEventListener("click", closeUpload));
  document.getElementById("upload-modal").addEventListener("click", e => { if (e.target.id === "upload-modal") closeUpload(); });
  document.querySelectorAll("[data-close-meta]").forEach(b => b.addEventListener("click", closeMeta));
  document.getElementById("meta-modal").addEventListener("click", e => { if (e.target.id === "meta-modal") closeMeta(); });
  document.getElementById("meta-cancel").addEventListener("click", closeMeta);
  document.getElementById("meta-confirm").addEventListener("click", confirmMeta);
}

function openUploadModal() { document.getElementById("upload-modal").classList.remove("hidden"); }
function closeUpload() { document.getElementById("upload-modal").classList.add("hidden"); }
function openMetaModal() { document.getElementById("meta-modal").classList.remove("hidden"); }
function closeMeta() { document.getElementById("meta-modal").classList.add("hidden"); }

/* ---------- 文件分发 ---------- */
function handleFile(file) {
  const name = file.name.toLowerCase();
  flash("正在解析：" + file.name);
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".text")) {
    const reader = new FileReader();
    reader.onload = () => { finishParse(parseTxt(String(reader.result), file.name)); };
    reader.onerror = () => alert("读取文件失败。");
    reader.readAsText(file, "utf-8");
  } else if (name.endsWith(".epub")) {
    const reader = new FileReader();
    reader.onload = () => {
      parseEpub(reader.result)
        .then(book => finishParse(book))
        .catch(err => {
          console.warn("[upload] EPUB 解析失败：", err);
          const detail = err && err.message ? err.message : String(err);
          const hint = detail.includes("Failed to fetch")
            ? "浏览器解压该 EPUB 时失败。建议：\n1. 按 Ctrl+Shift+R 硬刷新（清 Service Worker 旧缓存）；\n2. 若仍失败，把 EPUB 用 Calibre「重新保存」一次再试；\n3. 或直接解压出 .txt / .html 粘贴。"
            : "EPUB 解析失败，请改用 .txt 或粘贴文本。";
          alert(hint + "\n\n技术信息：" + detail);
        });
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert("暂不支持该格式。请上传 .txt / .md / .epub，或粘贴纯文本。");
  }
}

function handlePaste() {
  const text = document.getElementById("paste-text").value.trim();
  if (!text) { alert("请先粘贴书籍文本。"); return; }
  const title = document.getElementById("paste-title").value.trim();
  const author = document.getElementById("paste-author").value.trim();
  finishParse(parseTxt(text, title || "粘贴文本", author));
}

/* ---------- 解析后处理 ---------- */
function finishParse(book) {
  if (!book || !book.chapters || !book.chapters.length) {
    alert("未能从文件中解析出内容，请检查格式或改用粘贴。");
    return;
  }
  pendingBook = book;
  document.getElementById("meta-title").value = book.title;
  document.getElementById("meta-author").value = book.author;
  document.getElementById("meta-lang").value = book.language;
  const totalParas = book.chapters.reduce((n, c) => n + c.paragraphs.length, 0);
  const srcLabel = book.publish && book.publish.publisher === "用户上传" ? "（用户上传）" : "";
  document.getElementById("meta-stats").textContent =
    `共 ${book.chapters.length} 章 · ${totalParas} 段 · 语言：${book.language === "fr" ? "法文" : "英文"} ${srcLabel}`;
  closeUpload();
  openMetaModal();
}

function confirmMeta() {
  if (!pendingBook) return;
  pendingBook.title = document.getElementById("meta-title").value.trim() || pendingBook.title;
  pendingBook.author = document.getElementById("meta-author").value.trim() || "未知";
  pendingBook.language = document.getElementById("meta-lang").value;
  const langLabel = pendingBook.language === "fr" ? "Français" : "English";
  pendingBook.category = document.getElementById("meta-category").value.trim() || langLabel;
  addBookToLibrary(pendingBook);
  pendingBook = null;
  closeMeta();
}

function addBookToLibrary(book) {
  book.id = "user-" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  BOOKS.push(book);
  BOOK_PROGRESS[book.id] = 0;
  if (typeof renderCategoryChips === "function") renderCategoryChips();
  selectBook(book.id);
  flash("已加入书库：" + book.title);
  // 本地备份：即使后端暂不可用，刷新也不会丢（联网后会自动补传后端）
  if (typeof backupUserBook === "function") backupUserBook(book);
  // 持久化到后端（失败不阻断本地体验）
  if (window.ApiClient) {
    ApiClient.addBook(book)
      .then(() => { if (typeof removeUserBookBackup === "function") removeUserBookBackup(book.id); })
      .catch((e) => console.warn("书籍未同步到后端，已保留本地备份：", e.message));
  }
}

/* ---------- 工具：文件名推导 ---------- */
function deriveTitle(filename) {
  let n = (filename || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  return n.replace(/[_-]+/g, " ").trim() || "未命名书籍";
}

/* ---------- 语言探测 ---------- */
function detectLanguage(text) {
  const fr = (text.match(/[àâçéèêëîïôùûüÿæœ]/gi) || []).length;
  const en = (text.match(/\b(the|and|of|to|in|is|was|with|that|he|she|they)\b/gi) || []).length;
  return fr > en ? "fr" : "en";
}

/* ---------- 章节标题识别 ---------- */
function isHeading(line) {
  const l = line.trim();
  if (!l) return false;
  if (/^\s*(chapter|chapitre|part|partie|book|volume|livre|卷|章|第\s*\d+|section)\b/i.test(l)) return true;
  if (/^(\d+(\.\d+)*)\.?\s+\S/.test(l)) return true;
  if (/^[IVXLC]+\.\s/.test(l)) return true;
  // 全大写短行（>=4 字母）
  if (l.length >= 4 && l.length <= 70 && l === l.toUpperCase() && /[A-Z]{4}/.test(l)) return true;
  return false;
}

/* ---------- 解析 TXT / MD ---------- */
function parseTxt(text, filename, forcedAuthor) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const chapters = [];
  let title = "全文";
  let curPara = "";
  let paras = [];
  let sawHeading = false;

  const pushPara = () => { if (curPara.trim()) { paras.push(curPara.trim()); curPara = ""; } };
  const pushChapter = () => { pushPara(); if (paras.length) { chapters.push({ title: title, pages: "", paragraphs: paras.slice() }); paras = []; } };

  for (const raw of lines) {
    const l = raw.trim();
    if (isHeading(l)) {
      pushChapter();
      title = l.slice(0, 80);
      sawHeading = true;
      continue;
    }
    if (l === "") { pushPara(); continue; }   // 空行 = 段落边界
    curPara = curPara ? curPara + " " + l : l;
  }
  pushChapter();

  // 若全文无任何标题，且只有一个“全文”章，尝试按句切分长段落
  if (!sawHeading && chapters.length === 1 && chapters[0].paragraphs.length === 1) {
    chapters[0].paragraphs = splitLongText(chapters[0].paragraphs[0]);
  }
  if (!chapters.length) chapters.push({ title: "全文", pages: "", paragraphs: ["（空文件）"] });

  const full = text.slice(0, 2000);
  return buildBook(deriveTitle(filename), forcedAuthor || "", detectLanguage(full), chapters);
}

function splitLongText(t) {
  const parts = t.match(/[^.!?…。！？]+[.!?…。！？]*/g) || [t];
  const out = [];
  let buf = "";
  for (const s of parts) {
    buf += s;
    if (buf.length > 120) { out.push(buf.trim()); buf = ""; }
  }
  if (buf.trim()) out.push(buf.trim());
  // 兜底：若仍只有一段且过长（如单句超长），按词硬切
  if (out.length === 1 && out[0].length > 200) {
    const words = out[0].split(/\s+/);
    const chunks = [];
    let c = "";
    for (const w of words) {
      if ((c + " " + w).length > 200) { chunks.push(c.trim()); c = w; }
      else c = c ? c + " " + w : w;
    }
    if (c.trim()) chunks.push(c.trim());
    return chunks.length ? chunks : [t];
  }
  return out.length ? out : [t];
}

/* ---------- 组装 Book 对象 ---------- */
function buildBook(title, author, language, chapters, filename) {
  return {
    id: "tmp",
    title: title || deriveTitle(filename || ""),
    author: author || "未知",
    language,
    publish: { year: "—", publisher: "用户上传" },
    chapters
  };
}

/* =========================================================
 * EPUB 解析（无依赖，使用 DecompressionStream）
 * ========================================================= */
async function inflateRaw(u8) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(u8); writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

/* 某些 EPUB 生成器把 zlib wrapped deflate（带 2 字节 header + 4 字节 adler32 尾）
 * 当成 raw deflate 塞进 zip。浏览器只有 deflate-raw，因此失败后尝试剥掉 zlib wrapper。 */
async function inflateWithFallback(u8, entryName) {
  const tryRaw = async (data) => {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(data); writer.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  };
  try { return await tryRaw(u8); } catch (firstErr) {
    // 尝试跳过 zlib header（常见 78 9C / 78 DA / 78 01）并截断 adler32 尾
    if (u8.length > 6 && u8[0] === 0x78 && (u8[1] === 0x9C || u8[1] === 0xDA || u8[1] === 0x01)) {
      try {
        const stripped = u8.slice(2, u8.length - 4);
        return await tryRaw(stripped);
      } catch (secondErr) { /* 继续抛出第一次错误，更原始 */ }
    }
    console.warn(`[epub] 解压失败：${entryName || "?"}，方法=8，大小=${u8.length}，首字节=${u8[0].toString(16)} ${u8[1]?.toString(16)}`);
    throw firstErr;
  }
}

async function parseZip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const entries = [];
  const END = u8.length;
  let off = 0;
  while (off + 4 <= END) {
    const sig = dv.getUint32(off, true);
    if (sig !== 0x04034b50) break; // 到达中央目录
    const method = dv.getUint16(off + 8, true);
    const compSize = dv.getUint32(off + 18, true);
    const fnameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = new TextDecoder().decode(u8.subarray(off + 30, off + 30 + fnameLen));
    const dataStart = off + 30 + fnameLen + extraLen;
    let dataEnd;
    if (compSize > 0) dataEnd = dataStart + compSize;
    else {
      let p = dataStart, found = false;
      while (p + 4 <= END) { if (dv.getUint32(p, true) === 0x04034b50) { dataEnd = p; found = true; break; } p++; }
      if (!found) dataEnd = END;
    }
    entries.push({ name, method, dataStart, dataEnd });
    off = dataEnd;
  }
  return entries;
}

async function getEntryBytes(entries, buf, entry) {
  const slice = new Uint8Array(buf, entry.dataStart, entry.dataEnd - entry.dataStart);
  if (entry.method === 8) return await inflateWithFallback(slice, entry.name);
  return slice;
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(name + "\\s*=\\s*\"([^\"]*)\""));
  return m ? m[1] : "";
}
function extractTag(xml, tag) {
  const m = xml.match(new RegExp("<" + tag + "[^>]*>([^<]*)</" + tag + ">"));
  return m ? m[1].trim() : "";
}

function extractParagraphs(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ps = [...doc.body.querySelectorAll("p, li, blockquote")].map(e => e.textContent.trim()).filter(t => t.length > 1);
    if (ps.length) return ps;
    const txt = doc.body.textContent.replace(/\s+/g, " ").trim();
    return txt ? [txt] : [];
  } catch (e) {
    const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return txt ? [txt] : [];
  }
}
function extractTitle(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const t = doc.querySelector("title, h1, h2");
    return t ? t.textContent.trim().slice(0, 80) : "";
  } catch (e) { return ""; }
}

async function parseEpub(buffer) {
  if (!buffer || buffer.byteLength < 4) throw new Error("文件为空或过小");
  const sig = new DataView(buffer).getUint32(0, true);
  if (sig !== 0x04034b50 && sig !== 0x06054b50) throw new Error("文件不是有效的 ZIP/EPUB（可能已损坏）");

  const entries = await parseZip(buffer);
  if (!entries.length) throw new Error("ZIP 包内未找到任何文件");

  // 定位 OPF
  const cont = entries.find(e => e.name.toLowerCase().endsWith("container.xml"));
  let opfPath = null;
  if (cont) {
    const xml = new TextDecoder().decode(await getEntryBytes(entries, buffer, cont));
    opfPath = (xml.match(/full-path="([^"]+)"/) || [])[1];
  }
  if (!opfPath) {
    const opf = entries.find(e => /\.opf$/i.test(e.name));
    opfPath = opf ? opf.name : null;
  }
  if (!opfPath) throw new Error("未找到 OPF 元数据");

  let opfXml = "";
  try {
    opfXml = new TextDecoder().decode(await getEntryBytes(entries, buffer, entries.find(e => e.name === opfPath)));
  } catch (e) { throw new Error(`OPF 元数据解压失败：${e.message || e}`); }
  let title = extractTag(opfXml, "dc:title") || "未命名书籍";
  let author = extractTag(opfXml, "dc:creator") || "未知";

  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const idToHref = {};
  let m;
  const itemRe = /<item\s+([^>]*?)\/?>/g;
  while ((m = itemRe.exec(opfXml))) { const id = attr(m[1], "id"); const href = attr(m[1], "href"); if (id && href) idToHref[id] = href; }
  const order = [];
  const spineRe = /<itemref\s+([^>]*?)\/?>/g;
  while ((m = spineRe.exec(opfXml))) { const idref = attr(m[1], "idref"); if (idref && idToHref[idref]) order.push(idToHref[idref]); }
  let files = order.length ? order : Object.values(idToHref).filter(h => /\.x?html?$/i.test(h));

  const chapters = [];
  for (const rel of files) {
    const full = base + rel;
    const entry = entries.find(e => e.name === full || e.name.endsWith("/" + rel));
    if (!entry) continue;
    try {
      const html = new TextDecoder().decode(await getEntryBytes(entries, buffer, entry));
      const paras = extractParagraphs(html);
      if (paras.length) chapters.push({ title: extractTitle(html) || title, pages: "", paragraphs: paras.slice(0, 60) });
    } catch (e) { console.warn(`[epub] 跳过章节 ${rel}：`, e.message || e); }
  }

  // 回退：扫描全部 xhtml
  if (!chapters.length) {
    for (const e of entries) {
      if (/\.x?html?$/i.test(e.name)) {
        try {
          const html = new TextDecoder().decode(await getEntryBytes(entries, buffer, e));
          const paras = extractParagraphs(html);
          if (paras.length) chapters.push({ title: extractTitle(html) || e.name, pages: "", paragraphs: paras.slice(0, 60) });
        } catch (e) { console.warn(`[epub] 跳过文件 ${e.name}：`, e.message || e); }
      }
    }
  }
  if (!chapters.length) throw new Error("EPUB 内未解析出正文（可能所有章节都解压失败）");

  const sample = chapters.slice(0, 5).map(c => c.paragraphs.join(" ")).join(" ").slice(0, 2000);
  return buildBook(title, author, detectLanguage(sample), chapters);
}
