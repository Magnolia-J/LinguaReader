/* 构建手机/静态部署版 dist/：把当前前端 + 知识库快照打包成无需后端的静态站点。
 * - 复制 index.html / styles.css / manifest.json / icon.svg / sw.js / js/*
 * - data/store.json -> dist/snapshot.json（app.js 在后端不可用时自动加载；空数据版写入空骨架）
 * - dist/js/supabase-config.js 置空，避免静态端云同步把快照清空
 *
 * 用法：
 *   node build_dist.js            # 带当前知识库数据（分享我的收藏）
 *   node build_dist.js --empty    # 空数据版（别人打开是干净工具，数据各存各浏览器）
 */
const fs = require("fs");
const path = require("path");

const EMPTY = process.argv.includes("--empty");
const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });

// 根目录静态资源
["index.html", "styles.css", "manifest.json", "icon.svg", "sw.js"].forEach((f) => {
  const s = path.join(ROOT, f);
  if (fs.existsSync(s)) copyFile(s, path.join(DIST, f));
});

// js 目录整体复制
const jsDir = path.join(ROOT, "js");
fs.readdirSync(jsDir).forEach((f) => {
  if (f.endsWith(".js")) copyFile(path.join(jsDir, f), path.join(DIST, "js", f));
});

// 知识库快照（app.js 后端不可用时自动加载）
if (EMPTY) {
  const skeleton = {
    books: [], progress: {}, kb: [], prefs: { enabledDicts: [], categories: [] },
    reading: { seconds: {}, byDate: {}, byBookDay: {} }, checkins: {}, lastBookId: null
  };
  fs.writeFileSync(path.join(DIST, "snapshot.json"), JSON.stringify(skeleton, null, 2));
} else {
  copyFile(path.join(ROOT, "data", "store.json"), path.join(DIST, "snapshot.json"));
}

// 静态部署版：清空 Supabase 配置，避免云同步把快照清空
fs.writeFileSync(
  path.join(DIST, "js", "supabase-config.js"),
  'window.SUPABASE_CONFIG = { URL: "", ANON_KEY: "" };\n'
);

// 统计
const snap = JSON.parse(fs.readFileSync(path.join(DIST, "snapshot.json"), "utf8"));
const count = (p) => (Array.isArray(snap[p]) ? snap[p].length : (snap[p] && typeof snap[p] === "object" ? Object.keys(snap[p]).length : 0));
console.log("✅ dist/ 构建完成" + (EMPTY ? "（空数据版）" : "（带当前知识库）") + "：");
console.log("   书籍:", count("books"), "| 知识库条目:", count("kb"), "| 阅读天数:", count("reading") ? Object.keys(snap.reading.byDate || {}).length : 0);
console.log("   产物:", fs.readdirSync(DIST).join(", "), "| js/", fs.readdirSync(path.join(DIST, "js")).length, "个文件");
console.log("   云同步: 静态版已禁用（不影响本地桌面版）");
