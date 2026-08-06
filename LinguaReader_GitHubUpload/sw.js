/* LinguaReader PWA service worker —— 极简离线外壳
 * 策略：
 *  - 导航请求（index.html）：network-first，离线时回退到缓存，保证打开即用
 *  - 静态资源（js/css/svg/json）：cache-first，加速且离线可用
 * 注意：仅在安全上下文（localhost / https）注册；局域网 http 下浏览器不会激活，
 *       不影响正常访问，仅离线缓存不可用。
 */
const CACHE = "linguareader-v1";
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
  "/icon.svg",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 只缓存同源资源，跨域（如 Supabase CDN）走网络
  if (url.origin !== self.location.origin) return;

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

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
