/* =========================================================
 * LinguaReader 外语阅读工作台 —— Electron 主进程
 * 职责：
 *  - 找到可用端口，启动本地服务（fork server.js，使用 Electron 自带的 Node）
 *  - 打开应用窗口加载本地服务页面（自带 Chromium，无需系统浏览器）
 *  - 把数据目录指向可写位置（用户数据目录），首次运行从旧开发目录迁移
 *  - 单实例锁、退出时清理子进程、外部链接用系统浏览器打开
 * 说明：本文件不包含任何 WorkBuddy 专属路径或依赖，应用可完全独立运行。
 * ========================================================= */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { fork } = require("child_process");

const isPackaged = app.isPackaged;
// 应用源码根目录：开发时为项目根；打包后在 asar 内（app.getAppPath()）
const APP_ROOT = app.getAppPath();

// 单实例锁：避免双击多次启动多个服务/窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
  // 在 ES Module 顶层 return 不被允许，但本文件是 CommonJS，直接退出进程
  process.exit(0);
}

let mainWindow = null;
let serverProcess = null;
let serverPort = 3007;

/* ---------- 数据目录（必须可写） ---------- */
function getUserDataDirs() {
  const userData = app.getPath("userData");
  return {
    dataDir: path.join(userData, "data"),
    backupDir: path.join(userData, "WorkbenchBackup")
  };
}
// 开发态直接复用项目内 data，便于调试；打包态使用用户数据目录（asar 只读，不能写）
function resolveDirs() {
  if (isPackaged) {
    const { dataDir, backupDir } = getUserDataDirs();
    return { dataDir, backupDir, migrate: true };
  }
  return {
    dataDir: path.join(APP_ROOT, "data"),
    backupDir: path.join(APP_ROOT, "WorkbenchBackup"),
    migrate: false
  };
}

// 首次运行：把用户在开发目录（D:\LinguaReader）里的真实数据一次性迁移到用户数据目录
// 这样打包后的应用自带用户的书库/进度/划线，之后完全自包含，不再依赖该开发目录。
const LEGACY_DATA_DIR = "D:\\LinguaReader\\data";
function migrateLegacyData(dataDir) {
  try {
    if (fs.existsSync(path.join(dataDir, "store.json"))) return; // 已有数据，跳过
    if (!fs.existsSync(LEGACY_DATA_DIR) || !fs.existsSync(path.join(LEGACY_DATA_DIR, "store.json"))) return;
    copyDir(LEGACY_DATA_DIR, dataDir);
    const legacyBackup = path.join("D:\\LinguaReader", "WorkbenchBackup");
    const targetBackup = path.join(app.getPath("userData"), "WorkbenchBackup");
    if (fs.existsSync(legacyBackup)) copyDir(legacyBackup, targetBackup);
    console.log("[electron] 已从开发目录迁移本地数据到：" + dataDir);
  } catch (e) {
    console.warn("[electron] 数据迁移失败（可手动拷贝）：", e.message);
  }
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* ---------- 端口工具 ---------- */
function getFreePort(start) {
  return new Promise((resolve) => {
    const tryOnce = (p) => {
      const srv = net.createServer();
      srv.once("error", () => { try { srv.close(); } catch (e) {} tryOnce(p + 1); });
      srv.once("listening", () => { try { srv.close(); } catch (e) {} resolve(p); });
      srv.listen(p, "127.0.0.1");
    };
    tryOnce(start);
  });
}
function waitForPort(port, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const c = net.connect(port, "127.0.0.1");
      c.on("connect", () => { c.destroy(); resolve(); });
      c.on("error", () => {
        c.destroy();
        if (Date.now() - t0 > timeoutMs) reject(new Error("本地服务启动超时"));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

/* ---------- 启动本地服务（fork server.js） ---------- */
async function startLocalServer(dataDir, backupDir) {
  serverPort = await getFreePort(3007);
  const env = Object.assign({}, process.env, {
    PORT: String(serverPort),
    LR_DATA_DIR: dataDir,
    LR_BACKUP_DIR: backupDir,
    ELECTRON_RUN_AS_NODE: "1" // 让子进程以纯 Node 模式运行 server.js（不加载 Electron GUI 模块）
  });
  serverProcess = fork(path.join(APP_ROOT, "server.js"), [], {
    env,
    silent: false,
    stdio: ["ignore", "inherit", "inherit"]
  });
  serverProcess.on("exit", (code) => {
    if (code && code !== 0) console.error("[electron] 本地服务进程退出，code=" + code);
  });
  serverProcess.on("error", (e) => console.error("[electron] 本地服务启动错误：", e.message));
  await waitForPort(serverPort);
  console.log("[electron] 本地服务已就绪：http://127.0.0.1:" + serverPort + "/");
}

/* ---------- 创建窗口 ---------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "外语阅读工作台",
    icon: path.join(APP_ROOT, "app-icon.png"),
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      enableRemoteModule: false
    }
  });
  mainWindow.removeMenu(); // 隐藏默认菜单，呈现为独立应用
  mainWindow.loadURL("http://127.0.0.1:" + serverPort + "/");

  // 外部链接（如 Supabase 控制台、文档）用系统默认浏览器打开，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

/* ---------- 生命周期 ---------- */
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
app.on("window-all-closed", () => { app.quit(); });
app.on("before-quit", () => {
  if (serverProcess) { try { serverProcess.kill(); } catch (e) {} serverProcess = null; }
});
app.on("activate", () => { if (!mainWindow) createWindow(); });

app.whenReady().then(async () => {
  try {
    const { dataDir, backupDir, migrate } = resolveDirs();
    if (migrate) migrateLegacyData(dataDir);
    await startLocalServer(dataDir, backupDir);
    createWindow();
  } catch (e) {
    console.error("[electron] 启动失败：", e && e.message ? e.message : e);
    app.quit();
  }
});
