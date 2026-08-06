/* 安全构建静态部署包到 deploy/（不删除任何原有文件，避免触发批量删除拦截）。
 * 等价于 build_dist.js --empty：干净版，无个人数据，云端同步在静态端禁用。
 */
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const OUT = path.join(ROOT, "deploy");

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// 根目录静态资源
["index.html", "styles.css", "manifest.json", "icon.svg", "sw.js"].forEach((f) => {
  const s = path.join(ROOT, f);
  if (fs.existsSync(s)) copyFile(s, path.join(OUT, f));
});

// js 目录整体复制
const jsDir = path.join(ROOT, "js");
fs.readdirSync(jsDir).forEach((f) => {
  if (f.endsWith(".js")) copyFile(path.join(jsDir, f), path.join(OUT, "js", f));
});

// 空骨架快照（app.js 在无后端时自动加载；干净版不含个人数据）
const skeleton = {
  books: [], progress: {}, kb: [],
  prefs: { enabledDicts: [], categories: [] },
  reading: { seconds: {}, byDate: {}, byBookDay: {} },
  checkins: {}, lastBookId: null
};
fs.writeFileSync(path.join(OUT, "snapshot.json"), JSON.stringify(skeleton, null, 2));

// 静态端禁用 Supabase 云同步（避免把本地快照清空）
fs.writeFileSync(
  path.join(OUT, "js", "supabase-config.js"),
  'window.SUPABASE_CONFIG = { URL: "", ANON_KEY: "" };\n'
);

// 让 GitHub Pages / 静态托管不处理成 Jekyll
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

console.log("✅ deploy/ 构建完成（干净版，无个人数据，云端同步已禁用）");
console.log("   根目录:", fs.readdirSync(OUT).join(", "));
console.log("   js/:", fs.readdirSync(path.join(OUT, "js")).length, "个文件");
console.log("   部署方式：把 deploy/ 整个文件夹拖到 Netlify Drop，或用静态托管上传。");
