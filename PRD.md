# LinguaReader · 产品需求文档（PRD）

> **版本**：v1.5.0 · **最后更新**：2026-09-06
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
| F6 | 知识库检索与管理（删除/清空经 `deletedKbIds` 墓碑跨设备同步） | 右侧知识库面板 | 已有 |
| F7 | 阅读统计（日历 / 周报 / 月报 / 打卡） | 顶栏「📊 阅读统计」 | 已有 |
| F8 | 词典偏好设置 | 顶栏「⚙ 词典偏好」 | 已有 |
| F9 | 知识库导出（HTML/Markdown/Word/Excel/CSV） | 顶栏「⬇ 导出知识库」 | 已有 |
| F10 | 可选云端同步（Supabase） | 顶栏「☁ 云同步」 | 已有 |
| **F11** | **本地自动备份与恢复** | 顶栏「💾 备份与恢复」 | **新增（v1.2.0）** |
| **F12** | **阅读欢迎 & 读完纪念（阅读仪式）** | 全局浮层（启动 / 读完触发） | **新增（v1.3.0）** |
| **F13** | **阅读区可切换高亮（Toggle）+ 撤销/重做** | 阅读区选区工具条「高亮」 | **新增（v1.3.0）** |
| **F14** | **返回原阅读位置** | 阅读区顶部「↩ 返回阅读位置」浮层按钮 | **新增（v1.4.0）** |

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
- **页面位置**：阅读区选区工具条 → `js/analysis.js` / `js/highlights.js`（可切换高亮 Toggle + 撤销/重做 + 已高亮文本菜单）；批注弹窗 `#annotation-modal`；「⚡ 一键智能批注」按钮。
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

> **墓碑机制（v1.4.0 增强）**：云端合并除 `deletedBookIds`（书籍墓碑）外，新增 `deletedKbIds`（笔记墓碑）。任一端删除一条笔记 / 清空知识库时，`js/knowledgebase.js` 调 `CloudSync.markKbDeleted(id)` → `ApiClient.markKbDeleted(id)` 把该 id 追加进本地 `store.deletedKbIds` 并 `PUT /api/store` 同步；服务端 `server.js` 的 `PUT /api/store` 按 `kbTomb`（服务端 `deletedKbIds` ∪ 传入 `deletedKbIds` 并集）过滤已删笔记，且仅移除「`body.kb` 已省略」的笔记（防 tombstone 污染误删）。彻底解决「本地删笔记 → 云端/手机端复活」（根因是 `sync.js` 的 union 合并曾让本地删除的笔记从云端复活）。

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

## 4.11 阅读区可切换高亮（Toggle）+ 撤销/重做（F13 · 新增 v1.3.0）

### 4.11.1 功能目的
把阅读区的「高亮」从一次性划线升级为**可切换（Toggle）**操作，并支持撤销/重做，让划线更可控、不误删：
- 选中未高亮的文字点「高亮」→ 添加高亮；
- 再次完整选中同一段已高亮的文字点「高亮」→ 取消该高亮；
- 只有选区**完整覆盖**某条已有高亮时才取消，部分覆盖不误删、不修改原高亮；
- 多段高亮彼此独立；
- 所有添加 / 取消 / 批注操作均可 `Ctrl+Z` 撤销、`Ctrl+Shift+Z` / `Ctrl+Y` 重做，或点刚操作后的底部「撤销」提示。

### 4.11.2 页面位置
- 入口：阅读区选区工具条（`#selection-popup`）的「高亮」按钮（act=`highlight`）。
- 已高亮文本：点击弹出 `#mark-menu`（批注 / 改批注 / 删除）。
- 撤销提示：操作后页面底部出现 `#lr-undo-toast`（撤销 / 关闭）。

### 4.11.3 用户交互
1. 在阅读区选中一段文本 → 选区工具条出现 → 点「高亮」。
2. 若选区完整覆盖某条已有高亮 → 取消这些高亮（提示「已取消高亮 N 处」）；否则新增一条独立高亮（提示「已高亮 N 处」）。
3. 刚操作后出现底部「撤销」提示，点「撤销」立即回退；或全局 `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`。
4. 点击已高亮文本 → 弹菜单：批注（写/改批注，进入 `#annotation-modal`）、删除（移除该高亮，若已关联知识库条目一并删除）。

### 4.11.4 数据流
- 高亮 = `book.marks[]` 的元素：`{ id, chapterIdx, paraIdx, startOff, endOff, text, color, note, kbId, annotationType, exportable, createdAt }`。
- **基于位置而非内容**：判定「完整覆盖」严格用 `chapterIdx/paraIdx/startOff/endOff`，不比较文字；同一句话在书中多次出现也不会误取消其他位置。
- 渲染：按字符偏移重建 `<p>` 的 `innerHTML`，把覆盖区间包成 `<mark class="lr-mark">`，天然支持同段多条、重叠时跳过已覆盖部分。
- 持久化：`highlights.js` 防抖 250ms 调 `ApiClient.updateBook(book.id, { marks })` → 服务端 `PUT /api/books/:id` 整体替换 `book.marks`（客户端权威）。

### 4.11.5 数据库变化
- 本地 `data/store.json` 与 `data/books/<id>.json` 的 `book` 对象新增 `marks` 数组（与书籍一起双写）。
- 云端 `kb_store`：高亮随 `minimizeForCloud` 的轻量元数据同步（marks 属小数据，随书籍同步）；无表结构变化。

### 4.11.6 API 调用
- 复用既有 `PUT /api/books/:id`：`body.marks` 为数组时整体替换 `book.marks`；缺失该字段则不改动已有 marks（保证仅更新分类/标题时不会清空高亮）。
- 前端封装：`js/api.js` 的 `ApiClient.updateBook(id, patch)`。

### 4.11.7 AI Prompt
无（高亮为纯前端定位 + 持久化，不涉及 LLM）。

### 4.11.8 Workflow（操作历史栈）
- `highlights.js` 内置 `History` 栈（上限 50）：每次 create / setAnnotation / removeMark / toggleSelection 都 `push({bookId, description, before, after})`。
- `undo()`：恢复 `before` 快照并 `persist` + `render`；`redo()`：恢复 `after` 快照。
- 键盘：`document` 监听 `keydown`，在输入框（`INPUT/TEXTAREA/SELECT/contentEditable`）内不拦截，避免冲掉输入撤销。

### 4.11.9 异常处理
- 部分覆盖：只新增独立高亮，绝不改/删原高亮（满足「部分覆盖不误删」）。
- 多段独立：逐段处理，互不干扰。
- 刷新 / 退出重开：marks 随书籍持久化，渲染时按偏移原样套回，添加/取消状态正确保留。
- 同步冲突：marks 经 `PUT /api/books/:id` 整体替换，以客户端为权威，避免服务端旧数据覆盖本地最新高亮。

---

## 4.12 阅读欢迎 & 读完纪念（阅读仪式，F12 · 新增 v1.3.0）

### 4.12.1 功能目的
用轻量且有仪式感的方式强化「持续阅读」的正反馈：
- **欢迎**：打开工作台时随机弹一张浅绿卡片（真实书摘 + 当天日期 + 问候），无书时给温和引导。
- **读完纪念**：当读到最后一章、且滚到正文实际末尾时，弹完成卡片（「这是你读完的第 X 本书」+ 随机寄语 + 累计阅读时长），并在书库列表标记完成。
- 防重复、防误触，本地记录，不依赖云端。

### 4.12.2 页面位置
- 全局浮层容器 `#reading-ritual-root`（脚本 `js/reading-ritual.js` 自包含注入样式与 DOM）。
- 触发：欢迎由 `app.js` 初始化后调 `ReadingRitual.showWelcomeOnce()`；完成由阅读区滚动 `ReadingRitual.onReadingScroll()` 检测。

### 4.12.3 用户交互
- 欢迎弹窗：点「开始阅读」关闭；背景点击 / Esc 关闭；**同一次启动只显示一次**。
- 完成弹窗：点「继续阅读其他书」→ 关闭并触发 `onContinue`（回到书库）；点「关闭」/背景/Esc 关闭。
- 完成记录去重：同一本书只计一次「第 X 本」，重复读完不重复弹、不重复计数。

### 4.12.4 数据流
- **书摘来源**：仅取自书库真实正文——遍历 `book.chapters[].paragraphs`，剥离标签后按句切分，筛选长度 28–340 字符、实质字符≥8 的完整句子，随机取一条作「今日书摘」；无可用正文时回退普通欢迎（不报错）。
- **完成记录**：写入浏览器 `localStorage` 键 `lr_completions_v1`，结构 `[{ bookId, completedAt, completedOrder, totalReadingTime }]`；`completedOrder` 同一本书只计一次。
- **累计时长**：复用系统 `READING.seconds`（含未结算秒），由 `app.js` 的 `getReadingSeconds(bookId)` 提供，不新建数据。

### 4.12.5 数据库变化
- 无云端变化；不写 `data/store.json`、不写 Supabase。
- 新增浏览器 `localStorage` 键 `lr_completions_v1`（阅读完成记录）。**注意**：它属于浏览器本地存储，换浏览器 / 清缓存会清空，但主数据（书库/进度/知识库）不受影响；备份/恢复不触碰该键。

### 4.12.6 API 调用
无（纯前端 + 浏览器 `localStorage`）。

### 4.12.7 AI Prompt
无。

### 4.12.8 Workflow（与 app.js 协作）
- `app.js` 初始化：`ReadingRitual.init({ getBooks, getReadingSeconds, onContinue })` → `setContext(currentBookCtx())` → `showWelcomeOnce()`。
- 选书 / 切章：`selectBook` / `gotoChapter` / 手动切章均调 `setContext(currentBookCtx())`（告知当前书/章，供判定「是否最后一章」）。
- 阅读滚动：`onReadingScroll()` → `ReadingRitual.onReadingScroll()` 立即检测是否到达末尾。
- 移除书：`clearContext()` 清空上下文。

### 4.12.9 异常处理
- 完成判定仅在「最后一章 + 滚到正文实际末尾（误差 ≤12px）」时触发，避免中途误弹。
- 任何抽取/渲染异常都回退普通欢迎，不抛错、不影响阅读。
- `localStorage` 容量满时静默忽略；`isCompleted` 防重复弹窗（同启动 + 持久化双保险）。

---

## 4.13 返回原阅读位置（Return-to-Reading · 新增 v1.4.0）

### 4.13.1 功能目的
在「知识库 → 原文定位」「批注定位」等从阅读区跳转到原文查看的场景中，提供「返回阅读位置」能力：用户跳转查看后，可一键精确回到**跳转前的正常阅读位置**，且这次临时跳转**绝不污染 / 覆盖**正常阅读进度（`progress`）。

### 4.13.2 页面位置
- 入口：`index.html` 阅读区 `.reading-pane` 内的浮层按钮 `#return-reading-btn`（默认 `hidden`，进入临时跳转后显示）。
- 样式：`styles.css` 的 `.return-reading-btn`（右上浮层）。

### 4.13.3 用户交互
1. 正常阅读时，从知识库条目 / 批注点「定位到原文」→ 阅读区跳转到目标章节与位置。
2. **首次**从正常阅读进入时（临时状态为空），系统自动冻结「当前精确阅读位置 A」（章节 + 段落 + 滚动 + 文本指纹）并显示「↩ 返回阅读位置」按钮。
3. 用户在原文中继续阅读（滚动 / 切章 / 主动阅读）不会强制返回；连续多次定位不覆盖 A（始终回到最初进入前的位置）。
4. 点「↩ 返回阅读位置」→ 精确恢复 A（章节 + 滚动 + 段落 + 文本指纹）→ 清除临时状态、隐藏按钮。
5. 切书 / 切章 / 关闭页面（`beforeunload` / `pagehide` / `visibilitychange(hidden)`）自动清除临时状态。

### 4.13.4 数据流
- 临时返回位置存于浏览器 `localStorage` 键 **`lr_temp_return`**（结构 `{bookId, chapter, scroll, paraIdx, fingerprint, ...}`），由 `js/api.js` 的 `getTempReturn` / `setTempReturn` / `clearTempReturn` 维护。
- **与正常进度完全分离**：正常阅读进度在 `store.progress[bookId]`（经 `PUT /api/books/:id/progress` 同步云端）；临时返回位置**不进 `store.json`、不进云端同步、不参与备份**。
- `js/app.js` 顶层变量 `temporaryReturnPosition` 持有内存态；`saveReadingPosition()` 在临时模式下直接 `return`（不写正常进度）；`selectBook` / `openBookAtChapter` 在临时模式下不记 `lastBook`、不写 `BOOK_PROGRESS`；`locateInBook()` 首次进入调 `captureReadingPosition()` 冻结 A 并 `ApiClient.setTempReturn(A)`；`restoreReturnPosition()` 精确回 A 并 `clearTempReturnState()`。

### 4.13.5 数据库变化
- 无云端变化；不写 `data/store.json`、不写 Supabase。
- 新增浏览器 `localStorage` 键 `lr_temp_return`（返回阅读位置临时状态）。**注意**：属于浏览器本地存储，换浏览器 / 清缓存会清空，但正常阅读进度（主数据）不受影响；备份/恢复不触碰该键。

### 4.13.6 API 调用
无（纯前端 + 浏览器 `localStorage`，不新增任何 `/api/*` 端点）。

### 4.13.7 AI Prompt
无。

### 4.13.8 Workflow（与 app.js 协作）
- 进入临时跳转：`locateInBook()` → 若 `temporaryReturnPosition` 为空 → `captureReadingPosition()`（读取当前 `currentChapter` / `scrollTop` / 段落 / 文本指纹）→ 写入 `temporaryReturnPosition` + `localStorage.lr_temp_return` → 显示按钮。
- 返回：`restoreReturnPosition()` → 读取 `temporaryReturnPosition` → `openBookAtChapter(A.chapter, {scroll:A.scroll, ...})` 精确恢复 → 清空 `temporaryReturnPosition` → `clearTempReturn()` → 隐藏按钮。
- 状态清理：`init()` 清空临时状态；`selectBook`（切书）/ `gotoChapter`（切章）/ `beforeunload` / `pagehide` / `visibilitychange(hidden)` 均调 `clearTempReturnState()`。

### 4.13.9 异常处理
- 临时跳转绝不覆盖正常进度：`saveReadingPosition()` 在 `temporaryReturnPosition` 非空时直接返回（防抖滚动保存也不会写 `progress`）。
- 连续跳转不覆盖 A：仅在 `temporaryReturnPosition` 为空时才冻结（首次进入），后续定位只切章节渲染不改 A。
- 主动阅读不强制返回：滚动 / 切章后不自动触发返回；用户点按钮才返回。
- 刷新 / 重开：若 `lr_temp_return` 存在则恢复按钮态（依实现），否则正常阅读。

---

## 5. 数据模型

### 5.1 本地主数据 `data/store.json`
顶层字段（`server.js` `ensureStore()` 默认值）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `books` | Array | 书库；每本含 `id, title, author, language, category, type, fileName, fileSize, importTime, totalPages, totalTextLength, parseStatus, chapters`（解析正文）, `marks`（高亮/批注数组，v1.3.0 新增）, `progress` 冗余等 |
| `progress` | Object | 阅读进度；`progress[bookId] = {c:章节索引, s:滚动位置, u:时间戳, pid:段落索引, fp:文本指纹, page:页码序号}`（v1.3.0 在 `{c,s,u}` 基础上新增 `pid/fp/page`，用于精准恢复阅读位置与显示） |
| `kb` | Array | 知识库条目；`{id, bookId, category, tags, data, lang, createdAt, ...}` |
| `prefs` | Object | `{enabledDicts:[...], categories:[...]}` |
| `reading` | Object | `{seconds:{}, byDate:{}, byBookDay:{}}` 阅读时长统计 |
| `checkins` | Object | 打卡记录 |
| `lastBookId` | String\|null | 上次阅读的书 |
| `deletedBookIds` | Array | 已删除书的 tombstone（云端合并去重用） |
| `deletedKbIds` | Array | 已删除笔记的 tombstone（云端合并去重用，v1.4.0 新增） |
| `lemmaOverrides` | Object | 用户纠正的词形还原原型 `{词形: 原型}` |

> 说明：`data/books/<id>.json` 为每本书的独立副本（便于查看与备份），与 `store.json` 双写；启动时 `scanBooksDir()` 补齐缺失书籍。

> **v1.3.0 新增字段**：
> - `book.marks[]`：阅读区可切换高亮 / 批注数组，元素 `{ id, chapterIdx, paraIdx, startOff, endOff, text, color, note, kbId, annotationType, exportable, createdAt }`；基于「章节+段落+字符偏移」定位，随书籍双写持久化。
> - 浏览器 `localStorage` 键 `lr_completions_v1`（阅读完成记录，结构 `[{ bookId, completedAt, completedOrder, totalReadingTime }]`）：属于浏览器本地存储，**非** `store.json`、**非**云端；换浏览器/清缓存会清空，但主数据不受影响；备份/恢复不触碰该键。

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

### 📝 Update Summary（2026-09-06 · v1.5.0）

- **新增功能**：无（本次为 Bug 修复与续读行为修正）。
- **修改功能**
  - 「打开即续读」滚动恢复时序（F14 相关基础设施）：`init()` 中字号/行距/护眼偏好 `applyReaderPrefs()` 从「续读打开书之后」提前到「打开书之前」；`renderReadingArea` 的滚动恢复由单 `requestAnimationFrame` 改为双 `requestAnimationFrame`，等布局稳定后再设 `scrollTop`，避免大数值被夹到顶部。
  - 「上次读到这里」标记显示时序（§4.13 返回原阅读位置之标记子项）：有滚动可恢复时，在双 rAF 内**先恢复滚动、再显示标记**（锚点=真实滚动位置）；`onReadingScroll` 淡出判定加 `!_restoring` 守卫，恢复期间不误触发淡出。
- **删除功能**：无。
- **Bug 修复**
  - 续读滚动位置错位（调过字号/行距的书重开后正文滚回顶部/靠前）：根因为 `applyReaderPrefs` 在续读之后才应用，字号改大使内容顶高、像素滚动量对应更靠前位置；标记因按 `offsetTop` 重排后计算故位置对、正文却错。
  - 续读后「上次读到这里」标记消失：根因为双 rAF 改动使标记在第 1 帧显示（锚点记旧滚动 0）、第 2 帧大滚动恢复触发 `onReadingScroll` 判定偏离 >60px 而加 `faded`（`opacity:0`）。
- **数据库变更**：无。
- **API 变更**：无。
- **Prompt 变更**：无。
- **一致性**：四份文档统一 v1.5.0；续读/返回阅读位置行为在 README/PRD/TECHNICAL_DESIGN/BLUEPRINT 同步修正；标注 `package.json.version` 仍为 1.2.0（需人工补充升至 1.5.0）。

### 📝 Update Summary（2026-08-17 · v1.4.0）

- **新增功能**
  - **返回原阅读位置（Return-to-Reading，F14）**：在知识库/批注「定位到原文」跳转场景中，首次进入自动冻结「进入前精确阅读位置 A」（章节+段落+滚动+文本指纹），阅读区顶部出现「↩ 返回阅读位置」浮层按钮；点按精确回到 A 并清除临时状态。临时位置与正常阅读进度 `progress` 完全分离（独立 `localStorage` 键 `lr_temp_return`，不进 `store.json`、不进云端同步），临时跳转绝不覆盖正常进度；连续跳转不覆盖 A；主动阅读后不强制返回；切书/切章/关闭页面自动清除。
  - **笔记删除墓碑同步（`deletedKbIds`）**：与 `deletedBookIds` 同款，解决「本地删笔记 → 云端/手机端复活」（根因 `sync.js` union 合并）。任一端删笔记/清空知识库 → 追加 id 到 `deletedKbIds` → `PUT /api/store` 同步 → 合并按并集过滤。
  - **一键重启脚本 `restart_lr.bat`** + **任务计划程序自动重启** `LinguaReader_Service_Restart`（工作站解锁时运行 `restart_lr.bat`），解决休眠恢复后服务未连接。
- **修改功能**：启动/自启方案调整（启动文件夹 bat 直接前台运行 Node 弹黑框；`start_silent.bat` 调 `run_server_hidden.vbs` 暂弃用）；`PUT /api/store` 增强为「书籍 + 笔记双 tombstone 合并」。
- **删除功能**：无（`run_server_hidden.vbs` 无窗口方案因 bug 暂弃用但文件保留）。
- **Bug 修复**：笔记删除云端复活（deletedKbIds 墓碑 + kbTomb 守卫 + 本地写回护栏）；休眠恢复服务未连接（restart_lr.bat + 任务计划解锁触发器，待实测）。
- **数据库变更**：`store.json` 顶层新增 `deletedKbIds`；浏览器 `localStorage` 新增 `lr_temp_return`；云端 `kb_store` 无结构变化（payload 内新增 `deletedKbIds`）。
- **API 变更**：无新增端点；`markKbDeleted`/`clearKb` 复用 `PUT /api/store`/`DELETE /api/kb`；返回阅读位置无 API（localStorage）；`PUT /api/store` 扩展为双 tombstone 合并。
- **Prompt 变更**：无。
- **一致性**：四份文档统一 v1.4.0；功能表（F14）/ 数据模型（deletedKbIds）/ 映射 / Roadmap 覆盖返回阅读位置、笔记墓碑、自启；标注 `package.json.version` 仍为 1.2.0（需人工补充升至 1.5.0）。

### 📝 Update Summary（2026-08-10 · v1.3.0）

- **新增功能**
  - **阅读欢迎 & 读完纪念（阅读仪式，F12）**：打开随机欢迎卡片（真实书摘 + 日期 + 问候）；读完最后一章弹完成纪念（第 X 本 + 随机寄语 + 累计阅读时长）。完成记录存浏览器 `localStorage`（`lr_completions_v1`），防重复、本地优先、不依赖 Supabase、不进 `data/`。
  - **阅读区可切换高亮（Toggle）+ 撤销/重做（F13）**：选中点「高亮」= 添加；再次完整选中同一高亮= 取消（基于章节+段落+字符偏移定位，不依赖文字内容，部分覆盖不误删、多段独立）；`Ctrl+Z` 撤销 / `Ctrl+Shift+Z`(或 `Ctrl+Y`) 重做 + 底部「撤销」提示。
- **修改功能**：`book` 新增 `marks`（高亮/批注数组，经 `PUT /api/books/:id` 整体替换持久化）；阅读进度新增 `pid/fp/page`；启动脚本 `start.bat`/`start_silent.bat` 恢复为「系统无 Node 时自动回退 WorkBuddy 自带 Node」（依赖 WorkBuddy 运行环境，无需系统单独安装 Node.js）。
- **删除功能**：无（PDF 解析能力此前已彻底移除，本期确认上传层仍仅 `.txt/.md/.epub` 与粘贴）。
- **Bug 修复**：EPUB 上传 "Failed to fetch"（zlib-wrapped deflate 自动剥离头重试、单章失败跳过、错误提示区分引导）；桌面端重启打不开（系统无 Node.js → 脚本回退到 WorkBuddy 自带 Node）。
- **数据库变更**：`store.json` 的 `book` 新增 `marks`；浏览器 `localStorage` 新增 `lr_completions_v1`；云端 `kb_store` 无变化。
- **API 变更**：无新增端点；`marks` 复用 `PUT /api/books/:id`（body.marks 为数组时整体替换，缺失不改）。
- **Prompt 变更**：无。
- **一致性**：四份文档统一到 v1.3.0；修正「阅读区视觉划线高亮已移除」旧描述（v1.3.0 已重新实现为可切换高亮）；功能表 / 数据模型 / 页面结构 / 映射 / Roadmap 同步覆盖阅读仪式与高亮 Toggle。

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
