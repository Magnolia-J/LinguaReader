# LinguaReader · 产品需求文档（PRD）

> **版本**：v1.2.0 · **最后更新**：2026-08-09
> **文档定位**：描述 LinguaReader 工作台「做什么 / 为谁做 / 为什么」，是产品层面的需求基线。技术实现见 `TECHNICAL_DESIGN.md`，系统蓝图见 `BLUEPRINT.md`。

---

## 1. 产品概述

### 1.1 背景
外语学习者阅读英文 / 法文原版书时，最大的痛点是「读得懂句子、留不下积累」：遇到好词好句、语法点、批注，散落在大脑和截图里，无法沉淀成可检索、可复用的个人知识库；换设备后积累丢失；缺乏阅读时长的可视化激励。

### 1.2 目标
提供一个**本地优先（local-first）**的外语原版书精读工作台：
- 阅读时划词即可调用 AI 精读助手，自动沉淀词汇 / 表达 / 句型 / 批注到个人知识库；
- 统计阅读时长与打卡，形成正反馈；
- 支持**可选**云端同步，在手机端随时查看；
- 支持**本地自动备份与恢复**，防止本地数据丢失。

### 1.3 非目标（本期明确不做）
- 不做在线书城 / 版权书籍分发；
- 不内置任何人的云端账号或密钥（所有 Supabase / LLM 配置由用户自己在 `.env` 或界面填写）；
- 不做多人协作 / 公开分享（数据按登录用户隔离，仅本人可见）；
- 不做服务端 AI 以外的重计算（语法树、翻译引擎等依赖 LLM）。

### 1.4 设计原则
- **本地优先**：无网络、无密钥也能完整使用（除云端同步 / 服务端 AI 代理）；
- **隐私至上**：源码不含真实密钥；敏感字段备份时脱敏；云端仅靠 RLS 行级隔离；
- **最小改动 / 渐进演进**：新增能力以「增量、可回退」方式叠加，不重构既有核心逻辑；
- **失败隔离**：任何增强能力（同步、备份、AI）失败都不得影响基础阅读与本地保存。

---

## 2. 用户角色

| 角色 | 说明 | 关键诉求 |
|---|---|---|
| 外语学习者（主用户） | 桌面端精读 + 手机端查阅 | 积累知识库、看得懂、不丢数据 |
| 自托管部署者 | 在自家机器 / 服务器跑 `node server.js` | 简单启动、数据自控、可公网但带令牌防护 |
| 开源使用者 | Clone 仓库自行配置 | 不连作者云端、用自己密钥、文档可复刻 |

---

## 3. 功能需求总览

| 编号 | 功能 | 页面位置 | 状态 |
|---|---|---|---|
| F1 | 书库管理与导入（TXT/MD/EPUB/粘贴） | 顶栏「＋」→ 上传弹窗 | 已有 |
| F2 | 原版书阅读（章节 / 进度 / 阅读计时） | 主阅读区 | 已有 |
| F3 | AI 查词（词义 / 词性 / 搭配 / 例句） | 选区工具条 → AI | 已有 |
| F4 | AI 句子解析 / 语法讲解 | 选区工具条 → AI | 已有 |
| F5 | 划词批注 / 收藏到知识库 | 选区工具条 → 批注弹窗 | 已有 |
| F6 | 知识库检索与管理 | 右侧知识库面板 | 已有 |
| F7 | 阅读统计（日历 / 周报 / 月报 / 打卡） | 顶栏「📊 阅读统计」 | 已有 |
| F8 | 词典偏好设置 | 顶栏「⚙ 词典偏好」 | 已有 |
| F9 | 知识库导出（HTML/Markdown/Word/Excel/CSV） | 顶栏「⬇ 导出知识库」 | 已有 |
| F10 | 可选云端同步（Supabase） | 顶栏「☁ 云同步」 | 已有 |
| **F11** | **本地自动备份与恢复** | 顶栏「💾 备份与恢复」 | **新增（v1.2.0）** |

---

## 4. 详细功能需求

### 4.1 书库管理与导入（F1）
- **目的**：把本地文本 / 电子书纳入书库，自动分章、识别书名 / 作者 / 语言。
- **页面位置**：顶栏「＋ 添加书籍」→ `#upload-modal`。
- **交互**：支持 `.txt/.md`（自动分章、识别元数据）、`.epub`（解析章节与正文）、直接粘贴纯文本；解析后弹出 `#meta-modal` 让用户校正书名 / 作者 / 语言 / 分类，确认后加入书库。
- **数据流**：前端 `js/upload.js` 解析 → `POST /api/books` → 服务端写入 `data/store.json`（books 数组）并双写 `data/books/<id>.json`。
- **API**：`POST /api/books`。
- **异常**：解析失败给出可读错误；重复导入按 id 去重；损坏的 `data/books/` 文件在启动时由 `scanBooksDir()` 兜底补齐（防 `store.json` 损坏丢书）。

### 4.2 原版书阅读与进度（F2）
- **目的**：流畅阅读原文，记录精确阅读位置与累计时长。
- **页面位置**：主阅读区 `#reading-area`。
- **交互**：章节切换、滚动阅读；离开 / 定时自动保存进度。
- **数据流**：进度写入 `store.progress[bookId] = {c:章节, s:滚动位置, u:时间戳}`；时长写入 `store.reading = {seconds, byDate, byBookDay}`。
- **API**：`PUT /api/books/:id/progress`、`PUT /api/reading`、`PUT /api/lastbook`、`GET /api/state`。
- **异常**：进度保存失败仅本地 toast 提示，不影响阅读。

### 4.3 / 4.4 AI 精读助手（F3/F4/F5）
- **目的**：划词 / 划句调用 LLM，输出结构化、可入库的分析；支持批注与一键全书智能批注。
- **页面位置**：阅读区选区工具条 → `js/analysis.js` / `js/highlights.js`；批注弹窗 `#annotation-modal`；「⚡ 一键智能批注」按钮。
- **交互**：选中文本 → 工具条 → 选择「查词 / 句子 / 语法 / 批注」；`js/strictSelect.js` 严格获取真实选区（禁止截断 / 扩展），并对 AI 返回做完整性校验，遗漏自动 `retry` 重请求。
- **数据流**：前端组装消息（`llm.js` 的 `buildAnalyzeMessages` / `buildAnnotateMessages`）→ `POST /api/analyze` 或 `POST /api/annotate`（服务端 `llm.js` 调用 LLM）→ 返回 JSON → 写入知识库 / 批注。
- **API**：`POST /api/analyze`、`POST /api/annotate`、`PUT /api/lemma-override`。
- **AI Prompt / 模型**：见 `TECHNICAL_DESIGN.md §7`；模型与 Key 来自 `.env`（`LLM_API_KEY` / `LLM_MODEL` 等），纯静态托管无服务端代理时该功能不可用（预期内）。
- **异常**：LLM 超时 / 返回非 JSON → 前端提示重试；StrictSelect 完整性校验失败 → 自动重请求一次。
- **本地 AI 分析缓存（localStorage）**：`js/app.js` 的 `doAnalyze()` 在调用 AI 前先查浏览器 `localStorage`（键 `lr_analysis_cache_v1`，按 `语言+句子` 命中）；命中则直接返回，**避免重复调用 API / 重复 AI 响应**；未命中才请求并在返回后写回缓存（容量满则静默忽略）。该缓存**离线可用、不写入 `data/`、不进 Supabase**；备份/恢复不触碰它（换设备/清浏览器会清空，但主数据安全）。

### 4.5 知识库（F6）
- **目的**：统一沉淀与检索词汇 / 表达 / 句型 / 精彩句 / 写作素材 / 文学笔记 / 批注。
- **页面位置**：右侧知识库面板（`#kb-*`）。
- **交互**：检索、按类型 / 标签筛选、（一键）清空；条目来自 F3/F4/F5 的 AI 产出。
- **数据流**：`store.kb` 数组（每条 `{id, bookId, category, tags, data, lang, createdAt, ...}`）；去重指纹 `kbFingerprint`（见 `js/storage-layers.js`）。
- **API**：`GET /api/kb`、`POST /api/kb`、`DELETE /api/kb`。

### 4.6 阅读统计（F7）
- **目的**：用日历 / 周报 / 月报与打卡激励持续阅读。
- **页面位置**：顶栏「📊 阅读统计」→ `#stats-modal`（日历 / 周 / 月三标签）。
- **交互**：切换标签、查看每日时长与打卡；顶栏快捷统计（总时长 / 今日 / 连续天数）点击跳转对应标签。
- **数据**：来自 `store.reading` 与 `store.checkins`。

### 4.7 词典偏好（F8）
- **目的**：选择批注 / 导出时引用的词典来源。
- **页面位置**：顶栏「⚙ 词典偏好」→ 词典偏好弹窗。
- **数据**：`store.prefs.enabledDicts` / `store.prefs.categories`。

### 4.8 导出（F9）
- **目的**：把个人知识库导出为多格式，便于复习 / 分享 / 手机查看。
- **页面位置**：顶栏「⬇ 导出知识库」→ `#export-modal`。
- **交互**：选书 / 选内容类型 / 选词典来源 / 选格式（HTML / Markdown / Word / Excel / CSV），支持预览与「按词典来源筛选」。
- **API**：纯前端生成（无专属后端接口，读取 `GET /api/state` 或本地 store）。

### 4.9 可选云端同步（F10）
- **目的**：多设备（桌面 + 手机）共享知识库与阅读时长。
- **页面位置**：顶栏「☁ 云同步」→ `#cloud-modal`（登录 / 注册 / 同步）。
- **数据流**：前端 `js/sync.js` 经 Supabase（`kb_store` 整包 jsonb，按 `auth.uid()` 隔离）合并多端数据；服务端 `server.js` 在配置了 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE` 时也会把整包 `store.json` 异步写入 `kb_store`（防免费主机本地磁盘临时丢数据）。最小化同步逻辑见 `js/storage-layers.js`（`minimizeForCloud` / `mergeBooksLocalFirst`）。
- **API**：`GET/PUT /api/store`（pull / push 整包）。
- **安全**：前端 anon key 靠 RLS 隔离；可关闭公开注册（Supabase 后台）仅允许已建账号登录。

---

## 4.10 本地自动备份与恢复（F11 · 新增 v1.2.0）

### 4.10.1 功能目的
在**不依赖云端**的前提下，为本地核心数据提供「自动 + 手动」的版本化备份与一键恢复，防止误删、文件损坏、重装导致的积累丢失；同时满足：不含原始书籍二进制、不含密钥、绝不写入 Supabase、失败不影响正常使用。

### 4.10.2 页面位置
- 入口：顶栏「💾 备份与恢复」按钮（`#backup-btn`）。
- UI：弹窗 `#backup-modal`（`js/backup.js` 控制），含：
  - 备份设置区（目录输入框 `#backup-dir`、「默认」按钮 `#backup-browse`、自动开关 `#backup-auto`、保留天数 `#backup-retain`、「保存设置」`#backup-save-cfg`）；
  - 操作区（「立即备份」`#backup-now` + 状态 `#backup-now-status`）；
  - 历史备份列表（`#backup-list`，含每条的「恢复」按钮）。

### 4.10.3 用户交互
1. 打开弹窗自动加载当前备份设置与历史列表。
2. **修改备份位置**：编辑目录输入框或点「默认」还原为项目根 `WorkbenchBackup/` → 「保存设置」。
3. **立即备份**：点「立即备份」→ 状态显示「正在备份…」→ 成功显示时间戳，列表刷新。
4. **恢复**：点某条备份的「恢复」→ 浏览器 `confirm` 弹窗（明确警告会覆盖当前数据，并建议先「立即备份」）→ 确认后系统先自动备份当前状态（安全网 `pre-restore-*`），再覆盖恢复，随后自动刷新页面。

### 4.10.4 数据流
- **备份写**：服务端 `createBackup(label)` → 读取内存 `store` → `sanitizeForBackup(store)`（深拷贝并剔除敏感键）→ 写入 `WorkbenchBackup/<label>-<时间戳>/store.json`；复制 `data/books/*.json`（仅 `.json`）到该文件夹 `books/`；写 `backup-manifest.json`（含 createdAt / label / books 数 / kb 数 / 大小 / 版本）；最后 `cleanOldBackups()` 清理过期。
- **列表读**：`listBackups()` 扫描备份目录，读取各 `backup-manifest.json`，统计大小，按时间倒序返回。
- **恢复写**：`restoreBackup(name)` → 先 `createBackup("pre-restore")` 做安全网 → 读取目标 `store.json` → 替换内存 `store` → `normalizeStore()` → `saveStore()`（原子写回 `data/store.json`）→ 复制目标 `books/*.json` 回 `data/books/`。

### 4.10.5 数据库变化
- **无云端变化**：备份完全在本地文件系统，不触碰 Supabase `kb_store`。
- **本地新增**：`data/backup-config.json`（备份设置：`{dir, auto, retainDays}`）；`WorkbenchBackup/<时间戳>/` 目录树（多个版本快照）。两者均被 `.gitignore` 排除。

### 4.10.6 API 调用
| 方法 | 路径 | 说明 | 请求体 | 返回 |
|---|---|---|---|---|
| GET | `/api/backup/config` | 获取备份设置 | — | `{dir, auto, retainDays}` |
| PUT | `/api/backup/config` | 保存设置 | `{dir?, auto?, retainDays?, resetDir?}` | 更新后的配置 |
| POST | `/api/backup` | 立即备份（manual） | — | `{ok, folder, manifest}` 或 `{ok:false, error}` |
| GET | `/api/backups` | 列出历史备份 | — | `{backups:[{name,createdAt,books,kb,label,size}], dir}` |
| POST | `/api/backup/restore` | 恢复指定版本 | `{name}` | `{ok, restored}` 或 `{ok:false, error}` |

前端封装于 `js/api.js` 的 `ApiClient`：`backupConfig / setBackupConfig / backupNow / listBackups / restoreBackup`。

### 4.10.7 AI Prompt
无（备份功能不涉及 LLM）。

### 4.10.8 Workflow（自动触发）
- 写入路径：`saveStore()`（任何重要数据变更的统一落盘点）→ 末尾调用 `scheduleBackup()`。
- `scheduleBackup()`：若处于播种阶段（`_seeding`）或自动备份关闭则跳过；否则标记 `_backupDirty` 并启动 120 秒防抖定时器；窗口内多次变更只触发**一次**备份（避免每次操作都备份）。
- 备份目录不存在时自动创建；失败仅 `console.warn` + 日志，绝不抛出。

### 4.10.9 异常处理
- **备份失败**：全程 `try/catch`，仅写日志，不影响正常保存与阅读；前端 toast 提示「备份失败」。
- **恢复失败**：返回 `{ok:false, error}`；若失败在「安全网备份」之后、覆盖之前，原数据不受影响；前端提示错误。
- **目录穿越防护**：`restoreBackup(name)` 对 `name` 做 `/\\` 过滤，防止路径穿越。
- **过期清理**：仅删除超过 `retainDays` 的备份子文件夹，不影响最新数据与设置。

---

## 5. 数据模型

### 5.1 本地主数据 `data/store.json`
顶层字段（`server.js` `ensureStore()` 默认值）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `books` | Array | 书库；每本含 `id, title, author, language, category, type, fileName, fileSize, importTime, totalPages, totalTextLength, parseStatus, chapters`（解析正文）, `progress` 冗余等 |
| `progress` | Object | 阅读进度；`progress[bookId] = {c:章节索引, s:滚动位置, u:时间戳}` |
| `kb` | Array | 知识库条目；`{id, bookId, category, tags, data, lang, createdAt, ...}` |
| `prefs` | Object | `{enabledDicts:[...], categories:[...]}` |
| `reading` | Object | `{seconds:{}, byDate:{}, byBookDay:{}}` 阅读时长统计 |
| `checkins` | Object | 打卡记录 |
| `lastBookId` | String\|null | 上次阅读的书 |
| `deletedBookIds` | Array | 已删除书的 tombstone（云端合并去重用） |
| `lemmaOverrides` | Object | 用户纠正的词形还原原型 `{词形: 原型}` |

> 说明：`data/books/<id>.json` 为每本书的独立副本（便于查看与备份），与 `store.json` 双写；启动时 `scanBooksDir()` 补齐缺失书籍。

#### 5.1.1 本地数据目录总览（`data/`，可用 `LR_DATA_DIR` 覆盖）

| 路径 | 用途 | 实际落盘 |
|---|---|---|
| `data/store.json` | **主数据（唯一真相源）**：books（含 `chapters` 解析正文）/ progress / kb / 批注划线 / reading / checkins / prefs / lemmaOverrides / deletedBookIds | ✅ 持续写入（原子写 `.tmp`+rename，写前留 `.bak`） |
| `data/books/<id>.json` | 每本书解析副本（与 store.json 双写） | ✅ 实际写入 |
| `data/backup-config.json` | 备份设置 `{dir, auto, retainDays}`（v1.2.0） | ✅ 实际写入 |
| `data/annotations/` · `data/vocabulary/` · `data/reading-progress/` · `data/settings/` · `data/analysis-cache/` | **预留目录**：`ensureLocalDirs()` 启动时 `mkdir -p` 创建，便于将来按类型拆分落盘 | ⚠️ 暂未启用（数据仍集中在 `store.json`） |
| `WorkbenchBackup/` | 本地自动备份输出（v1.2.0） | ✅ 实际写入 |

> **AI 分析缓存不在 `data/analysis-cache/`**：真正的本地 AI 分析缓存在**浏览器 `localStorage`**（键 `lr_analysis_cache_v1`，按 `语言+句子` 命中），离线可用、不写 `data/`、不进 Supabase；备份/恢复只覆盖服务端 `data/store.json` 与 `data/books/`，不触碰该缓存。
>
> **复刻提示**：本地优先模式**零 npm 依赖**，`server.js` 用 `try/catch` 包裹地 `require('@supabase/supabase-js')`（仅云端同步需要）。纯本地只需 `node server.js`（`npm start` 亦可），无需 `npm install`；桌面端另有 `start.bat`（启服务+开浏览器）/ `start_silent.bat`（仅启服务，开机自启用）。

### 5.2 云端 `kb_store`（仅同步用，备份不涉及）
```
kb_store (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  payload   jsonb not null default '{}',
  updated_at timestamptz not null default now()
)
```
RLS 策略 `kb_store_owner`：`auth.uid() = user_id`；索引 `kb_store_updated_idx`；已开启 Realtime 推送。

---

## 6. 非功能性需求

- **性能**：本地 `store.json` 原子写（`.tmp` + rename）；自动备份防抖合并，避免高频 IO；云端整包同步最小化为轻量元数据（见 `storage-layers.js`）。
- **隐私 / 安全**：源码零真实密钥；`.env` 与 `data/`、`WorkbenchBackup/` 均 Git 排除；备份脱敏；公网部署可用 `LR_TOKEN` 给 `/api/*` 加访问令牌。
- **兼容性**：桌面端 Chrome / Edge 等现代浏览器；手机端为静态页（GitHub Pages 或局域网版）；PWA 可「添加到主屏幕」。
- **可恢复性**：本地自动备份 + 云端同步双保险；恢复前安全网快照。

---

## 7. 约束与第三方依赖

- **运行时**：Node.js ≥ 18（桌面端后端）；纯静态前端。
- **依赖**：仅 `@supabase/supabase-js`（云端同步可选）；LLM 走服务端 `fetch` 代理（`llm.js`），无额外 SDK。
- **外部服务（均由用户自己配置，非内置）**：任意 OpenAI 兼容 LLM（OpenAI / DeepSeek / SiliconFlow / Gemini / 通义 / 智谱 / 腾讯混元 等）；Supabase（可选云端同步）。
- **不内置**：任何 API Key、Supabase URL/Key、用户账号。

---

## 8. Update Summary（2026-08-09 · v1.2.0）

- **新增功能**：本地自动备份与恢复（F11）——服务端备份模块 + 前端「💾 备份与恢复」弹窗；自动（saveStore 后 120s 防抖）/ 手动备份；默认 `WorkbenchBackup/`，可改位置、保留天数（默认 7）；历史查看与版本恢复（恢复前确认 + 安全网快照）；脱敏、不含原始二进制、不上云、失败隔离。
- **修改功能**：无其它逻辑改动。
- **删除功能**：无。
- **Bug 修复**：无（本期为新增功能）。
- **数据库变更**：本地新增 `data/backup-config.json` 与 `WorkbenchBackup/` 目录（均 Git 排除）；云端 `kb_store` 无变化。
- **API 变更**：新增 `GET/PUT /api/backup/config`、`POST /api/backup`、`GET /api/backups`、`POST /api/backup/restore`。
- **Prompt 变更**：无。
- **⚠️ 待人工确认**：无（手机端默认 Supabase 配置事项已于 v1.1.0 标注，本期未改动）。

### 📝 文档补全（2026-08-09 晚 · 仅文档，代码未变）

为达到「开发者/AI 仅凭文档即可完整复刻」的目标，补齐此前遗漏并修正一处误导：

- **新增 §5.1.1 本地数据目录总览**：明确真实落盘位置（`store.json` + `books/` + `backup-config.json` + `WorkbenchBackup/`），并标注 `annotations|vocabulary|reading-progress|settings|analysis-cache/` 为**预留 stub 目录**（已 mkdir，数据仍集中在 `store.json`）。
- **新增 §4.3/4.4 本地 AI 分析缓存**：说明缓存在**浏览器 `localStorage`（`lr_analysis_cache_v1`，按 语言+句子 命中）**，不在 `data/analysis-cache/`；备份/恢复不触碰。
- **修正复刻依赖**：本地优先模式零 npm 依赖，`npm install` 仅云端同步需要。
- **新增 sw.js v3 根因**：`TECHNICAL_DESIGN.md §4.3` 补充「`sw.js` 升至 v3 清除以往对 `/api/*` 的毒缓存」是书库消失修复的一环（首次升级需 Ctrl+Shift+R 硬刷新）。
