# LinguaReader · 技术设计文档（TECHNICAL DESIGN）

> **版本**：v1.2.0 · **最后更新**：2026-08-09
> **文档定位**：描述「怎么实现」——架构、数据层、后端 API、前端模块、备份 / AI / 同步设计、安全与部署。产品需求见 `PRD.md`，系统蓝图见 `BLUEPRINT.md`。

---

## 1. 架构总览

### 1.1 设计哲学：Local-First
- 所有核心数据以**本地文件**为唯一真相源（`data/store.json` + `data/books/*.json`）。
- 后端仅一个 Node 原生 `http` 服务（`server.js`，无 Express），负责静态托管 + 本地持久化 + 可选 LLM 代理 + 可选 Supabase 镜像 + **本地备份**。
- 前端为纯静态文件（`index.html` + `js/*.js` + `styles.css` + `sw.js` PWA），经 `ApiClient`（`js/api.js`）与后端通信。
- 云端（Supabase）**仅作可选镜像**，不决定本地可用性；离线时全部功能本地可用。

### 1.2 组件关系（ASCII）

```
┌──────────────────────────────────────────────────────────┐
│ 浏览器（桌面端 index.html / 手机端 index.html）            │
│  js/app.js · analysis · highlights · knowledgebase ·       │
│  stats · upload · sync · backup · strictSelect · …         │
│        │  ApiClient (fetch /api/*)                         │
└────────┼───────────────────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────┐
│ Node http 服务  server.js  (端口 3007, 0.0.0.0)            │
│  ├─ 静态托管 ./ (index.html, js/, styles.css, sw.js)       │
│  ├─ 本地持久化：loadStore / saveStore（原子写）            │
│  ├─ 书籍双写：data/books/<id>.json                        │
│  ├─ LLM 代理：llm.js (callLLM) ← .env (LLM_*)             │
│  ├─ 云端镜像：pushToSupabase / pullFromSupabase (可选)     │
│  └─ 本地备份：createBackup / listBackups / restoreBackup   │
│        → WorkbenchBackup/<时间戳>/  ← 绝不进 Supabase     │
└────────┬───────────────────────────┬──────────────────────┘
         ▼                           ▼
   本地文件系统                   Supabase (可选)
   data/store.json               kb_store (jsonb, RLS)
   data/books/*.json
   WorkbenchBackup/
```

### 1.3 关键约束
- 服务端通过环境变量开关可选能力（`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE` 决定云端镜像；`.env` 的 `LLM_*` 决定 AI）。
- 所有「增强能力」失败必须隔离：`saveStore` 中的 `scheduleBackup()`、`pushToSupabase()` 均在 `try/catch` 内，失败仅日志。

---

## 2. 目录结构与职责

| 路径 | 职责 |
|---|---|
| `server.js` | Node 后端：静态托管、本地持久化、LLM 代理、Supabase 镜像、备份模块、全部 `/api/*` 路由 |
| `index.html` | 桌面端单页（含所有弹窗骨架 `#*-modal`、顶栏按钮、`<script>` 加载顺序） |
| `styles.css` | 全部样式（含各弹窗 / 备份弹窗样式） |
| `sw.js` | PWA Service Worker（网络优先 + 清理旧缓存） |
| `llm.js` | LLM 调用与 `.env` 读取（支持别名变量） |
| `js/api.js` | `ApiClient`：统一 `req()` 封装所有 `/api/*` 调用 |
| `js/app.js` | 主控制器：`init()`、各弹窗开关、`toast()`、导出、批注入口、`setupStats()` 等 |
| `js/books.js` | 书库渲染与管理 |
| `js/upload.js` | 导入解析（TXT/MD/EPUB/粘贴） |
| `js/analysis.js` | AI 查词 / 句子解析 / 语法讲解调用 |
| `js/highlights.js` | 选区工具条与批注 / 收藏入口 |
| `js/strictSelect.js` | 严格选区规范（StrictSelect）+ AI 返回完整性校验 / retry |
| `js/knowledgebase.js` | 知识库渲染、检索、增删、去重指纹 |
| `js/stats.js` | 阅读统计（日历 / 周 / 月） |
| `js/sync.js` | 云端同步（Supabase 客户端、合并、Realtime、登录注册） |
| `js/storage-layers.js` | 存储分层：`minimizeForCloud` / `mergeBooksLocalFirst` / `kbFingerprint` |
| `js/backup.js` | **本地自动备份与恢复 UI 模块（v1.2.0 新增）** |
| `js/llm-config.js` / `js/supabase-config.js` | 前端 LLM / Supabase 配置（空占位，用户自填） |
| `js/reading-ritual.js` | 阅读仪式 / 开始阅读引导 |
| `data/store.json` | 本地主数据（Git 排除） |
| `data/books/<id>.json` | 每本书独立解析副本（Git 排除） |
| `data/backup-config.json` | 备份设置（Git 排除，v1.2.0 新增） |
| `WorkbenchBackup/` | 本地备份输出（Git 排除，v1.2.0 新增） |
| `supabase/schema.sql` | 云端建表脚本（表 + RLS + 索引 + Realtime） |
| `supabase/SYNC_GUIDE.md` | 同步图文指南 |
| `mobile/index.html` | 手机端**局域网版**（本机 `node server.js` 后同网访问） |
| `index.html`（仓库根） | 主 Web 应用（响应式）：桌面端由 `server.js` 静态托管，亦可部署到 GitHub Pages 作手机端访问页；含可选默认 Supabase 占位 |
| `.env.example` | 环境变量模板（无真实信息） |

> 注：「桌面端入口」与「GitHub Pages 手机访问页」是**同一份**仓库根 `index.html`（响应式单页应用）——由 `server.js` 静态托管供桌面使用，也可发布到 GitHub Pages 供手机访问；`mobile/index.html` 是另一直连桌后端局的域网版，并非桌面入口。

---

## 3. 数据层设计

### 3.1 本地主数据（`data/store.json`）
- 由 `ensureStore()` 提供默认值，`normalizeStore()` 在加载后 / 合并后补齐字段（防缺失字段导致前端报错）。
- 落盘：`saveStore()` 先写 `store.json.tmp` 再 `rename`（原子替换）；写前对旧文件做 `.bak` 副本（防写崩）。
- 书籍双写：`writeBookFile(book)` 把每本写入 `data/books/<id>.json`；`scanBooksDir()` 在启动时扫描该目录，把 `store.json` 中缺失的书籍按 id 去重补齐（防 `store.json` 损坏丢书），并跳过 `deletedBookIds` 中的书。

### 3.2 字段（见 `PRD.md §5.1`），关键点
- `progress[bookId] = {c, s, u}`（章节 / 滚动 / 时间戳），取代旧版单整数进度。
- `lemmaOverrides`：用户纠正的词形还原原型。
- `deletedBookIds`：删除 tombstone，用于云端合并安全传播删除。

### 3.3 备份配置（`data/backup-config.json`）
```json
{ "dir": "<绝对或相对路径>", "auto": true, "retainDays": 7 }
```
由 `getBackupConfig()` / `setBackupConfig()` 读写，内存缓存 `_backupCfgCache`。

### 3.4 脱敏（`sanitizeForBackup`）
深拷贝时按正则 `_SENSITIVE_KEY` 剔除敏感键（匹配 `apiKey/api_key/password/secret/token/service_role/anon_key/private_key/client_secret` 等，大小写不敏感），确保备份不含密钥 / 密码 / token。

### 3.5 本地数据目录总览（`data/`，可用 `LR_DATA_DIR` 覆盖）

| 路径 | 用途 | 实际落盘 |
|---|---|---|
| `data/store.json` | **主数据（唯一真相源）**：books（含 `chapters` 解析正文）/ progress / kb / 批注划线 / reading / checkins / prefs / lemmaOverrides / deletedBookIds | ✅ 持续写入（原子写 `.tmp`+rename，写前留 `.bak`） |
| `data/books/<id>.json` | 每本书解析副本（与 store.json 双写） | ✅ 实际写入 |
| `data/backup-config.json` | 备份设置 `{dir, auto, retainDays}`（v1.2.0） | ✅ 实际写入 |
| `data/annotations/` · `data/vocabulary/` · `data/reading-progress/` · `data/settings/` · `data/analysis-cache/` | **预留目录**：`ensureLocalDirs()` 启动时 `mkdir -p` 创建，便于将来按类型拆分落盘 | ⚠️ 暂未启用（数据仍集中在 `store.json`） |
| `WorkbenchBackup/` | 本地自动备份输出（v1.2.0） | ✅ 实际写入 |

> **AI 分析缓存不在 `data/analysis-cache/`**：真正的本地 AI 分析结果缓存在**浏览器 `localStorage`**（键 `lr_analysis_cache_v1`，由 `js/app.js` 的 `getAnalysisCache/setAnalysisCache/analysisCacheKey` 维护，按 `语言+句子` 命中），离线可用、不写 Supabase、也不进 `data/`。备份/恢复只覆盖服务端 `data/store.json` 与 `data/books/`，**不会**触碰该缓存。

### 3.6 安装与运行依赖（复刻注意）
- **本地优先模式零依赖**：`server.js` 仅用 Node 内置模块；唯一外部包 `@supabase/supabase-js` 仅在配置了 `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE` 时才被 `try/catch` 包裹地 `require`。
- 因此纯本地复刻只需 `node server.js`（或 `npm start`），**无需** `npm install`；`npm install` 仅在需要云端同步的 bundled 依赖时执行。
- 桌面端 `start.bat`（启动并开浏览器）/ `start_silent.bat`（仅启服务、不弹浏览器，适合开机自启）均调用 `node server.js`（端口 3007）。

---

## 4. 后端 API 设计

### 4.1 通用约定
- 基址 `/api/*`；除 `GET` 读取外，写操作返回 `{ok:true,...}` 或 `{error}`。
- 可选令牌：设置 `LR_TOKEN` 环境变量后，所有 `/api/*` 必须带 `?token=` 或 header `x-lr-token`，否则 401（本地不设置则关闭）。
- 请求体经 `readBody(req)` 解析 JSON；错误统一 `try/catch → 500`。

### 4.2 端点清单

| 方法 | 路径 | 目的 | 请求体 | 返回 | 备注 |
|---|---|---|---|---|---|
| GET | `/api/config` | LLM 是否启用 + 模型名 | — | `{llmEnabled, model}` | — |
| GET | `/api/state` | 整体状态（前端初始化拉取） | — | `{books, progress, kb, prefs, reading, checkins, lastBookId, deletedBookIds, lemmaOverrides}` | 同步 / 恢复后刷新用 |
| GET | `/api/store` | 拉取整包（云端 pull） | — | `store` 对象 | — |
| PUT | `/api/store` | 写回整包（云端 push，合并式） | 部分 store | `{ok}` | 以服务端为基合并 + tombstone 移除已删书，绝不整体替换 |
| PUT | `/api/prefs` | 更新偏好 | `{enabledDicts, categories}` | `{ok}` | — |
| POST | `/api/books` | 新增书籍（双写 `data/books/`） | 书籍对象 | `{ok, book}` | 解析在客户端完成 |
| PUT | `/api/books/:id/progress` | 设置进度 | `{chapter, scroll}` → 存为 `{c,s,u}` | `{ok, progress}` | — |
| DELETE | `/api/books/:id` | 删除书籍（更新 `deletedBookIds`） | — | `{ok}` | 唯一正规删书途径 |
| PUT | `/api/lastbook` | 记录上次阅读书 | `{id}` | `{ok}` | — |
| PUT | `/api/reading` | 合并阅读时长 | `{seconds, byDate, byBookDay}` | `{ok}` | 用 `mergeMaxObj` 取较大值 |
| POST | `/api/checkin` | 打卡 | `{date}` | `{ok}` | — |
| GET | `/api/kb` | 列出知识库 | — | `{entries}` | — |
| POST | `/api/kb` | 新增条目 | 条目对象 | `{added, entries}` | 含去重 |
| DELETE | `/api/kb` | 删除条目 | `{id}` | `{ok}` | — |
| POST | `/api/analyze` | AI 单条分析（需 LLM） | `{text, type, language, context}` | 结构化 JSON | 未配 LLM 返回错误（预期） |
| PUT | `/api/lemma-override` | 设置原形覆盖 | `{form, lemma}` | `{ok}` | — |
| POST | `/api/annotate` | 一键全书智能批注（需 LLM） | `{bookId}` | `{added, entries}` | — |
| **GET** | **`/api/backup/config`** | **获取备份设置** | — | **`{dir, auto, retainDays}`** | **v1.2.0** |
| **PUT** | **`/api/backup/config`** | **保存备份设置** | **`{dir?, auto?, retainDays?, resetDir?}`** | **更新后配置** | **v1.2.0；`resetDir:true` 还原默认目录** |
| **POST** | **`/api/backup`** | **立即备份（manual）** | — | **`{ok, folder, manifest}` / `{ok:false, error}`** | **v1.2.0** |
| **GET** | **`/api/backups`** | **列出历史备份** | — | **`{backups:[{name,createdAt,books,kb,label,size}], dir}`** | **v1.2.0** |
| **POST** | **`/api/backup/restore`** | **恢复指定版本** | **`{name}`** | **`{ok, restored}` / `{ok:false, error}`** | **v1.2.0；先建安全网快照** |

### 4.3 异常处理要点
- `PUT /api/store` 空 books 但带 tombstone 时：**仅当 `body.books.length>0` 才按 tomb 删书**；空数组 / 缺字段时保持服务端书籍不变（这是 v1.1.x 根治「书库莫名消失」的核心修复）。
- **`sw.js` 升至 v3（`linguareader-v3`）是同一根因修复的配套项**：旧 v1/v2 Service Worker 曾 `cache-first` 缓存 `/api/*` 与旧版 JS，导致前端防护（getState/getStore/putStore/syncFromState）不生效、表现为「每次界面更新就丢书」。v3 改为 `/api/*` 永远走网络、静态资源 network-first，并在 `activate` 时清除 v1/v2 毒缓存。复刻时务必保留 `sw.js` 的 v3 行为与「激活清旧缓存」逻辑；用户首次升级需 **Ctrl+Shift+R 硬刷新**一次让 v3 接管。
- 备份类接口全部 `try/catch` 包裹，失败返回 `{ok:false, error}`，绝不抛出到主流程。

---

## 5. 前端模块与页面

### 5.1 脚本加载顺序（`index.html` 末尾）
`app → stats → backup → (Supabase CDN) → supabase-config → storage-layers → api → sync → books → analysis → lemma → knowledgebase → upload → strictSelect → reading-ritual → highlights → app.js → stats.js → backup.js`
（注：`app.js` 先于 `stats.js`/`backup.js` 定义 `toast()` 等全局；`backup.js` 在 body 末尾自执行 `setupBackup()`。）

### 5.2 顶栏按钮 → 页面 / 弹窗
| 按钮 | id | 弹窗 / 动作 |
|---|---|---|
| 词典偏好 | `#dict-prefs-btn` | 词典偏好弹窗 |
| 阅读统计 | `#stats-btn` | `#stats-modal`（日历 / 周 / 月） |
| 云同步 | `#cloud-btn` | `#cloud-modal` |
| **备份与恢复** | `#backup-btn` | `#backup-modal`（**v1.2.0 新增**） |
| 导出知识库 | `#export-btn` | `#export-modal` |
| 添加书籍 | `#add-book-btn` | `#upload-modal` |

### 5.3 弹窗清单（`#*-modal`，均 `.hidden` 默认隐藏）
`upload`（导入）、`meta`（元数据校正）、`export`（导出）、`annotation`（批注）、`stats`（统计）、`cloud`（云同步）、**`backup`（备份与恢复，v1.2.0）**。

### 5.4 页面跳转 / 数据流
- 初始化：`init()`（DOMContentLoaded）→ `setupStats()`；`backup.js` 自执行 `setupBackup()`。
- 阅读：选书 → 渲染 `#reading-area` → 选区工具条（`highlights.js`）→ AI（`analysis.js`）/ 批注（`annotation-modal`）。
- 同步：`sync.js` 每 ~4s 上传、每 60s 拉取（仅登录云端时）；Realtime 订阅 `kb_store` 推送。
- 备份：`backup.js` 调 `ApiClient` 备份接口，列表渲染 `#backup-list`，恢复走 `confirm` + 安全网。

---

## 6. 备份模块设计（v1.2.0）

### 6.1 服务端（`server.js` 内聚函数）
- `getBackupConfig() / setBackupConfig(patch)`：读写 `backup-config.json`，缓存；`resetDir` 还原 `DEFAULT_BACKUP_DIR`（`LR_BACKUP_DIR` 或项目根 `WorkbenchBackup/`）。
- `sanitizeForBackup(obj)`：脱敏深拷贝（§3.4）。
- `tsFolderName(d)`：生成 `YYYY-MM-DDThh-mm-ss` 时间戳文件夹名。
- `cleanOldBackups(cfg)`：删除 `mtime` 超过 `retainDays` 天的备份子文件夹（仅删过期，不动最新数据与设置）。
- `createBackup(label)`：建 `WorkbenchBackup/<label>-<时间戳>/`，写脱敏 `store.json` + 复制 `data/books/*.json`（仅 `.json`） + `backup-manifest.json`；随后清理过期。**全程 try/catch，失败仅日志。**
- `listBackups()`：扫描目录、读 manifest、统计大小、按时间倒序。
- `restoreBackup(name)`：对 `name` 过滤 `/\\` 防穿越 → 先 `createBackup("pre-restore")` 安全网 → 读目标 `store.json` → 替换内存 `store` → `normalizeStore()` → `saveStore()`（原子写回）→ 复制目标 `books/*.json` 回 `data/books/`。
- `scheduleBackup()`：`saveStore()` 末尾调用；`_seeding` 阶段或关闭自动则跳过；否则标记脏并启动 120s 防抖定时器（窗口内多次变更合并为一次）。

### 6.2 前端（`js/backup.js`）
- `openBackupModal()`：去隐、加载配置 + 列表。
- `loadBackupConfig()` / `saveBackupConfig()` / `resetBackupDir()`：配置读写（含「默认」按钮）。
- `backupNow()`：调 `ApiClient.backupNow()`，状态反馈 + toast。
- `loadBackupList()`：渲染 `#backup-list`，每条带「恢复」按钮（HTML 转义防注入）。
- `confirmRestore(name)`：浏览器 `confirm` 警告 + 建议先备份 → `doRestore()` → 成功后 `location.reload()`。

### 6.3 设计取舍
- **为何服务端写盘而非前端**：备份需真实文件夹写入权限，且要保证「失败不影响主流程」「不上云」「脱敏」「恢复安全网」，集中服务端最稳。
- **为何防抖 120s**：满足「重要变化后才备份、不每次操作都备份」，同时避免高频 IO。
- **为何复制仅 `.json`**：原始 EPUB/TXT/PDF 是二进制且不随阅读进度变化，重复复制浪费空间；解析后的 `.json` 才是需要保护的可变数据。

---

## 7. AI / LLM 集成

### 7.1 调用链路
`前端 analysis/highlights` → `POST /api/analyze` 或 `/api/annotate` → `server.js` → `llm.js: callLLM(messages)`（读取 `.env` 的 `LLM_API_KEY/LLM_API_BASE/LLM_MODEL`，支持 `OPENAI_API_KEY/API_BASE_URL/MODEL_NAME` 别名）→ OpenAI 兼容接口 → `extractJSON` 解析。

### 7.2 Prompt 架构（`llm.js`）
- **System 角色完全固定** = `COMMON_ROLE`（10 条核心原则：不直译、重可迁移、结构化 JSON、上下文优先、动词给原型、严格按选区、完整性等）。**绝不在 system 前缀拼接动态内容**。
- **User 消息结构**：固定任务模板（按 `(type,language)` 记忆化缓存）→ 语境参考（仅消歧、非分析对象）→ 待分析选区（最末、最易变）→ 重试说明（最末）。这样连续请求前缀稳定，最大化 DeepSeek `prompt_cache_hit_tokens`。
- **任务模板 `ANALYZE_NOTES`**：`word/phrase/expression/sentence/paragraph` 五类说明。
- **Schema `buildAnalyzeSchema(type, language)`**：
  - `word/phrase` → `{category:"vocabulary", tags, data:{word, lemma, pos, verbInfo, defs[], context, grammarRole, collocations[], examples[], learningValue}}`；`defsSchema(language)` 法文给 Le Robert/Larousse/CNRTL 三家法法词典，英文给 Oxford。
  - `expression` → `{category:"expressions", data:{expression, meaning, usage, example, similar[]}}`。
  - `sentence` → `{category:"sentencePatterns", data:{sentence, translation, structure[], grammar, pattern, writingUsage}}`（文学性可改 `beautifulSentences`）。
  - `paragraph` → `{category:"writingMaterials", data:{text, summary, rhetoric, authorStyle}}`。
- **批注 `getAnnotateTask(language)`**：输出 6–10 条 JSON 数组（词汇 / 表达 / 句型混合），同样 system 固定 + user 末尾放原文。

### 7.3 模型与返回
- 模型 / Key 来自 `.env`（`LLM_MODEL` 默认 `gpt-4o-mini`；`LLM_TEMPERATURE=0.3`；`LLM_MAX_TOKENS=1400`）。
- 返回必须是结构化 JSON；`extractJSON` 容错提取；校验 `category/data` 存在，否则抛错由前端 retry。
- 纯静态托管（无服务端代理）时 `/api/analyze` 不可用，属预期。

---

## 8. 云端同步设计（Supabase，可选）

- **表**：`kb_store(user_id uuid PK, payload jsonb, updated_at)`；RLS 策略 `kb_store_owner`；索引 `kb_store_updated_idx`；已开 Realtime。
- **前端同步**（`sync.js`）：登录后每 ~4s 上传合并、每 60s 拉取；Realtime 订阅推送实现秒级多端刷新。合并采用本地优先（`mergeBooksLocalFirst`）+ tombstone 去重。
- **最小化载荷**（`storage-layers.js`）：
  - `minimizeForCloud(store)`：剥离每本书 `chapters`（完整正文），仅同步轻量元数据；`progress/kb/reading/prefs` 等小数据仍同步。
  - `mergeBooksLocalFirst(localBooks, remoteBooks)`：云端合并保留本机完整章节，仅用云端元数据覆盖；云端独有（本机无内容）的书不拉取，避免不可读幽灵书。
  - `kbFingerprint(e)`：知识库去重指纹（分类 + 关键内容 + 书名），防重复入库。
- **服务端镜像**（`pushToSupabase/pullFromSupabase`）：仅当配置了 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE` 时启用，把整包 `store.json` 异步写入 / 合并拉取（防免费主机本地磁盘临时丢数据）。**备份功能不经过此路径。**
- **安全**：前端 anon key 靠 RLS 隔离；可在 Supabase 后台关闭公开注册，仅允许已建账号登录。

---

## 9. 安全与隐私

- **零内置密钥**：所有 Supabase / LLM 配置来自 `.env`（服务端）或用户界面自填（前端 `*-config.js` 为空占位）。源码不含真实密钥。
- **Git 排除**：`.gitignore` 排除 `.env`、`data/`、`WorkbenchBackup/`、`backup-config.json`、`*.key`、含 `secret/token/credential` 的文件等。
- **备份脱敏**：`sanitizeForBackup` 剔除敏感键（§3.4）。
- **备份隔离**：绝不写入 Supabase；目录穿越防护；过期清理只删过期快照。
- **公网防护**：`LR_TOKEN` 为 `/api/*` 加访问令牌（可选）。
- **RLS**：云端数据按 `auth.uid()` 行级隔离。

---

## 10. 部署

### 10.1 本地 / 自托管（推荐，功能最完整）
```bash
npm install        # 仅安装 @supabase/supabase-js（可选）
npm start          # node server.js，默认端口 3007，监听 0.0.0.0
```
浏览器开 `http://localhost:3007/`。`start_silent.bat` 用于开机自启（只启服务不弹浏览器）。

### 10.2 静态托管（Vercel / Netlify / Cloudflare Pages）
前端纯静态，可直接托管。云端同步在界面配置自己的 Supabase；AI 功能需额外部署 Serverless 函数代理 LLM（读取 `OPENAI_API_KEY` 等），前端指向该函数。核心逻辑见 `llm.js: callLLM`。

### 10.3 环境变量（仅服务端，无真实值入仓）
| 变量 | 作用 | 必填 |
|---|---|---|
| `LLM_API_KEY` / `OPENAI_API_KEY` | LLM Key | 启用 AI 必填 |
| `LLM_API_BASE` / `API_BASE_URL` | LLM 接口地址 | 可选 |
| `LLM_MODEL` / `MODEL_NAME` | 模型名 | 可选 |
| `LLM_TEMPERATURE` / `LLM_MAX_TOKENS` | 采样参数 | 可选 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE` | 服务端云端镜像 | 可选 |
| `PORT` | 端口（默认 3007） | 可选 |
| `LR_TOKEN` | `/api/*` 访问令牌（公网防护） | 可选 |
| `LR_BACKUP_DIR` | 覆盖默认备份目录 | 可选 |
| `LR_DATA_DIR` | 覆盖数据目录（开发 / 测试用） | 可选 |

### 10.4 第三方依赖
- `@supabase/supabase-js`（云端同步，可选）。
- LLM：任意 OpenAI 兼容接口，服务端 `fetch` 直连，无 SDK。
- 前端无构建步骤（直接静态文件）。

---

## 11. Update Summary（2026-08-09 · v1.2.0）

- **新增功能**：本地自动备份与恢复（F11）。服务端 `server.js` 新增 `get/setBackupConfig`、`sanitizeForBackup`、`createBackup`、`listBackups`、`restoreBackup`、`scheduleBackup` + 5 个 `/api/backup*` 端点；前端新增 `js/backup.js` 与 `#backup-modal`；`saveStore()` 末尾钩入 `scheduleBackup()`（120s 防抖）。
- **修改功能**：无其它逻辑改动（未触碰解析 / 阅读器 / 进度 / 划线 / 批注 / AI / 知识库 / 同步）。
- **删除功能**：无。
- **Bug 修复**：无（本期为新增功能；既往「书库消失」根因修复保留在 §4.3）。
- **数据库变更**：本地新增 `data/backup-config.json` 与 `WorkbenchBackup/` 目录（Git 排除）；云端 `kb_store` 无变化。
- **API 变更**：新增 `GET/PUT /api/backup/config`、`POST /api/backup`、`GET /api/backups`、`POST /api/backup/restore`。
- **Prompt 变更**：无。
- **一致性**：四份文档（README / PRD / TECHNICAL_DESIGN / BLUEPRINT）首次补全并统一到 v1.2.0；手机端部署源、缺失 `build_dist.js` 等历史备注均保留。
