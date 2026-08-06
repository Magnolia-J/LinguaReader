#!/usr/bin/env node
/**
 * 一次性脚本：把本机 data/store.json（你的真实书籍 / 知识库 / 阅读记录）
 * 写入 Supabase 的 kb_store 表（固定 user_id = LR_USER_ID），
 * 供部署到云端的服务端读取，从而实现「永久链接显示你的真实数据 + 云端持久化」。
 *
 * 用法（需先 npm install 安装 @supabase/supabase-js）：
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE=<service_role 密钥> \
 *   LR_USER_ID=00000000-0000-0000-0000-000000000001 \
 *   node scripts/seed-supabase.js
 *
 * service_role 密钥仅服务端使用，切勿提交或泄露到前端。
 */
const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
const uid = process.env.LR_USER_ID || "00000000-0000-0000-0000-000000000001";

if (!url || !key) {
  console.error("缺少环境变量：请设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE");
  process.exit(1);
}

const storePath = path.join(__dirname, "..", "data", "store.json");
if (!fs.existsSync(storePath)) {
  console.error("找不到本地数据文件：", storePath);
  process.exit(1);
}
const store = JSON.parse(fs.readFileSync(storePath, "utf8"));

(async () => {
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb
    .from("kb_store")
    .upsert({ user_id: uid, payload: store, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    console.error("写入 Supabase 失败：", error.message);
    process.exit(1);
  }
  console.log("✓ 已将本地数据写入 Supabase（user_id=" + uid + "）");
  console.log("  书籍:", (store.books || []).length, "| 知识库:", (store.kb || []).length);
  console.log("  云端服务端启动后会自动拉取这份数据。");
  process.exit(0);
})();
