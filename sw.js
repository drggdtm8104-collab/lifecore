// LifeCore Service Worker — オフラインでもアプリの画面自体を開けるようにする。
//
// 更新のたびに CACHE_VERSION を変える（例: "v3.108" のようにAPP_VERSIONと合わせる）。
// 変えないと、古いキャッシュがいつまでも使われ続けて新しい版が反映されない。
const CACHE_VERSION = "v3.150";
const CACHE_NAME = "lifecore-" + CACHE_VERSION;

// 同一オリジンの、アプリを開くために最低限必要なファイルだけを事前キャッシュする。
// Googleフォントは別オリジン（CORSの都合や、必ず取得できる保証がないため）で、
// 取れなければブラウザの代替フォントで表示される——オフライン時の許容できる劣化。
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // v3.108より前の名前が付いたキャッシュ（旧バージョン）を掃除する
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // ページの読み込み（ナビゲーション）は「オンラインなら常に最新」を優先し、
  // 取得できたときだけキャッシュを更新する（ネット優先・オフライン時のみキャッシュ）。
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // それ以外の同一オリジンのGET（manifest・アイコンなど）はキャッシュ優先。
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});

// ---------- プッシュ通知（Phase 4: 時間指定タスクの時刻ごとに個別送信。
//            本文の組み立てはサーバー側（push-server/worker.js）が行う） ----------
self.addEventListener("push", (event) => {
  let data = { title: "LifeCore", body: "" };
  try { if (event.data) data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || "LifeCore", {
      body: data.body || "",
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      // tag指定: プッシュサービス側の再送などで同じ通知が複数回届いても、
      // 端末側では重複して積み重ならず1件の更新として扱われる。
      tag: data.tag || undefined,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })()
  );
});
