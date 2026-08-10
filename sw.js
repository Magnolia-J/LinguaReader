/* LinguaReader PWA service worker —— 修复版（linguareader-v3）
 * 关键修复：绝不缓存任何 /api/* 动态接口（它们是有状态的，缓存空响应会导致书库被清空）。
 * 静态资源改为 network-first：保证改完代码立即生效，不长期缓存旧版 JS。
 * 版本号提升 → 激活时清除旧毒缓存（v1/v2 可能缓存过空 /api 响应）。
 *
 * 仅在安全上下文（localhost / https）注册；局域网 http 下浏览器不会激活，不影响正常访问。
 */
const CACHE = "linguareader-v3";
const CORE = [
  "/",
  "/index.html",
  "/styles.css",
  "/js/app.js",
  "/js/api.js",
  "/js/sync.js",
  "/js/supabase-config.js",
  "/js/books.js",
  "/js/analysis.js",
  "/js/knowledgebase.js",
  "/js/upload.js",
  "/js/stats.js",
  "/js/backup.js",
  "/icon.svg",
  "/manifest.json"
];

function isApiRequest(url) {
  // 同源且路径以 /api/ 开头 → 动态有状态接口，永远走网络、绝不缓存
  return url.pathname.startsWith("/api/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // 非 GET 直接走网络（POST/PUT/DELETE 不被 SW 拦截）

  const url = new URL(req.url);
  // 跨域（如 Supabase CDN）→ 走网络，不缓存
  if (url.origin !== self.location.origin) return;

  // ★ 核心修复：/api/* 永远走网络，绝不从缓存返回，避免空响应覆盖本地数据
  if (isApiRequest(url)) {
    event.respondWith(fetch(req).catch((e) => {
      console.warn("[sw] /api 请求失败（离线？）：", url.pathname, e.message);
      return new Response(JSON.stringify({ error: "offline" }), {
        status: 503, headers: { "Content-Type": "application/json" }
      });
    }));
    return;
  }

  // 导航请求（index.html）：network-first，离线回退缓存
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("/").then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // 其它静态资源：network-first（保证立即拿到新版），失败再回退缓存
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
