# LinguaReader · 外语精读与知识库工作台

> **一句话介绍**：一个本地优先（local-first）的外语原版书精读工作台——阅读时划词调用 AI 精读助手，
> 自动沉淀词汇 / 表达 / 句型 / 批注到个人知识库，并统计阅读时长；支持可选云端同步，在手机端随时查看。

**本项目不内置任何人的云端账号或密钥。** 所有 Supabase / LLM 配置都由你自己在 `.env` 或软件界面里填写，
数据按登录用户隔离。你不会连到作者的云端，别人也读不到你的数据。

> **版本**：v1.2.0 · **最后更新**：2026-08-09

### 📝 Update Summary（2026-08-09 · v1.2.0）

- **新增功能**
  - **本地自动备份与恢复（WorkbenchBackup）**：新增服务端备份模块 + 前端「💾 备份与恢复」弹窗。
    - 自动备份：`saveStore` 后防抖（默认 120 秒窗口，连续改动合并为一次），重要数据变更后才会备份，不每次操作都备份。
    - 手动备份：顶栏「💾 备份与恢复」→「立即备份」。
    - 备份内容：`data/store.json`（**脱敏副本**，剔除 `apiKey/password/token/service_role` 等敏感键）+ `data/books/*.json`（**仅解析后的 JSON，不含原始 EPUB/TXT/PDF 二进制**）。
    - 备份位置：默认项目根 `WorkbenchBackup/`，可在弹窗修改；保留最近 N 天（默认 7），过期自动清理。
    - 恢复：查看历史备份、恢复指定版本；恢复前弹窗确认并建议先备份当前数据；确认后系统**先自动备份当前状态（安全网）**再覆盖恢复。
  - 全程失败不影响正常使用，绝不删除 / 覆盖原数据，绝不写入 Supabase。
- **修改功能**：无其它逻辑改动（本期为纯新增，未触碰 EPUB/TXT 解析、阅读器、阅读进度、划线、批注、AI 分析、知识库、Supabase 同步等既有逻辑）。
- **删除功能**：无。
- **Bug 修复**：无（本期为新增功能）。
- **数据库变更**：本地新增 `data/backup-config.json`（备份设置：目录 / 自动开关 / 保留天数）+ 本地 `WorkbenchBackup/` 备份目录（均被 `.gitignore` 排除）。云端 `kb_store` 表无变化。
- **API 变更**：新增 `GET /api/backup/config`、`PUT /api/backup/config`、`POST /api/backup`、`GET /api/backups`、`POST /api/backup/restore`。
- **Prompt 变更**：无。
- **文档一致性**：首次补全 `PRD.md` / `TECHNICAL_DESIGN.md` / `BLUEPRINT.md`（此前缺失），四份文档统一到 v1.2.0。

### 📝 文档补全（2026-08-09 晚 · 仅文档，代码未变）

为让开发者/AI 仅凭文档即可**完整复刻**工作台，本次补齐此前遗漏、并修正一处会误导复刻的描述：

- **修正**：`npm install` 在本地优先模式下**非必需**（唯一依赖 `@supabase/supabase-js` 仅云端同步才 `require`，且 `server.js` 用 `try/catch` 包裹）；纯本地可零依赖 `node server.js` 直接运行。安装段与「本地/自托管」部署段均已更正。
- **新增「📂 本地数据目录」章节**：明确真实落盘位置（`data/store.json` + `data/books/` + `data/backup-config.json` + `WorkbenchBackup/`），并标注 `data/annotations|vocabulary|reading-progress|settings|analysis-cache/` 为**预留 stub 目录**（已 mkdir，数据仍集中在 `store.json`，未拆分落盘），避免误以为这些目录已启用。
- **澄清 AI 分析缓存位置**：真正的本地 AI 分析缓存在**浏览器 `localStorage`（`lr_analysis_cache_v1`）**，不在 `data/analysis-cache/`；备份/恢复不触碰该缓存。
- 同步在 `PRD.md §5.1/§4.6`、`TECHNICAL_DESIGN.md §3/§4.3`、`BLUEPRINT.md §5` 补齐上述内容，并补充 `sw.js` 升至 **v3** 是「书库莫名消失」根因修复的一环（清除以往 v1/v2 对 `/api/*` 的毒缓存）。

### 📝 Update Summary（2026-08-08 · v1.1.0）

- **新增功能**
  - **严格选区规范（StrictSelect）**：所有 AI 入口统一经 `js/strictSelect.js` 获取用户真实选区，禁止截断/扩展到前后句，并对 AI 返回做完整性校验、遗漏自动重请求。
  - **Lemma 原型覆盖（lemmaOverrides）**：用户可纠正 AI / 自动词形还原得到的原型，覆盖值持久化到本地与云端，缓解法语变位还原弱的问题。
  - **书籍独立文件持久化**：`POST /api/books` 额外把每本书写入 `data/books/<id>.json`，与 `data/store.json` 双写。
- **修改功能**
  - AI 分析新增 `context`（语境参考）字段：仅用于词性消歧，AI 不得分析；多选区片段逐段分析后合并（`analyzeText`）。
  - 阅读进度结构升级：`PUT /api/books/:id/progress` 由 `{progress:int}` 改为 `{c:章节, s:滚动位置, u:时间戳}`。
  - `POST /api/annotate` 返回 `{added, entries}`（含新增条目明细）。
- **删除功能**
  - 移除 Aa 阅读显示（`display.js`）与阅读区视觉划线高亮（`highlights.js` / `mark.hl`）；选区工具条与「写批注」保留。
- **Bug 修复**
  - AI 偶尔分析不完整 / 扩展到前后句 → 由 StrictSelect 完整性校验 + `retry` 重请求兜底。
- **数据库变更**：本地 `store.json` 新增 `lemmaOverrides`；云端 `kb_store` 表明确为 `user_id(uuid PK) / payload(jsonb) / updated_at`，并开启 Realtime 实时推送（原文档误写为 `id / user_id / data`）。
- **API 变更**：新增 `PUT /api/lemma-override`；`GET /api/state` 增加 `lemmaOverrides`；`POST /api/books` 双写 `data/books/`；`PUT /api/books/:id/progress` 入参改为 `{chapter, scroll}`；`POST /api/annotate` 返回 `{added, entries}`。
- **Prompt 变更**：`COMMON_ROLE` 强化「语境参考仅供理解、非分析对象」铁律；`defsSchema(language)` 按语言返回；消息构建签名更新并新增 `retry` 重试参数。
- **文档一致性修正**：手机端部署源由「`public/index.html` → `docs/`」更正为「GitHub 仓库根 `index.html`（GitHub Pages 从根目录发布）」；`mobile/index.html` 为局域网版；README「打包」章节的 `build_dist.js` 当前不存在，已标注。
- **⚠️ 待人工确认**：仓库根 `index.html`（主 Web 应用，兼作手机端访问页）当前附带一份默认 Supabase 配置（publishable key，靠 RLS 安全），若要发布纯净开源版建议清空默认值为空（见 §数据安全 注）。

---

## ✨ 功能

- 📚 **原版书阅读**：书库管理、原文阅读、章节切换、阅读进度
- 🤖 **AI 查词**：划词即时分析词义、词性、搭配与例句
- 🧩 **AI 句子解析**：解析长难句结构，讲解语法点
- 📝 **AI 语法讲解**：针对选中句子生成易懂的语法说明
- 📝 **划词批注 / 收藏**：选中文本弹出工具条，可写批注、直接收藏到知识库（注：阅读区视觉划线高亮已移除，仅保留选区工具条与批注）
- 🗒 **笔记管理**：随手记录阅读笔记，支持导出
- 🏷 **标签管理**：为词条 / 笔记打标签，灵活归类
- 🗂 **知识库**：词汇 / 表达 / 句型 / 精彩句 / 写作素材 / 文学笔记 / 批注，统一沉淀与检索
- ☁ **可选云端同步**：多设备、手机端实时查看知识库与阅读时长
- 💾 **本地自动备份与恢复**：自动 / 手动备份书库、进度、划线批注、阅读记录、知识库与设置到本地文件夹；可查看历史、恢复指定版本（不含原始书籍二进制、不含密钥、不上云）

---

## 📦 安装

要求：已安装 **Node.js 18+**（<https://nodejs.org>，安装时勾选 “Add to PATH”）。

```bash
git clone https://github.com/Magnolia-J/LinguaReader.git
cd LinguaReader
# 本地优先模式可直接 node server.js 运行（纯本地零 npm 依赖）。
# npm install 仅用于安装可选的 @supabase/supabase-js（开启云端同步时才需要），
# 以及打包独立桌面应用所需的 electron / electron-builder（仅开发者需要）。
npm install   # 可选：仅云端同步 / 构建桌面应用需要；纯本地使用可跳过此步
```

> **说明**：本项目**完全不依赖 WorkBuddy**。无论用 WorkBuddy 下载还是直接 `git clone`，
> 拿到源码后只要本机有 Node.js，即可独立运行；AI（DeepSeek 等）/ Supabase 不可用时也不影响本地阅读。

---

## ⚙️ 配置

本项目所有敏感配置都来自环境变量，**源码中不包含任何真实密钥**。

### 1. 复制模板

```bash
cp .env.example .env
```

### 2. 编辑 `.env`，填入你自己的值

| 变量 | 说明 | 必填 |
|---|---|---|
| `LLM_API_KEY`（或 `OPENAI_API_KEY`） | 你的 LLM API Key（任意 OpenAI 兼容接口） | 启用 AI 功能必填 |
| `LLM_API_BASE`（或 `API_BASE_URL`） | LLM 接口地址，如 `https://api.openai.com/v1` | 可选（默认 OpenAI） |
| `LLM_MODEL`（或 `MODEL_NAME`） | 模型名，如 `gpt-4o-mini` / `deepseek-chat` | 可选 |
| `SUPABASE_URL` | 你的 Supabase 项目 URL（可选，用于服务端云备份） | 可选 |
| `SUPABASE_SERVICE_ROLE` | Supabase service_role 密钥（**仅服务端**，切勿泄露） | 可选 |
| `PORT` | 本地服务端口，默认 `3007` | 可选 |
| `LR_TOKEN` | 为所有 `/api/*` 请求设置访问令牌（`?token=` 或 header `x-lr-token`）；公网部署时防裸奔，本地不设置则关闭 | 可选 |
| `LR_BACKUP_DIR` | 覆盖默认本地备份目录（默认项目根 `WorkbenchBackup/`） | 可选 |
| `LR_DATA_DIR` | 覆盖本地数据目录（默认项目根 `data/`）；仅开发与测试用 | 可选 |

> **关于前端 Supabase 配置**：浏览器端使用的 Supabase URL / Anon Key 是「公开安全」的（安全由行级安全 RLS 保证）。
> 本项目默认让用户在软件界面里**自行填写**自己的 Supabase（避免连到别人的项目），无需把 key 写进代码。
> 如果你要预置默认值（例如静态托管时），可在 `.env` 填 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。

---

## 🗄 初始化数据库（云端同步必做）

只有在使用云端同步时才需要这一步。

1. 打开 <https://supabase.com> 免费注册，新建一个项目。
2. 项目后台 **SQL Editor** → **New query**，粘贴本项目 `supabase/schema.sql` 全部内容 → **Run**。
   （一次性建表 + 行级安全 RLS + 访问策略 + 索引。）
3. 项目后台 **Settings → API**，复制：
   - **Project URL**（形如 `https://your-project-ref.supabase.co`）
   - **publishable / anon key**（形如 `sb_publishable_...`）
4. 在 LinguaReader 里填入：
   - 桌面端：右上角「☁ 云同步」弹窗 → 配置区 → 粘贴 URL + key → 保存
   - 手机端：⚙ 按钮 / 登录页「配置云端」→ 粘贴 URL + key → 保存

> 数据库只初始化这一次；之后换设备、重装都不用再跑。

---

## 🚀 启动项目

```bash
npm run dev
# 等价于 node server.js
```

浏览器打开 <http://localhost:3007/> 即可使用。

- **AI 精读助手**：在软件界面「🔑 配置你自己的 AI 模型」区填入 LLM Key（也可走上面的 `.env`）。
- **云端同步**：在「☁ 云同步」弹窗里先配置你自己的 Supabase，再登录 / 注册。

---

## 📂 本地数据目录

所有本地数据默认落在项目根 `data/`（可用环境变量 `LR_DATA_DIR` 覆盖）。**复刻时只要保留 `data/` 即可完整还原书库、进度、知识库与备份设置**：

| 路径 | 用途 | 实际落盘 |
|---|---|---|
| `data/store.json` | **主数据（唯一真相源）**：书籍元数据 + 解析正文 `chapters` + 阅读进度 `progress` + 知识库 `kb` + 批注/划线 + 阅读记录 `reading`/`checkins` + 偏好 `prefs` + `lemmaOverrides` + `deletedBookIds` | ✅ 持续写入（原子写 `.tmp`+rename，写前留 `.bak`） |
| `data/books/<id>.json` | 每本书的解析副本（与 `store.json` 双写；启动 `scanBooksDir()` 补齐缺失书，防损坏丢书） | ✅ 实际写入 |
| `data/backup-config.json` | 备份设置 `{dir, auto, retainDays}` | ✅ 实际写入（v1.2.0） |
| `data/annotations/` · `data/vocabulary/` · `data/reading-progress/` · `data/settings/` · `data/analysis-cache/` | **预留目录**：`ensureLocalDirs()` 启动时 `mkdir -p` 创建，便于将来按类型拆分落盘 | ⚠️ 暂未启用（数据仍集中在 `store.json`） |
| `WorkbenchBackup/` | 本地自动备份输出（见「💾 备份与恢复」） | ✅ 实际写入（v1.2.0） |

> **AI 分析缓存不在 `data/analysis-cache/`**：真正的本地 AI 分析结果缓存在**浏览器 `localStorage`**（键 `lr_analysis_cache_v1`，按 `语言+句子` 命中），离线可用、不写 Supabase、也不进 `data/`。
> 备份/恢复只覆盖服务端 `data/store.json` 与 `data/books/`，**不会**触碰浏览器 `localStorage` 缓存（换设备/清浏览器会清空该缓存，但主数据不受影响）。

---

## 📦 打包 / 构建

桌面端开发者可用 **Electron** 把本项目打包成完全独立的 Windows 桌面应用（自带 Chromium + Node，生成 `dist/win-unpacked/LinguaReader.exe`，双击即开，无需 WorkBuddy，也不会触碰 WorkBuddy 路径）：

```bash
npm install                 # 安装 devDependencies：electron + electron-builder
npm run dist                # 生成免安装目录版（dist/win-unpacked/）
# 或 npm run dist:portable  # 生成单文件便携 exe（dist/*.exe）
```

- 配置见仓库根 `electron-builder.yml`（appId、`productName 外语阅读工作台`、图标、打包包含范围）。
- `electron/main.js` 负责：注入可写数据目录（默认用户目录 `LinguaReaderData/`，首次从仓库 `data/` 迁移）、分配空闲端口、单实例锁、拉起 `server.js`、打开本地窗口、退出时清理子进程。
- **打包依赖下载**：Electron 二进制默认从 GitHub 下载；若网络受限，可设镜像后重装：
  `ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" npm install`。

> 纯使用时**无需构建**：直接 `node server.js`（或 `npm start`）即可，端口 3007。

桌面端直接运行：

```bash
npm start          # 等价于 node server.js，端口 3007
```

---

## 🌐 部署

### 本地 / 自托管（推荐，功能最完整，无需 WorkBuddy）
`node server.js`（或 `npm start`）即可，端口 3007。纯本地零依赖即可运行（`npm install` 仅云端同步需要）；
含 AI 代理（读 `.env` 的 LLM Key）与本地持久化，开箱即用。也可用上方 Electron 方案打包成 exe 分发。

### 静态托管（Vercel / Netlify / Cloudflare Pages）
前端是纯静态文件，可直接托管到上述任意平台：
- 将仓库根目录（或 `dist/`）作为站点根目录发布即可。
- **云端同步**：在软件界面配置你自己的 Supabase（见「初始化数据库」）。
- **AI 功能**：由于 LLM Key 必须留在服务端，纯静态托管默认不含 AI 代理。
  若要在云端启用 AI，请额外部署一个 Serverless 函数（读取 `OPENAI_API_KEY` 等环境变量）来代理 LLM 请求，
  并在前端指向该函数地址。本项目核心逻辑见 `llm.js` 的 `callLLM`，可自行封装为函数。

---

## 💾 本地自动备份与恢复

工作台会在本地自动备份你的核心数据（书库、阅读进度、划线批注、阅读记录、知识库、设置），**不依赖云端、不含原始书籍二进制、不含任何密钥**，也绝不会上传到 Supabase。

- **默认位置**：项目根目录 `WorkbenchBackup/`（可在「💾 备份与恢复」弹窗修改）。
- **触发方式**：
  - 自动：重要数据变更后防抖触发（连续改动合并为一次，默认 120 秒窗口），不每次操作都备份。
  - 手动：点击顶栏「💾 备份与恢复」→「立即备份」。
- **保留策略**：默认保留最近 7 天，可在设置调整（≥1 天）；过期自动清理。
- **恢复**：在「💾 备份与恢复」弹窗查看历史备份，点「恢复」会先弹窗确认并建议先备份当前数据；确认后系统会**先自动备份当前状态（安全网）**再覆盖恢复，随后自动刷新页面。
- **安全**：备份全程失败不影响正常使用；备份内容经脱敏（剔除 `apiKey/password/token/service_role` 等敏感键）；原始 EPUB/TXT/PDF 不重复复制。

> 备份配置存于 `data/backup-config.json`，备份目录与 `WorkbenchBackup/` 均被 `.gitignore` 排除，不会进入仓库。

---

## 🧩 脱离 WorkBuddy 独立运行

本项目天生可独立运行，**不依赖 WorkBuddy 的任何运行环境、路径或内部服务**。无论是从 GitHub 直接 clone，还是分发打包好的 exe，都可以在一台**只装了普通 Node.js（纯本地模式）/或完全不装运行时（exe 版）**的电脑上长期使用。

### 方式 A：源码运行（普通电脑，需 Node.js 18+）

```bash
git clone https://github.com/Magnolia-J/LinguaReader.git
cd LinguaReader
# 纯本地使用可跳过 npm install；需云端同步才装 @supabase/supabase-js
npm install        # 可选
node server.js     # 启动本地服务（端口 3007）
```

然后浏览器打开 <http://localhost:3007/>。「AI 精读助手」和「云端同步」为**可选**：
- AI 不可用 → 仅无法划词分析，阅读/书库/划线/批注/进度一切正常。
- Supabase 不可用 → 仅无法多设备同步，本地阅读/书库/备份完全不受影响。

### 方式 B：独立桌面应用（exe，无需装任何东西）

由开发者（或你自己）用 Electron 构建完成后，把 `dist/win-unpacked/` 整个文件夹复制给使用者：
- 双击 `LinguaReader.exe` 即自动启动内部本地服务并打开窗口；
- 数据保存在当前用户目录（如 `%APPDATA%/LinguaReaderData/` 或 exe 同级 `data/`），与 WorkBuddy 无关；
- 想开机自启：把 `LinguaReader.exe` 的快捷方式放进「启动」文件夹（`Win+R` → `shell:startup`）。

> **关于启动脚本 `start.bat` / `start_silent.bat`**：它们只从系统 `PATH` 找 Node.js，
> **不含任何 WorkBuddy 路径回退**；若本机没装 Node.js，会提示去 nodejs.org 安装。

---

## 🔄 GitHub 更新方法

```bash
git add -A                       # 暂存改动（确认没有 .env / 个人数据被加入）
git commit -m "Update reading workbench and standalone setup"
git pull origin main --rebase   # 先同步远端（若有冲突按提示解决，不强制覆盖）
git push origin main            # 推送到原仓库 main 分支
```

- 提交前务必确认 `.env`、个人 `data/store.json`、书籍 PDF/EPUB、`WorkbenchBackup/` 等**均未被加入**（已被 `.gitignore` 排除）。
- 不要使用 `git push --force`，以免覆盖 GitHub 上已有的历史。

---

## 🔒 数据与隐私

- 本地数据存于 `data/store.json`，已被 `.gitignore` 排除，**不会进入仓库**。
- 云端数据存于你**自己的** Supabase 项目，按 `auth.uid()` 行级隔离：你只能看自己的，别人只能看别人的。
- LLM API Key 是**私密密钥**：它只在你本机随请求发给本地后端（localhost），再由后端转发给 LLM 服务商，
  不会出现在前端代码里，也不会进入仓库。别人 Clone 后用的是他们自己的密钥。
- 📌 **仓库根 `index.html`（主 Web 应用，既作桌面端入口、也可部署为手机端访问页）当前附带一份默认 Supabase 配置**（publishable / anon key，靠 RLS 行级安全隔离，不涉密），
  用户可在 ⚙ 配置界面覆盖为**自己的**项目。若要发布完全不含任何默认值的纯净开源版，**需人工补充**：把该页面的默认 URL / key 置空（仅保留「请到 ⚙ 填写」提示）。桌面端 `js/supabase-config.js` / `js/llm-config.js` 已是空占位，不内置任何密钥。

---

## 📁 目录结构

| 路径 | 说明 |
|---|---|
| `server.js` / `index.html` / `js/` / `styles.css` / `sw.js` | 桌面端（Node 服务 + 静态前端） |
| `index.html`（**仓库根目录**） | 主 Web 应用（响应式）：桌面端由 `server.js` 静态托管（`http://localhost:3007/`），亦可部署到 GitHub Pages 作为手机端访问页 |
| `mobile/index.html` | 手机端**局域网版**（本机 `node server.js` 后手机同网访问桌面后端） |
| `js/strictSelect.js` | 统一严格选区规范（StrictSelect） |
| `js/backup.js` | 本地自动备份与恢复 UI 模块（弹窗 / 配置 / 列表 / 恢复） |
| `llm.js` | LLM 调用与 `.env` 读取（支持别名） |
| `WorkbenchBackup/` | 本地自动备份输出目录（Git 排除；内含若干 `时间戳` 子文件夹，每文件夹含 `store.json` + `books/` + `backup-manifest.json`） |
| `data/backup-config.json` | 备份设置（目录 / 自动开关 / 保留天数，Git 排除） |
| `data/books/` | 每本书独立 JSON 文件（与 `data/store.json` 双写） |
| `supabase/schema.sql` | 云端建表脚本 |
| `supabase/SYNC_GUIDE.md` | 云端同步图文指南 |
| `.env.example` | 环境变量模板（无真实信息） |

---

## 📄 License

[MIT](./LICENSE) —— 可自由使用、修改、再分发。
