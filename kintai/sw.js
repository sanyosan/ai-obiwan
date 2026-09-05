/**
 * Service Worker
 *
 * 画面まわり（HTML/CSS/JS/アイコン）だけをキャッシュする。
 * 打刻や予定のやり取りは別ドメイン（Apps Script）なので一切キャッシュしない。
 * 版を上げたいときは CACHE の数字を1つ増やす。
 */
var CACHE = 'kintai-v1';
var SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // 打刻などのPOSTは素通し
  if (new URL(req.url).origin !== self.location.origin) return;  // APIは素通し

  // 画面の遷移はネット優先。つながらなければキャッシュを出す
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('index.html') || caches.match('./');
      })
    );
    return;
  }

  // それ以外はキャッシュ優先で、裏で更新しておく
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
