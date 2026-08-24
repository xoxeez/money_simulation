/* =========================================================
   소학행 자산 플래너 — Service Worker (PWA)
   · 앱 셸(로컬 파일)을 캐시해 오프라인에서도 열림
   · 캐시 우선(cache-first) + 네트워크 폴백
   · 새 버전 배포 시 CACHE 이름의 버전만 올리면 자동 갱신
========================================================= */
const CACHE = "sohak-planner-v11";

/* 오프라인에 필요한 로컬 자원 (같은 폴더 기준) */
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

/* 설치: 앱 셸 캐시 */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

/* 활성화: 옛 캐시 정리 */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 요청 처리 */
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* 외부 CDN(차트/폰트/파이어베이스) & API는 네트워크 우선, 실패 시 캐시 */
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  /* 로컬 파일은 캐시 우선, 없으면 네트워크 → 캐시에 저장 */
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
