/* =========================================================
 * 本地自动备份与恢复 UI 模块
 *  - 仅本地磁盘，不进 Supabase，不修改其它任何逻辑
 *  - 依赖 js/api.js 的全局 ApiClient 与 js/app.js 的 toast()
 *  - 设计原则：所有操作失败都静默/友好提示，绝不影响正常使用
 * ========================================================= */
(function () {
  const el = (id) => document.getElementById(id);

  function fmtSize(bytes) {
    if (bytes == null) return "-";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }
  function fmtTime(iso) {
    if (!iso) return "未知时间";
    try {
      const d = new Date(iso);
      return d.toLocaleString("zh-CN", { hour12: false });
    } catch (e) { return String(iso); }
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function openBackupModal() {
    const m = el("backup-modal");
    if (m) m.classList.remove("hidden");
    loadBackupConfig();
    loadBackupList();
  }
  function closeBackupModal() {
    const m = el("backup-modal");
    if (m) m.classList.add("hidden");
  }

  async function loadBackupConfig() {
    try {
      const cfg = await ApiClient.backupConfig();
      if (cfg && cfg.dir != null) el("backup-dir").value = cfg.dir;
      el("backup-auto").checked = !cfg || cfg.auto !== false;
      el("backup-retain").value = (cfg && cfg.retainDays) ? cfg.retainDays : 7;
    } catch (e) { /* 静默：配置加载失败不影响其它 */ }
  }

  async function saveBackupConfig() {
    const dir = el("backup-dir").value.trim();
    const auto = el("backup-auto").checked;
    const retainDays = parseInt(el("backup-retain").value, 10) || 7;
    try {
      const cfg = await ApiClient.setBackupConfig({ dir, auto, retainDays });
      el("backup-dir").value = (cfg && cfg.dir) || dir;
      el("backup-auto").checked = !cfg || cfg.auto !== false;
      el("backup-retain").value = (cfg && cfg.retainDays) || retainDays;
      toast("✓ 备份设置已保存", "success");
    } catch (e) {
      toast("⚠ 保存备份设置失败：" + (e && e.message ? e.message : "网络错误"), "error");
    }
  }

  async function resetBackupDir() {
    try {
      const cfg = await ApiClient.setBackupConfig({ resetDir: true });
      el("backup-dir").value = (cfg && cfg.dir) || "";
      toast("✓ 已还原为默认备份文件夹", "success");
    } catch (e) {
      toast("⚠ 还原失败：" + (e && e.message ? e.message : "网络错误"), "error");
    }
  }

  async function backupNow() {
    const btn = el("backup-now");
    const status = el("backup-now-status");
    if (btn) btn.disabled = true;
    if (status) status.textContent = "正在备份…";
    try {
      const r = await ApiClient.backupNow();
      if (r && r.ok) {
        if (status) status.textContent = "✓ 已备份 " + fmtTime(r.manifest && r.manifest.createdAt);
        toast("✓ 已立即备份", "success");
        loadBackupList();
      } else {
        const msg = (r && r.error) ? r.error : "失败";
        if (status) status.textContent = "⚠ " + msg;
        toast("⚠ 备份失败：" + msg, "error");
      }
    } catch (e) {
      const isNetwork = !e || !e.message || /network|fetch|failed/i.test(e.message);
      const hint = isNetwork ? "请按 Ctrl+Shift+R 强制刷新后再试" : "";
      if (status) status.textContent = hint ? "⚠ " + hint : "⚠ " + (e.message || "失败");
      toast("⚠ 备份失败：" + (e && e.message ? e.message : "网络错误") + (hint ? "（" + hint + "）" : ""), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadBackupList() {
    const list = el("backup-list");
    if (!list) return;
    list.innerHTML = "<div class='backup-empty'>加载中…</div>";
    try {
      const r = await ApiClient.listBackups();
      const backups = (r && r.backups) || [];
      if (!backups.length) {
        list.innerHTML = "<div class='backup-empty'>暂无备份。点「立即备份」创建第一个，或开启自动备份。</div>";
        return;
      }
      let html = "";
      for (const b of backups) {
        let label = "自动";
        if (b.label === "pre-restore") label = "恢复前快照";
        else if (b.label === "manual") label = "手动";
        html +=
          "<div class='backup-item'>" +
            "<div class='backup-item-main'>" +
              "<div class='backup-item-name'>" + escapeHtml(b.name) + "</div>" +
              "<div class='backup-item-meta'>" + fmtTime(b.createdAt) + " · " + label +
                " · 📚 " + (b.books == null ? "-" : b.books) +
                " · 🧠 " + (b.kb == null ? "-" : b.kb) +
                " · " + fmtSize(b.size) + "</div>" +
            "</div>" +
            "<div class='backup-item-actions'>" +
              "<button class='btn btn-sm' data-restore='" + escapeHtml(b.name) + "'>恢复</button>" +
            "</div>" +
          "</div>";
      }
      list.innerHTML = html;
      list.querySelectorAll("[data-restore]").forEach((btn) => {
        btn.addEventListener("click", () => confirmRestore(btn.getAttribute("data-restore")));
      });
    } catch (e) {
      list.innerHTML = "<div class='backup-empty'>加载失败：" + escapeHtml(e && e.message ? e.message : "网络错误") + "</div>";
    }
  }

  function confirmRestore(name) {
    const ok = window.confirm(
      "确定要恢复备份「" + name + "」吗？\n\n" +
      "恢复会用该备份覆盖当前的书库、阅读进度、划线批注、阅读记录、知识库与设置。\n" +
      "建议先点「立即备份」保存当前数据，以便后悔时回退。\n\n" +
      "（恢复前系统会自动再备份一次当前状态作为安全网。）"
    );
    if (!ok) return;
    doRestore(name);
  }

  async function doRestore(name) {
    try {
      if (typeof toast === "function") toast("正在恢复「" + name + "」…", "info");
      const r = await ApiClient.restoreBackup(name);
      if (r && r.ok) {
        toast("✓ 已恢复「" + name + "」，即将刷新页面", "success");
        // 核心数据已写回磁盘，刷新即可加载恢复后的内容
        setTimeout(() => { window.location.reload(); }, 1200);
      } else {
        toast("⚠ 恢复失败：" + ((r && r.error) ? r.error : "未知错误"), "error");
      }
    } catch (e) {
      toast("⚠ 恢复失败：" + (e && e.message ? e.message : "网络错误"), "error");
    }
  }

  function setupBackup() {
    const btn = el("backup-btn");
    if (btn) btn.addEventListener("click", openBackupModal);
    document.querySelectorAll("[data-close-backup]").forEach((b) =>
      b.addEventListener("click", closeBackupModal)
    );
    const modal = el("backup-modal");
    if (modal) modal.addEventListener("click", (e) => {
      if (e.target.id === "backup-modal") closeBackupModal();
    });
    const saveCfg = el("backup-save-cfg");
    if (saveCfg) saveCfg.addEventListener("click", saveBackupConfig);
    const browse = el("backup-browse");
    if (browse) browse.addEventListener("click", resetBackupDir);
    const now = el("backup-now");
    if (now) now.addEventListener("click", backupNow);
    const refresh = el("backup-refresh");
    if (refresh) refresh.addEventListener("click", loadBackupList);
  }

  // 脚本位于 body 末尾，DOM 已就绪，直接初始化
  setupBackup();
})();
