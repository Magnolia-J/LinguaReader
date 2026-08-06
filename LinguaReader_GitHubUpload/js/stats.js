/* =========================================================
 * LinguaReader Workspace · 阅读统计
 * 日历视图（按天热力 + 当日明细）/ 周报 / 月报
 * 依赖 app.js 中的全局：READING / CHECKINS / BOOKS / fmtDur / escHtml / flash
 * ========================================================= */

let calView = null;     // 日历当前视图 {y, m}
let weekOffset = 0;     // 周报相对本周的偏移（0=本周）
let repView = null;     // 月报当前视图 {y, m}

/* ---------- 日期工具 ---------- */
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function parseDate(s) {
  const a = s.split("-").map(Number);
  return new Date(a[0], a[1] - 1, a[2]);
}
function durLevel(sec) {
  if (!sec) return 0;
  const m = sec / 60;
  if (m <= 10) return 1;
  if (m <= 30) return 2;
  if (m <= 60) return 3;
  return 4;
}
function bookName(bid) {
  const b = (typeof BOOKS !== "undefined") && BOOKS.find((x) => x.id === bid);
  return b ? b.title : (bid || "未知");
}
/* 周一为一周起点 */
function startOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0=周一 … 6=周日
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* ---------- 区间聚合（周报 / 月报共用） ---------- */
function aggregateRange(startIn, endIn) {
  const start = new Date(startIn.getFullYear(), startIn.getMonth(), startIn.getDate());
  const end = new Date(endIn.getFullYear(), endIn.getMonth(), endIn.getDate());
  const byDate = (READING.byDate) || {};
  const byBookDay = (READING.byBookDay) || {};
  const ck = (CHECKINS) || {};
  let total = 0, activeDays = 0, maxDay = 0, checkinDays = 0;
  const bookMap = {};
  const dayList = [];
  for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
    const key = fmtDate(dt);
    const s = byDate[key] || 0;
    if (s > 0) { total += s; activeDays++; maxDay = Math.max(maxDay, s); }
    dayList.push({ key, sec: s });
    if (ck[key]) checkinDays++;
    const bd = byBookDay[key];
    if (bd) Object.keys(bd).forEach((bid) => { bookMap[bid] = (bookMap[bid] || 0) + bd[bid]; });
  }
  const topBooks = Object.keys(bookMap)
    .map((bid) => ({ bid, sec: bookMap[bid] }))
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 5);
  return { total, activeDays, maxDay, checkinDays, dayList, topBooks };
}

/* ---------- 弹窗开关 ---------- */
function openStatsModal(tab) {
  const modal = document.getElementById("stats-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.querySelectorAll(".stats-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".stats-tab-panel").forEach((p) => p.classList.add("hidden"));
  const panel = document.getElementById("tab-" + tab);
  if (panel) panel.classList.remove("hidden");
  if (tab === "calendar") renderCalendar();
  else if (tab === "week") { weekOffset = 0; renderWeek(); }
  else { repView = null; renderMonthRep(); }
}
function closeStatsModal() {
  const modal = document.getElementById("stats-modal");
  if (modal) modal.classList.add("hidden");
}

/* ---------- 初始化绑定 ---------- */
function setupStats() {
  const btn = document.getElementById("stats-btn");
  if (btn) btn.addEventListener("click", () => openStatsModal("calendar"));
  document.querySelectorAll("[data-close-stats]").forEach((b) => b.addEventListener("click", closeStatsModal));
  const modal = document.getElementById("stats-modal");
  if (modal) modal.addEventListener("click", (e) => { if (e.target.id === "stats-modal") closeStatsModal(); });
  document.querySelectorAll(".stats-tab").forEach((t) => t.addEventListener("click", () => {
    const tab = t.dataset.tab;
    document.querySelectorAll(".stats-tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".stats-tab-panel").forEach((p) => p.classList.add("hidden"));
    const panel = document.getElementById("tab-" + tab);
    if (panel) panel.classList.remove("hidden");
    if (tab === "calendar") renderCalendar();
    else if (tab === "week") renderWeek();
    else renderMonthRep();
  }));
  // 顶栏快捷统计 → 打开对应标签（打卡/时长已统一到顶部「阅读统计」）
  bindStatOpen("ts-total", "month");
  bindStatOpen("ts-today", "week");
  bindStatOpen("ts-streak", "calendar");
}
function bindStatOpen(id, tab) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.cursor = "pointer";
  el.title = "点击查看详细统计";
  el.addEventListener("click", () => openStatsModal(tab));
}

/* ---------- 日历视图 ---------- */
function renderCalendar() {
  const wrap = document.getElementById("tab-calendar");
  if (!wrap) return;
  const now = new Date();
  if (!calView) calView = { y: now.getFullYear(), m: now.getMonth() };
  const y = calView.y, m = calView.m;
  const first = new Date(y, m, 1);
  const startWday = first.getDay(); // 0=周日
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const byDate = READING.byDate || {}, ck = CHECKINS || {};
  let cells = "";
  for (let i = 0; i < startWday; i++) cells += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = fmtDate(new Date(y, m, d));
    const sec = byDate[key] || 0;
    const lv = durLevel(sec);
    const isToday = (y === now.getFullYear() && m === now.getMonth() && d === now.getDate());
    const checked = !!ck[key];
    cells += `<div class="cal-cell ${isToday ? "today" : ""} ${lv ? "lv" + lv : ""}" data-date="${key}">
      <div class="cal-d">${d}</div>
      ${sec ? `<div class="cal-t">${fmtDur(sec)}</div>` : ""}
      ${checked ? '<div class="cal-check" title="已打卡">✓</div>' : ""}
    </div>`;
  }
  wrap.innerHTML = `
    <div class="cal-head">
      <button class="btn btn-ghost" id="cal-prev" title="上个月">‹</button>
      <span class="cal-title">${y} 年 ${monthNames[m]}</span>
      <button class="btn btn-ghost" id="cal-next" title="下个月">›</button>
      <button class="btn btn-ghost" id="cal-today">回到今天</button>
    </div>
    <div class="cal-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">阅读强度：<i class="lv1"></i>≤10m <i class="lv2"></i>≤30m <i class="lv3"></i>≤60m <i class="lv4"></i>>60m　<span class="cal-check">✓</span> 已打卡</div>
    <div id="cal-detail" class="cal-detail"><div class="cd-empty">点击任意日期查看当日阅读明细</div></div>
  `;
  document.getElementById("cal-prev").onclick = () => { calView = { y: m === 0 ? y - 1 : y, m: m === 0 ? 11 : m - 1 }; renderCalendar(); };
  document.getElementById("cal-next").onclick = () => { calView = { y: m === 11 ? y + 1 : y, m: m === 11 ? 0 : m + 1 }; renderCalendar(); };
  document.getElementById("cal-today").onclick = () => { calView = { y: now.getFullYear(), m: now.getMonth() }; renderCalendar(); };
  wrap.querySelectorAll(".cal-cell[data-date]").forEach((c) =>
    c.addEventListener("click", () => showCalDetail(c.dataset.date)));
}

function showCalDetail(date) {
  const el = document.getElementById("cal-detail");
  if (!el) return;
  const sec = (READING.byDate || {})[date] || 0;
  const checked = !!(CHECKINS && CHECKINS[date]);
  const bd = (READING.byBookDay || {})[date];
  let booksHtml = '<div class="cd-empty">当天无阅读记录</div>';
  if (bd) {
    const arr = Object.keys(bd).map((bid) => ({ bid, sec: bd[bid] })).sort((a, b) => b.sec - a.sec);
    booksHtml = arr.map((x) =>
      `<div class="cd-book"><span>${escHtml(bookName(x.bid))}</span><b>${fmtDur(x.sec)}</b></div>`
    ).join("");
  }
  el.innerHTML = `
    <div class="cd-head">${date} ${checked ? '<span class="cd-check">✓ 已打卡</span>' : ""}</div>
    <div class="cd-total">当日阅读：<b>${fmtDur(sec)}</b></div>
    <div class="cd-books">${booksHtml}</div>`;
}

/* ---------- 周报 ---------- */
function renderWeek() {
  const wrap = document.getElementById("tab-week");
  if (!wrap) return;
  const base = startOfWeek(new Date());
  if (weekOffset) base.setDate(base.getDate() + weekOffset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) { const d = new Date(base); d.setDate(base.getDate() + i); days.push(d); }
  const agg = aggregateRange(days[0], days[6]);
  const wkNames = ["一", "二", "三", "四", "五", "六", "日"];
  const byDate = READING.byDate || {}, ck = CHECKINS || {};
  const maxDay = agg.maxDay || 0;
  let bars = "";
  days.forEach((d, i) => {
    const key = fmtDate(d);
    const sec = byDate[key] || 0;
    const h = maxDay ? Math.max(6, Math.round(sec / maxDay * 100)) : 6;
    bars += `<div class="rep-bar ${sec ? "on" : ""}">
      <div class="rep-bar-fill" style="height:${h}%"></div>
      <div class="rep-bar-d">${wkNames[i]}</div>
      <div class="rep-bar-t">${sec ? fmtDur(sec) : ""}</div>
      ${ck[key] ? '<div class="rep-bar-c">✓</div>' : ""}
    </div>`;
  });
  const avg = agg.activeDays ? fmtDur(agg.total / agg.activeDays) : "0s";
  const top = agg.topBooks.length
    ? agg.topBooks.map((x) => `<div class="rep-topbook"><span>${escHtml(bookName(x.bid))}</span><b>${fmtDur(x.sec)}</b></div>`).join("")
    : '<div class="rep-empty">本周暂无阅读记录</div>';
  const noData = agg.total === 0;
  wrap.innerHTML = `
    <div class="rep-head">
      <button class="btn btn-ghost" id="wk-prev" title="上一周">‹</button>
      <span class="rep-title">${fmtDate(days[0])} ~ ${fmtDate(days[6])}</span>
      <button class="btn btn-ghost" id="wk-next" title="下一周">›</button>
      <button class="btn btn-ghost" id="wk-today">本周</button>
    </div>
    <div class="rep-metrics">
      <div class="rep-metric"><div class="k">本周总时长</div><div class="v">${fmtDur(agg.total)}</div></div>
      <div class="rep-metric"><div class="k">活跃天数</div><div class="v">${agg.activeDays} 天</div></div>
      <div class="rep-metric"><div class="k">打卡天数</div><div class="v">${agg.checkinDays} 天</div></div>
      <div class="rep-metric"><div class="k">日均(活跃)</div><div class="v">${avg}</div></div>
      <div class="rep-metric"><div class="k">最长单日</div><div class="v">${fmtDur(agg.maxDay)}</div></div>
    </div>
    ${noData ? '<div class="rep-empty">本周还没有阅读记录，去读一会儿书吧 📖</div>' : `
      <div class="rep-section-title">📅 每日阅读量</div>
      <div class="rep-bars">${bars}</div>
      <div class="rep-section-title" style="margin-top:18px">📚 本周书籍排行（Top 5）</div>
      <div class="rep-topbooks">${top}</div>`}
  `;
  document.getElementById("wk-prev").onclick = () => { weekOffset--; renderWeek(); };
  document.getElementById("wk-next").onclick = () => { weekOffset++; renderWeek(); };
  document.getElementById("wk-today").onclick = () => { weekOffset = 0; renderWeek(); };
}

/* ---------- 月报 ---------- */
function renderMonthRep() {
  const wrap = document.getElementById("tab-month");
  if (!wrap) return;
  const now = new Date();
  if (!repView) repView = { y: now.getFullYear(), m: now.getMonth() };
  const y = repView.y, m = repView.m;
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const daysInMonth = last.getDate();
  const agg = aggregateRange(first, last);
  const byDate = READING.byDate || {}, ck = CHECKINS || {};
  const maxDay = agg.maxDay || 0;
  let bars = "";
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, m, d);
    const key = fmtDate(dt);
    const sec = byDate[key] || 0;
    const h = maxDay ? Math.max(4, Math.round(sec / maxDay * 100)) : 4;
    const istoday = (y === now.getFullYear() && m === now.getMonth() && d === now.getDate());
    bars += `<div class="rep-bar ${sec ? "on" : ""} ${istoday ? "istoday" : ""}">
      <div class="rep-bar-fill" style="height:${h}%"></div>
      <div class="rep-bar-d">${d}</div>
      ${sec ? `<div class="rep-bar-t">${fmtDur(sec)}</div>` : ""}
      ${ck[key] ? '<div class="rep-bar-c">✓</div>' : ""}
    </div>`;
  }
  // 星期分布（按月内每天平均）
  const wdSum = [0, 0, 0, 0, 0, 0, 0], wdCnt = [0, 0, 0, 0, 0, 0, 0];
  agg.dayList.forEach((item) => { const w = parseDate(item.key).getDay(); wdSum[w] += item.sec; wdCnt[w]++; });
  const wdAvg = wdSum.map((s, i) => (wdCnt[i] ? s / wdCnt[i] : 0));
  const wdMax = Math.max(...wdAvg, 1);
  const wdNames = ["日", "一", "二", "三", "四", "五", "六"];
  let wdBars = "";
  wdAvg.forEach((v, i) => {
    const h = Math.max(3, Math.round(v / wdMax * 100));
    const active = v > 0;
    wdBars += `<div class="rep-wd-item ${active ? "on" : ""}">
      <div class="rep-wd-fill" style="height:${h}%"></div>
      <div class="rep-wd-d">${wdNames[i]}</div>
      <div class="rep-wd-t">${active ? fmtDur(v) : ""}</div>
    </div>`;
  });
  const checkRate = daysInMonth ? Math.round(agg.checkinDays / daysInMonth * 100) : 0;
  const avg = agg.activeDays ? fmtDur(agg.total / agg.activeDays) : "0s";
  const top = agg.topBooks.length
    ? agg.topBooks.map((x) => `<div class="rep-topbook"><span>${escHtml(bookName(x.bid))}</span><b>${fmtDur(x.sec)}</b></div>`).join("")
    : '<div class="rep-empty">本月暂无阅读记录</div>';
  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const noData = agg.total === 0;
  wrap.innerHTML = `
    <div class="rep-head">
      <button class="btn btn-ghost" id="mo-prev" title="上个月">‹</button>
      <span class="rep-title">${y} 年 ${monthNames[m]}</span>
      <button class="btn btn-ghost" id="mo-next" title="下个月">›</button>
      <button class="btn btn-ghost" id="mo-today">本月</button>
    </div>
    <div class="rep-metrics">
      <div class="rep-metric"><div class="k">本月总时长</div><div class="v">${fmtDur(agg.total)}</div></div>
      <div class="rep-metric"><div class="k">活跃天数</div><div class="v">${agg.activeDays} 天</div></div>
      <div class="rep-metric"><div class="k">打卡天数 / 率</div><div class="v">${agg.checkinDays} · ${checkRate}%</div></div>
      <div class="rep-metric"><div class="k">日均(活跃)</div><div class="v">${avg}</div></div>
      <div class="rep-metric"><div class="k">最长单日</div><div class="v">${fmtDur(agg.maxDay)}</div></div>
    </div>
    ${noData ? '<div class="rep-empty">本月还没有阅读记录，去读一会儿书吧 📖</div>' : `
      <div class="rep-section-title">📅 每日阅读量</div>
      <div class="rep-bars">${bars}</div>
      <div class="rep-section-title" style="margin-top:20px">🗓 星期分布（按日平均）</div>
      <div class="rep-wd">${wdBars}</div>
      <div class="rep-section-title" style="margin-top:20px">📚 本月书籍排行（Top 5）</div>
      <div class="rep-topbooks">${top}</div>`}
  `;
  document.getElementById("mo-prev").onclick = () => { repView = { y: m === 0 ? y - 1 : y, m: m === 0 ? 11 : m - 1 }; renderMonthRep(); };
  document.getElementById("mo-next").onclick = () => { repView = { y: m === 11 ? y + 1 : y, m: m === 11 ? 0 : m + 1 }; renderMonthRep(); };
  document.getElementById("mo-today").onclick = () => { repView = { y: now.getFullYear(), m: now.getMonth() }; renderMonthRep(); };
}
