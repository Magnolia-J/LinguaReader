# LinguaReader · 系统蓝图（BLUEPRINT）

> **版本**：v1.5.0 · **最后更新**：2026-09-06
> **文档定位**：高层「系统蓝图」——架构全景、页面与数据流图、功能—模块—API 映射、技术栈与部署形态。详细需求见 `PRD.md`，实现细节见 `TECHNICAL_DESIGN.md`。

---

## 1. 蓝图概述

LinguaReader 是一个**本地优先**的外语原版书精读工作台：以本地文件为唯一真相源，AI 在「阅读—选区—分析—沉淀」的闭环中把词汇 / 表达 / 句型 / 批注沉淀为个人知识库，并用阅读统计形成正反馈；云端同步与本地备份作为**可选 / 增强**能力叠加，且都做到「失败隔离、隐私优先」。

```
阅读原书 ──▶ 划词/划句 ──▶ AI 精读助手 ──▶ 沉淀知识库 ──▶ 导出/同步/备份
   │              │              │                              │
   └── 阅读进度/时长 ──▶ 阅读统计/打卡 ◀──── 个人积累闭环 ──────┘
```

---

## 2. 架构蓝图

### 2.1 分层架构

```
┌──────────────────────── 表现层（浏览器） ────────────────────────┐
│  桌面端 index.html（顶栏 + 阅读区 + 知识库面板 + 7 个弹窗）        │
│  主 Web 应用 index.html（server.js 桌面托管 / GitHub Pages 手机访问）/ mobile/index.html（局域网） │
└───────────────────────────────┬──────────────────────────────────┘
                                 │  fetch /api/*
┌──────────────────────── 服务层（Node http, server.js） ──────────┐
│  路由 / 静态托管 / 本地持久化 / LLM 代理 / Supabase 镜像 / 备份    │
└───────┬───────────────────────┬───────────────────┬──────────────┘
        │                       │                   │
┌───────▼──────┐        ┌───────▼────────┐   ┌──────▼──────────────┐
│ 本地文件系统  │        │  LLM 服务商     │   │  Supabase（可选）    │
│ store.json   │        │ (OpenAI 兼容)   │   │  kb_store (RLS)     │
│ books/*.json │        └────────────────┘   └─────────────────────┘
│ WorkbenchBackup/                                                      │
└──────────────┘
```

### 2.2 页面 / 弹窗结构

```
顶栏
├─ ⚙ 词典偏好 ───────▶ 词典偏好弹窗
├─ 📊 阅读统计 ──────▶ stats-modal（日历 / 周 / 月）
├─ ☁ 云同步 ────────▶ cloud-modal（登录 / 注册 / 同步）
├─ 💾 备份与恢复 ───▶ backup-modal（设置 / 立即备份 / 历史 / 恢复）★v1.2.0
├─ ⬇ 导出知识库 ────▶ export-modal（选书 / 类型 / 词典 / 格式 / 预览）
└─ ＋ 添加书籍 ─────▶ upload-modal ──▶ meta-modal（元数据校正）

主区
├─ 书库列表（books.js）
└─ 阅读区 reading-area
    └─ 选区工具条（highlights.js）
        ├─ 查词 / 句子 / 语法（analysis.js → /api/analyze）
        ├─ 高亮（可切换 Toggle + 撤销/重做，→ PUT /api/books/:id marks）
        └─ 写批注（annotation-modal → 知识库 / kb）

全局浮层
└─ 阅读仪式（reading-ritual.js）
    ├─ 启动欢迎（真实书摘 + 日期 + 问候，#reading-ritual-root）
    └─ 读完纪念（第 X 本 + 随机寄语 + 累计时长，localStorage lr_completions_v1）

临时浮层（v1.4.0）
└─ 返回阅读位置：知识库/批注「定位到原文」后，阅读区顶部「↩ 返回阅读位置」按钮（#return-reading-btn），精确回到跳转前位置，不污染正常阅读进度（localStorage lr_temp_return，与 progress 分离）

右栏
└─ 知识库面板（knowledgebase.js：检索 / 筛选 / 清空）
```

### 2.3 数据流（备份为例，v1.2.0）

```
[数据变更] saveStore()
    │
    ├─▶ pushToSupabase()            （可选，云端镜像，隔离）
    └─▶ scheduleBackup() ──(120s 防抖)──▶ createBackup(label)
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                    sanitizeForBackup(store)          cleanOldBackups()
                              │                               │
                              ▼                               ▼
              WorkbenchBackup/<label>-<ts>/store.json  删除 >retainDays 天的快照
              + books/*.json（仅 .json） + backup-manifest.json

[恢复] restoreBackup(name)
    ├─▶ createBackup("pre-restore")   ← 安全网
    ├─▶ 读目标 store.json → 替换内存 store → normalizeStore → saveStore()
    └─▶ 复制目标 books/*.json → data/books/
```

---

## 3. 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 后端 | Node.js ≥ 18 原生 `http` | 无框架，单文件 `server.js` |
| 前端 | 原生 HTML / CSS / ES Module 风格（IIFE） | 无构建步骤，纯静态 |
| AI | 任意 OpenAI 兼容 LLM | 服务端 `fetch` 代理（`llm.js`） |
| 云端（可选） | Supabase Postgres + RLS + Realtime | `kb_store` 整包 jsonb |
| 备份 | Node `fs` | 本地文件夹 + 原子写 + 脱敏 |
| PWA | `sw.js` + `manifest.json` | 可「添加到主屏幕」 |

---

## 4. 功能 → 模块 → API 映射

| 功能 | 前端模块 | 关键 API | 页面 |
|---|---|---|---|
| 书库导入 | `upload.js` | `POST /api/books` | upload / meta |
| 阅读 / 进度 | `books.js` / `app.js` | `PUT /api/books/:id/progress`、`PUT /api/reading`、`PUT /api/lastbook`、`GET /api/state` | reading-area |
| AI 查词/句/语法 | `analysis.js` + `strictSelect.js` | `POST /api/analyze`、`PUT /api/lemma-override` | 选区工具条 |
| 批注 / 收藏 | `highlights.js` | `POST /api/annotate` | annotation |
| 可切换高亮（Toggle）/ 撤销重做 | `highlights.js` | `PUT /api/books/:id`（marks 整体替换） | 阅读区选区工具条 |
| 阅读欢迎 & 读完纪念 | `reading-ritual.js` | （浏览器 `localStorage` `lr_completions_v1`，无服务端 API） | 全局浮层 |
| 知识库 | `knowledgebase.js` | `GET/POST/DELETE /api/kb` | 右栏面板 |
| 阅读统计 | `stats.js` | `POST /api/checkin`、`GET /api/state` | stats-modal |
| 导出 | `app.js` | （本地生成，读 `/api/state`） | export-modal |
| 云端同步 | `sync.js` + `storage-layers.js` | `GET/PUT /api/store` | cloud-modal |
| **本地备份/恢复** | **`backup.js`** | **`GET/PUT /api/backup/config`、`POST /api/backup`、`GET /api/backups`、`POST /api/backup/restore`** | **backup-modal** |
| **返回原阅读位置** | **`app.js` + `api.js`** | **（浏览器 `localStorage` `lr_temp_return`，无服务端 API）** | **阅读区 `#return-reading-btn` 浮层** |

---

## 5. 数据蓝图

### 5.1 本地主数据 `data/store.json`
`books[] · progress{} · kb[] · prefs{} · reading{} · checkins{} · lastBookId · deletedBookIds[] · deletedKbIds[]（v1.4.0 笔记墓碑） · lemmaOverrides{}`
（详见 `PRD.md §5.1` / `TECHNICAL_DESIGN.md §3`）

### 5.2 云端 `kb_store`
`user_id(uuid PK) · payload(jsonb) · updated_at`（RLS + 索引 + Realtime）

### 5.3 备份目录 `WorkbenchBackup/<label>-<时间戳>/`
```
<label>-<时间戳>/
├─ store.json            # 脱敏后的主数据副本
├─ books/                # data/books/*.json 的副本（仅 .json）
└─ backup-manifest.json  # {createdAt, label, books, kb, storeBytes, note, appVersion}
```
配置：`data/backup-config.json` → `{dir, auto, retainDays}`。

### 5.4 本地数据目录总览（`data/`，可用 `LR_DATA_DIR` 覆盖）

| 路径 | 用途 | 实际落盘 |
|---|---|---|
| `data/store.json` | **主数据（唯一真相源）**：books（含 `chapters` / `marks` 高亮批注）/ progress / kb / 批注划线 / reading / checkins / prefs / lemmaOverrides / deletedBookIds | ✅ 持续写入（原子写 `.tmp`+rename，留 `.bak`） |
| `data/books/<id>.json` | 每本书解析副本（与 store.json 双写） | ✅ 实际写入 |
| `data/backup-config.json` | 备份设置 `{dir, auto, retainDays}` | ✅ 实际写入 |
| `data/annotations/` · `data/vocabulary/` · `data/reading-progress/` · `data/settings/` · `data/analysis-cache/` | **预留目录**：`ensureLocalDirs()` 启动时 `mkdir -p` 创建 | ⚠️ 暂未启用（数据仍集中在 `store.json`） |
| `WorkbenchBackup/` | 本地自动备份输出 | ✅ 实际写入 |

> **AI 分析缓存不在 `data/analysis-cache/`**：真正的本地 AI 分析缓存在**浏览器 `localStorage`**（键 `lr_analysis_cache_v1`，按 `语言+句子` 命中），离线可用、不写 `data/`、不进 Supabase；备份/恢复只覆盖服务端 `data/store.json` 与 `data/books/`，不触碰该缓存。

> **v1.3.0 新增浏览器 `localStorage` 键 `lr_completions_v1`**：阅读完成记录（`[{bookId, completedAt, completedOrder, totalReadingTime}]`），由阅读仪式组件写入；属于浏览器本地存储，**非** `store.json`、**非**云端，换浏览器/清缓存会清空但主数据不受影响；备份/恢复不触碰。高亮 `marks` 则持久化在 `store.json` 的 `book` 对象内（随书籍双写），非 localStorage。

---

## 6. 部署蓝图

| 形态 | 入口 | 能力 | 说明 |
|---|---|---|---|
| 本地 / 自托管 | `npm start`（端口 3007） | 全功能（AI + 本地备份 + 可选同步） | 推荐，数据自控 |
| 桌面 PWA | 同上 + `sw.js` | 可安装到桌面 | — |
| 手机端访问页（GitHub Pages） | 仓库根 `index.html`（同一响应式应用；桌面端经 `server.js` 托管） | 查阅 + 同步（需自填 Supabase） | 无本地备份（属桌面端后端能力） |
| 手机端局域网 | `mobile/index.html` | 同网访问桌面后端 | 本机 `node server.js` 后手机同网 |
| 纯静态托管 | Vercel/Netlify/CF | 查阅 + 同步；AI 需额外 Serverless | 无服务端代理则 AI 不可用 |

> 备份是**桌面端后端能力**（写本地文件夹），手机端访问页（GitHub Pages）不涉及。

### 6.1 启动 / 自启与休眠恢复（v1.4.0）
- **开机自启（弹黑框）**：启动文件夹 `LinguaReader_AutoStart.bat` 直接前台运行 WorkBuddy 自带 Node，稳定可用。
- **休眠恢复自动拉起**：任务计划 `LinguaReader_Service_Restart`（工作站解锁时运行 `restart_lr.bat`）。
- **一键手动恢复**：`restart_lr.bat` 结束 3007 占用并重启服务。
- `run_server_hidden.vbs` 无窗口启动器因 bug 暂弃用，回退弹黑框方案。

---

## 7. 演进路线（Roadmap）

| 方向 | 状态 | 说明 |
|---|---|---|
| 阅读区视觉划线高亮 | **已实现（v1.3.0 重新实现）** | v1.1.0 曾移除；v1.3.0 重新实现为「可切换高亮 Toggle + 撤销/重做」（`highlights.js`），基于章节+段落+字符偏移定位 |
| 阅读欢迎 & 读完纪念（阅读仪式） | **已实现** | **v1.3.0（本期）** |
| 严格选区 / Lemma 覆盖 | 已实现 | v1.1.0 |
| 本地自动备份与恢复 | **已实现** | **v1.2.0** |
| 书籍独立文件持久化 | 已实现 | v1.1.0 双写 `data/books/` |
| 存储分层（云端最小化） | 已实现 | `storage-layers.js` |
| 书库消失根因修复 | 已实现 | `server.js` PUT tombstone 守卫 + `sw.js` 升 v3（清除以往对 `/api/*` 的毒缓存；首次升级需 Ctrl+Shift+R 硬刷新） |
| 笔记删除墓碑（deletedKbIds） | 已实现 | v1.4.0（解决笔记删除后在云端/手机端复活） |
| 返回原阅读位置 | 已实现 | v1.4.0 |
| 任务计划自启（休眠恢复） | 已实现 | v1.4.0（`restart_lr.bat` + 工作站解锁触发器） |
| 多语言扩展（西 / 德 / 日等） | 需人工补充 | 当前支持 en / fr；新增语言需扩展 `defsSchema` 与词典源 |
| `build_dist.js` 打包 | 需人工补充 | `package.json` 的 `build` 指向缺失文件，桌面端无需构建 |
| 纯净开源版（清空手机端默认 Supabase） | 需人工补充 | v1.1.0 已标注，本期未改 |
| `package.json` 版本号同步 | **需人工补充** | 当前 `package.json.version` 仍为 `1.2.0`，与文档 v1.5.0 不一致，建议升至 `1.5.0` |

---

### 📝 Update Summary（2026-09-06 · v1.5.0）

- **新增功能**：无（本次为 Bug 修复与续读行为修正）。
- **修改功能**：续读滚动恢复时序（`init` 中 `applyReaderPrefs` 提前到打开书之前；`renderReadingArea` 滚动恢复改双 `requestAnimationFrame`）；「上次读到这里」标记显示时序（双 rAF 内先恢复滚动再显示标记；`onReadingScroll` 淡出加 `!_restoring` 守卫）。
- **删除功能**：无。
- **Bug 修复**：续读滚动位置错位（调过字号/行距的书重开后正文滚回顶部/靠前，根因 `applyReaderPrefs` 在续读后才应用使内容顶高）；续读后「上次读到这里」标记消失（根因双 rAF 使标记先显示、大滚动恢复触发淡出）。
- **数据库变更**：无。
- **API 变更**：无。
- **Prompt 变更**：无。
- **蓝图一致性**：架构图（§2.2 标记浮层行为）/ 功能—模块—API 映射（§4）/ 数据蓝图（§5.1）/ 部署（§6.1 自启）/ Roadmap（§7）统一到 v1.5.0；标注 `package.json` 版本不一致（需人工补充升至 1.5.0）。

### 📝 Update Summary（2026-08-17 · v1.4.0）

- **新增功能**：返回原阅读位置（阅读区顶部「↩ 返回阅读位置」按钮，与 `progress` 分离，纯 `localStorage` `lr_temp_return`）；笔记删除墓碑 `deletedKbIds`（与 `deletedBookIds` 同机制，解决云端复活）；`restart_lr.bat` 一键重启 + 任务计划 `LinguaReader_Service_Restart`（工作站解锁时自启，解决休眠恢复服务未连接）。
- **修改功能**：`PUT /api/store` 扩展为「书籍 + 笔记双 tombstone 合并」；启动/自启方案调整（`run_server_hidden.vbs` 暂弃用，回退弹黑框）。
- **删除功能**：无。
- **Bug 修复**：笔记删除云端复活（deletedKbIds + kbTomb 守卫）；休眠恢复服务未连接（restart_lr.bat + 任务计划，待实测）。
- **数据库变更**：`store.json` 顶层新增 `deletedKbIds`；浏览器 `localStorage` 新增 `lr_temp_return`；云端 `kb_store` 无结构变化。
- **API 变更**：无新增端点；返回阅读位置无 API；`PUT /api/store` 双 tombstone。
- **Prompt 变更**：无。
- **蓝图一致性**：架构图（§2.2 加返回阅读位置浮层）/ 功能—模块—API 映射（§4 增一行）/ 数据蓝图（§5.1 加 deletedKbIds）/ 部署（§6.1 自启）/ Roadmap（§7 加三项实现 + 标注 package.json 版本不一致）统一到 v1.4.0。

### 📝 Update Summary（2026-08-10 · v1.3.0）

- **新增功能**：阅读仪式（`reading-ritual.js`，启动欢迎 + 读完纪念，完成记录写 `localStorage.lr_completions_v1`）；阅读区可切换高亮（`highlights.js` Toggle + 撤销/重做，marks 经 `PUT /api/books/:id` 持久化）。
- **修改功能**：`store.json` 的 `book` 新增 `marks`；进度新增 `pid/fp/page`；`start.bat`/`start_silent.bat` 恢复为「系统无 Node 时自动回退 WorkBuddy 自带 Node」（依赖 WorkBuddy 运行环境，无需系统单独安装 Node.js）。
- **删除功能**：无（PDF 解析此前已彻底移除）。
- **Bug 修复**：EPUB 上传 "Failed to fetch"（zlib 头剥离重试）；桌面端重启打不开（系统无 Node.js → 脚本回退到 WorkBuddy 自带 Node）。
- **数据库变更**：`book` 新增 `marks`；浏览器 `localStorage` 新增 `lr_completions_v1`；云端 `kb_store` 无变化。
- **API 变更**：端点清单补充 `PUT /api/books/:id`；无新增端点。
- **Prompt 变更**：无。
- **蓝图一致性**：架构图 / 页面结构图（§2.2 增加阅读仪式浮层与高亮 Toggle）/ 功能—模块—API 映射（§4 增两行）/ 数据目录总览（§5.4 增 marks 与 `lr_completions_v1` 说明）/ Roadmap（§7 修正高亮状态）统一到 v1.3.0。

## 8. Update Summary（2026-08-09 · v1.2.0）

- **新增功能**：本地自动备份与恢复（蓝图 §2.2 / §2.3 / §4 / §5.3）。桌面端新增「💾 备份与恢复」入口与弹窗；服务端备份模块 + 5 个 API；默认 `WorkbenchBackup/`，可改位置与保留天数，历史查看与版本恢复（含安全网快照）；脱敏、不含原始二进制、不上云、失败隔离。
- **修改功能**：无其它逻辑改动（保持既有解析 / 阅读 / AI / 同步不变）。
- **删除功能**：无。
- **Bug 修复**：无（本期为新增功能）。
- **数据库变更**：本地新增 `data/backup-config.json` 与 `WorkbenchBackup/`；云端 `kb_store` 无变化。
- **API 变更**：`GET/PUT /api/backup/config`、`POST /api/backup`、`GET /api/backups`、`POST /api/backup/restore`。
- **Prompt 变更**：无。
- **蓝图一致性**：四份文档统一到 v1.2.0；架构图、页面图、数据流图、功能—模块—API 映射、部署形态均覆盖备份能力；历史遗留项（多语言、build_dist、纯净开源版）在 §7 标注「需人工补充」。

### 📝 文档补全（2026-08-09 晚 · 仅文档，代码未变）

为达到「开发者/AI 仅凭文档即可完整复刻」的目标，补齐此前遗漏并修正误导：

- **新增 §5.4 本地数据目录总览**：明确真实落盘（`store.json` + `books/` + `backup-config.json` + `WorkbenchBackup/`），并标注 `annotations|vocabulary|reading-progress|settings|analysis-cache/` 为**预留 stub 目录**（已 mkdir，数据仍集中在 `store.json`）。
- **澄清 AI 分析缓存**：真正的本地 AI 分析缓存在**浏览器 `localStorage`（`lr_analysis_cache_v1`，按 语言+句子 命中）**，不在 `data/analysis-cache/`；备份/恢复不触碰。
- **修正复刻依赖**：本地优先模式零 npm 依赖，`npm install` 仅云端同步需要（纯本地 `node server.js` 即可）。
- **新增 §7 书库消失根因修复**：补 `sw.js` 升 v3 清除 `/api/*` 毒缓存是修复一环（首次升级需 Ctrl+Shift+R）。
