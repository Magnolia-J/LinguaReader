/* =========================================================
 * LLM / AI 配置（开源模板，默认不内置任何人的密钥）
 * 用户需填入【自己的】LLM API Key（DeepSeek / OpenAI 兼容接口），
 * 配置保存在本机浏览器 localStorage（键：lr_llm_config），
 * 不会进入代码仓库，也不会连到作者的云端账户。
 *
 * 安全说明：API Key 是「私密密钥」，与 Supabase 的 publishable key 不同——
 * 它不会出现在前端代码里，只在你本机随请求发给本地后端（localhost），
 * 再由后端转发给 LLM 服务商。别人下载本项目后只能用他们自己的密钥，
 * 不会消耗你的额度，也看不到你的密钥。
 * ========================================================= */
(function () {
  function loadConfig() {
    try {
      const raw = localStorage.getItem("lr_llm_config");
      if (raw) {
        const c = JSON.parse(raw);
        return {
          API_KEY: (c && c.apiKey) || "",
          API_BASE: (c && c.apiBase) || "",
          MODEL: (c && c.model) || ""
        };
      }
    } catch (e) { /* 忽略损坏的配置 */ }
    return { API_KEY: "", API_BASE: "", MODEL: "" };
  }
  window.LLM_CONFIG = loadConfig();

  // 保存用户自己的 LLM 配置到本机浏览器（不进入代码仓库）
  window.saveLLMConfig = function (apiKey, apiBase, model) {
    apiKey = (apiKey || "").trim();
    apiBase = (apiBase || "").trim();
    model = (model || "").trim();
    if (!apiKey) {
      localStorage.removeItem("lr_llm_config");
      window.LLM_CONFIG = { API_KEY: "", API_BASE: "", MODEL: "" };
    } else {
      const c = { apiKey: apiKey, apiBase: apiBase, model: model };
      localStorage.setItem("lr_llm_config", JSON.stringify(c));
      window.LLM_CONFIG = { API_KEY: apiKey, API_BASE: apiBase, MODEL: model };
    }
  };
})();
