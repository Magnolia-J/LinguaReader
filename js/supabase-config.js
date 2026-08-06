/* =========================================================
 * Supabase 配置
 * 数据同步到云端（Postgres + Auth + RLS）。
 * 凭据为公开的 publishable key（前端安全，安全由行级安全 RLS 保证）。
 * ========================================================= */
/* =========================================================
 * Supabase 配置（开源模板，默认不内置任何人的云端）
 * 用户需填入【自己的】Supabase 项目（supabase.com 免费注册），
 * 配置保存在本机浏览器 localStorage（键：lr_supabase_config），
 * 不会进入代码仓库，也不会连到作者的云端。
 * 凭据为公开的 publishable key（前端安全，安全由行级安全 RLS 保证）。
 * ========================================================= */
(function () {
  function loadConfig() {
    try {
      const raw = localStorage.getItem("lr_supabase_config");
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.url && c.key) return { URL: c.url, ANON_KEY: c.key };
      }
    } catch (e) { /* 忽略损坏的配置 */ }
    return { URL: "", ANON_KEY: "" };
  }
  window.SUPABASE_CONFIG = loadConfig();

  // 保存用户自己的 Supabase 配置到本机浏览器（不进入代码仓库）
  window.saveSupabaseConfig = function (url, key) {
    url = (url || "").trim();
    key = (key || "").trim();
    if (!url || !key) {
      localStorage.removeItem("lr_supabase_config");
      window.SUPABASE_CONFIG = { URL: "", ANON_KEY: "" };
    } else {
      const c = { url: url, key: key };
      localStorage.setItem("lr_supabase_config", JSON.stringify(c));
      window.SUPABASE_CONFIG = { URL: url, ANON_KEY: key };
    }
  };
})();
