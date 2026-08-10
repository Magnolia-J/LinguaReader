# LinguaReader · 系统蓝图（BLUEPRINT）

> **版本**：v1.2.0 · **最后更新**：2026-08-09
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
        └─ 写批注（annotation-modal → 知识库 / kb）

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
| 知识库 | `knowledgebase.js` | `GET/POST/DELETE /api/kb` | 右栏面板 |
| 阅读统计 | `stats.js` | `POST /api/checkin`、`GET /api/state` | stats-modal |
| 导出 | `app.js` | （本地生成，读 `/api/state`） | export-modal |
| 云端同步 | `sync.js` + `storage-layers.js` | `GET/PUT /api/store` | cloud-modal |
| **本地备份/恢复** | **`backup.js`** | **`GET/PUT /api/backup/config`、`POST /api/backup`、`GET /api/backups`、`POST /api/backup/restore`** | **backup-modal** |

---

## 5. 数据蓝图

### 5.1 本地主数据 `data/store.json`
`books[] · progress{} · kb[] · prefs{} · reading{} · checkins{} · lastBookId · deletedBookIds[] · lemmaOverrides{}`
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
| `data/store.json` | **主数据（唯一真相源）**：books（含 `chapters`）/ progress / kb / 批注划线 / reading / checkins / prefs / lemmaOverrides / deletedBookIds | ✅ 持续写入（原子写 `.tmp`+rename，留 `.bak`） |
| `data/books/<id>.json` | 每本书解析副本（与 store.json 双写） | ✅ 实际写入 |
| `data/backup-config.json` | 备份设置 `{dir, auto, retainDays}` | ✅ 实际写入 |
| `data/annotations/` · `data/vocabulary/` · `data/reading-progress/` · `data/settings/` · `data/analysis-cache/` | **预留目录**：`ensureLocalDirs()` 启动时 `mkdir -p` 创建 | ⚠️ 暂未启用（数据仍集中在 `store.json`） |
| `WorkbenchBackup/` | 本地自动备份输出 | ✅ 实际写入 |

> **AI 分析缓存不在 `data/analysis-cache/`**：真正的本地 AI 分析缓存在**浏览器 `localStorage`**（键 `lr_analysis_cache_v1`，按 `语言+句子` 命中），离线可用、不写 `data/`、不进 Supabase；备份/恢复只覆盖服务端 `data/store.json` 与 `data/books/`，不触碰该缓存。

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

---

## 7. 演进路线（Roadmap）

| 方向 | 状态 | 说明 |
|---|---|---|
| 阅读区视觉划线高亮 | 已移除 | v1.1.0 移除 `display.js` / `mark.hl`，仅保留选区工具条与批注 |
| 严格选区 / Lemma 覆盖 | 已实现 | v1.1.0 |
| 本地自动备份与恢复 | **已实现** | **v1.2.0（本期）** |
| 书籍独立文件持久化 | 已实现 | v1.1.0 双写 `data/books/` |
| 存储分层（云端最小化） | 已实现 | `storage-layers.js` |
| 书库消失根因修复 | 已实现 | `server.js` PUT tombstone 守卫 + `sw.js` 升 v3（清除以往对 `/api/*` 的毒缓存；首次升级需 Ctrl+Shift+R 硬刷新） |
| 多语言扩展（西 / 德 / 日等） | 需人工补充 | 当前支持 en / fr；新增语言需扩展 `defsSchema` 与词典源 |
| `build_dist.js` 打包 | 需人工补充 | `package.json` 的 `build` 指向缺失文件，桌面端无需构建 |
| 纯净开源版（清空手机端默认 Supabase） | 需人工补充 | v1.1.0 已标注，本期未改 |

---

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
