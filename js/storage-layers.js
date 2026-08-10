/* =========================================================
 * LinguaReader Workspace · 存储分层（浏览器 + Node 通用）
 *
 * 设计目标：让 Supabase 只承载「轻量云端数据」，把「大文件 / 大量阅读·AI 数据」
 * 留在本地持久化目录，从而显著降低 500MB 数据库的增长速度。
 *
 * 职责：
 *  - STORAGE_DIRS：统一本地数据目录（books / annotations / vocabulary /
 *    analysis-cache / reading-progress / settings）。
 *  - minimizeForCloud(store)：生成「只含轻量元数据」的云端同步载荷，
 *    把每本书的完整正文（chapters，可能数百 KB）剥离——内容始终本地唯一来源。
 *  - mergeBooksLocalFirst(localBooks, remoteBooks)：云端合并时，保留本机已有的
 *    完整章节，仅用云端元数据覆盖；云端独有（本机无内容）的书不拉取，避免不可读的幽灵书。
 *  - kbFingerprint(e)：基于「分类 + 关键字段」的稳定指纹，用于知识库去重，
 *    避免同一句话 / 同一个单词被重复写入。
 *
 * 该文件无 DOM 依赖、无外部模块，浏览器（<script>）与 Node（require）均可加载。
 * ========================================================= */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") window.LRStorage = mod;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /* 统一本地数据目录（相对服务端工作目录；浏览器端用于展示/约定） */
  const STORAGE_DIRS = {
    root: "data",
    books: "data/books",
    annotations: "data/annotations",
    vocabulary: "data/vocabulary",
    analysisCache: "data/analysis-cache",
    readingProgress: "data/reading-progress",
    settings: "data/settings"
  };

  /* 把字符串归一化（小写 + 折叠空白），用于去重与缓存键 */
  function norm(s) {
    return (s == null ? "" : String(s)).toLowerCase().replace(/\s+/g, " ").trim();
  }

  /* 剥离一本书的「重」字段（完整正文 chapters），仅保留轻量元数据。
   * chapters 是体积最大、增长最快的部分，且本地 data/books/<id>.json 已有完整副本，
   * 因此绝不上云。其它字段（id/title/author/language/category/type/fileName/
   * fileSize/importTime/updateTime/totalPages/totalTextLength/parseStatus/
   * localPath/coverPath/publish）都是元数据，体积小、适合跨设备同步。 */
  function stripBookHeavy(b) {
    if (!b || typeof b !== "object") return b;
    const out = {};
    for (const k in b) {
      if (k === "chapters") continue; // 完整正文：本地唯一来源，不上云
      out[k] = b[k];
    }
    return out;
  }

  /* 生成云端同步载荷：剥离所有书的 chapters，其余结构原样保留
   * （progress / reading / prefs / checkins / kb / deletedBookIds 等保持轻量同步）。 */
  function minimizeForCloud(store) {
    if (!store || typeof store !== "object") return store;
    const out = {};
    for (const k in store) out[k] = store[k];
    if (Array.isArray(store.books)) out.books = store.books.map(stripBookHeavy);
    return out;
  }

  /* 云端 → 本地的书籍合并（本地优先）：
   *  - 本机已有的书：用云端同 id 的元数据覆盖（title/type/...），但 chapters 必须是本机的。
   *  - 云端独有（本机无内容）的书：不拉取（避免不可读的幽灵书；跨设备正文同步非本期目标）。
   * 删除（tombstone）由调用方用 deletedBookIds 统一过滤，这里只负责「保留正文」。 */
  function mergeBooksLocalFirst(localBooks, remoteBooks) {
    const remoteMeta = new Map((remoteBooks || []).filter(Boolean).map((b) => [b.id, b]));
    const out = [];
    (localBooks || []).forEach((lb) => {
      const rm = remoteMeta.get(lb.id);
      const meta = rm ? stripBookHeavy(rm) : {};
      out.push(Object.assign({}, lb, meta, { chapters: lb.chapters }));
      if (rm) remoteMeta.delete(lb.id);
    });
    // remoteMeta 剩余项 = 云端独有且无本机内容 → 跳过（不拉取）
    return out;
  }

  /* 知识库条目指纹：分类 + 关键内容 + 书名。
   * 同一个单词/句子/批注在不同设备重复保存时，指纹一致 → 可去重或覆盖更新。 */
  function kbFingerprint(e) {
    if (!e) return "kb-empty";
    const f = e.fields || {};
    const key = [
      e.category || "",
      norm(f.word || f.expression || f.sentence || f.text || f.quote || ""),
      norm(f.meaning || f.translation || ""),
      norm(e.book || "")
    ].join("|");
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return "kb-" + (h >>> 0).toString(36);
  }

  return { STORAGE_DIRS, norm, stripBookHeavy, minimizeForCloud, mergeBooksLocalFirst, kbFingerprint };
});
