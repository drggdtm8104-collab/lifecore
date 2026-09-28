// LifeCore PWA診断用の最小Service Worker（v3.106のオフライン化検討で追加）。
// キャッシュ処理は一切なく、「そもそも登録できるか」だけを確かめるためのもの。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
