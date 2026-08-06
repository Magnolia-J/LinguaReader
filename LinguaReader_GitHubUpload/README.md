# LinguaReader · 外语精读与知识库工作台

一个**本地优先（local-first）**的外语原版书精读工作台：阅读时划词调用 AI 精读助手，
自动沉淀词汇 / 表达 / 句型 / 批注到个人知识库，并统计阅读时长。内置**可选**的云端同步，
方便手机端随时查看知识库与阅读时长。

> ⚠️ 本项目**不内置任何人的云端账号**。云端同步需要你**自己的** Supabase 项目（免费注册），
> 所有数据按登录用户隔离，互不干扰——你不会连到作者的云端，别人也读不到你的数据。

---

## ✨ 功能一览

- 📚 书库管理（支持一键去重）、原文阅读、章节切换
- 🤖 AI 精读助手（划词分析、一键智能批注），依赖 LLM API Key（仅本地配置）
- 🗂 个人语言知识库（词汇 / 表达 / 句型 / 精彩句 / 写作素材 / 文学笔记 / 批注）
- ⏱ 阅读时长统计（日历 / 周报 / 月报 / 打卡）
- ☁ 可选云端同步（Supabase）：多设备、手机端实时查看
- 📱 手机端页面（知识库 + 阅读时长，桌面端改动数秒自动刷新）

---

## 🚀 桌面端（本地运行）

要求：安装 Node.js（本地模式下无需 `npm install`）。

```bash
cd LinguaReader
start.bat            # 双击即可启动；或命令行 node server.js
# 浏览器打开 http://localhost:3007/
```

- **AI 精读助手**：打开右上角「☁ 云同步」弹窗，在 **🔑 配置你自己的 AI 模型** 区填入你的 LLM API Key（支持 DeepSeek / OpenAI / 通义 / 智谱 等任意 OpenAI 兼容接口），保存即用。配置只存在你本机浏览器，**不进仓库、不消耗别人的额度**。
  （也可在 `.env` 填入 `LLM_API_KEY` 作为兜底，二选一即可；界面配置的优先级更高。）
- **云端同步**：点右上角「☁ 云同步」→ 先在弹窗 **① 配置你自己的 Supabase**（见下）→ 再登录 / 注册。

---

## 📱 手机端

已部署示例（作者自用）：<https://magnolia-j.github.io/LinguaReader/>
> 该示例链接的云端由作者配置。你也可以 Fork / 下载本项目，部署**属于你自己的**版本。

自行部署（GitHub Pages 或任意静态托管）：把 `public/` 目录发布即可。
首次打开手机端，点右上角 **⚙** 或登录页「配置云端 Supabase」，填入你自己的 Supabase。

---

## 🔧 配置你自己的 Supabase（使用云端功能的必要条件）

1. 打开 <https://supabase.com> 免费注册，新建一个项目。
2. 项目后台 **SQL Editor** → 新建查询 → 粘贴本项目 `supabase/schema.sql` 全部内容 → **Run**
   （一次性建表 + 行级安全 RLS + 开启实时推送）。
3. 项目后台 **Settings → API**，复制：
   - **Project URL**（形如 `https://xxxx.supabase.co`）
   - **publishable / anon key**（形如 `sb_publishable_...`）
4. 在 LinguaReader 里填入：
   - 桌面端：☁ 云同步弹窗 → 「① 配置」区 → 粘贴 URL + key → 保存
   - 手机端：⚙ 按钮 / 登录页「配置云端」→ 粘贴 URL + key → 保存

> 配置只保存在**你本机浏览器**的 localStorage，不会上传，也不会连到别人的项目。

---

## 🔑 配置你自己的 AI 模型（LLM）

AI 精读助手依赖一个 LLM API Key。**本项目不内置任何人的密钥**，你需要填**自己的**。

1. 到任意 OpenAI 兼容服务商获取 API Key（如 DeepSeek：<https://platform.deepseek.com>）。
2. 在 LinguaReader 里填入：
   - 桌面端：右上角「☁ 云同步」弹窗 → 「🔑 配置你自己的 AI 模型」区
     - **API Key**：粘贴你的 `sk-...`
     - **接口地址**：如 `https://api.deepseek.com/v1`（可选，留空用 OpenAI 默认）
     - **模型名**：如 `deepseek-chat`（可选，留空用默认）
   - 保存后，划词分析与一键智能批注即启用；右上角状态会从「🟡 演示模式」变为「🟢 AI 在线」。
3. （可选）若不想在界面填，也可在 `.env` 填 `LLM_API_KEY` 等作为兜底，效果相同。

> 与 Supabase 不同，LLM API Key 是**私密密钥**，不会出现在前端代码里：它只在你本机随请求发给
> 本地后端（localhost），再由后端转发给 LLM 服务商。别人下载本项目后只能用他们自己的密钥，
> 不会看到你的密钥，也消耗不了你的额度。

---

## 🔒 数据与隐私

- 本地数据存于 `data/store.json`（桌面端），已被 `.gitignore` 排除，**不会进入仓库**。
- 云端数据存于你**自己的** Supabase 项目，按 `auth.uid()` 行级隔离：你只能看自己的，
  别人只能看别人的；即使页面公开，陌生人没有你的账号也读不到你的内容。
- 真正私密的是 LLM API Key：现在可在界面「🔑 配置你自己的 AI 模型」里填写（存于本机浏览器 localStorage），
  也可放在 `.env`。无论哪种，它都不会上传、不进仓库；密钥只在本机发给本地后端再转发给 LLM 服务商，
  别人下载后用的是他们自己的密钥。

---

## 📁 目录结构

| 路径 | 说明 |
|---|---|
| `server.js` / `index.html` / `js/` | 桌面端 |
| `public/` | 手机端静态页（GitHub Pages 源） |
| `docs/` | GitHub Pages 发布目录（与 `public/` 保持一致） |
| `supabase/schema.sql` | 云端建表脚本 |
| `.env.example` | LLM Key 模板 |

---

## 📄 License

MIT —— 可自由使用、修改、再分发。
