// Workout Tracker — Service Worker
// Verzija — povečaj ko spremeniš katerokoli datoteko, da se cache osveži
const VERSION = 'v1.4.0';
const CACHE_NAME = `workout-tracker-${VERSION}`;

// Datoteke ki naj se cachirajo za offline delovanje
const CACHE_FILES = [
  './',
  './index.html',
  './manifest.json',
  // Chart.js iz CDN — cachiran ob prvi uporabi (glej fetch handler)
];

// === INSTALL: precachiramo ===
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_FILES))
      .then(() => self.skipWaiting()) // takoj aktiviraj nov SW
  );
});

// === ACTIVATE: počistimo stare cache ===
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// === FETCH: cache-first strategy za offline ===
self.addEventListener('fetch', event => {
  // Ne cachiramo non-GET
  if (event.request.method !== 'GET') return;
  // Ne cachiramo Google Sheets API klicev (sync)
  const url = event.request.url;
  if (url.includes('script.google.com') || url.includes('googleusercontent.com')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      // Ne v cache — fetch + dodaj v cache (za CDN-je tipa Chart.js)
      return fetch(event.request).then(resp => {
        // Samo uspešne odgovore cachiramo
        if (!resp || resp.status !== 200 || resp.type === 'error') return resp;
        const respClone = resp.clone();
        caches.open(CACHE_NAME).then(cache => {
          // Cachiramo CDN datoteke (Chart.js itd.)
          if (url.startsWith('https://cdn') || url.startsWith('https://cdnjs')) {
            cache.put(event.request, respClone);
          }
        });
        return resp;
      }).catch(() => {
        // Offline & ni v cache — vrni minimalen fallback za HTML
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// === SCHEDULED NOTIFICATIONS — glavno za rest timer ===
// Map active timerov, da jih lahko prekličemo
const activeTimers = new Map();

self.addEventListener('message', event => {
  const data = event.data || {};

  if (data.type === 'SCHEDULE_REST_END') {
    const { id, delayMs, label } = data;
    // Prekliči obstoječ timer s tem id-jem
    if (activeTimers.has(id)) {
      clearTimeout(activeTimers.get(id));
    }
    // Drži SW živ z waitUntil + setTimeout (deluje za odmore do ~5min)
    const promise = new Promise(resolve => {
      const tid = setTimeout(() => {
        self.registration.showNotification('⏰ Konec odmora!', {
          body: label || 'Naslednja serija — gremo!',
          tag: 'workout-rest-' + id,
          renotify: true,
          requireInteraction: true,
          vibrate: [400, 150, 400, 150, 600, 150, 400],
          silent: false,
          icon: './icon-192.png',
          badge: './icon-192.png',
          data: { url: './' }
        }).then(() => {
          activeTimers.delete(id);
          resolve();
        }).catch(resolve);
      }, delayMs);
      activeTimers.set(id, tid);
    });
    event.waitUntil(promise);
  }

  if (data.type === 'CANCEL_REST_END') {
    const { id } = data;
    if (activeTimers.has(id)) {
      clearTimeout(activeTimers.get(id));
      activeTimers.delete(id);
    }
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// === KLIK NA NOTIFIKACIJO ===
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Če je app že odprt, focus
      for (const client of clientList) {
        if (client.url.includes('workout') && 'focus' in client) {
          return client.focus();
        }
      }
      // Sicer odpri
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
