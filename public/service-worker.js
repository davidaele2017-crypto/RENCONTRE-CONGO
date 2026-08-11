// Service worker minimal : rend l'app installable (PWA) et ajoute une page
// de secours hors-ligne. Ne met PAS en cache les pages dynamiques (chat,
// profils, etc.) — seulement les fichiers statiques — pour ne jamais montrer
// de contenu périmé sur une app où tout change en temps réel.
const CACHE_NAME = 'rencontre-congo-v2';
const PRECACHE_URLS = [
  '/public/css/style.css',
  '/public/js/router.js',
  '/public/js/calls.js',
  '/public/js/chat.js',
  '/public/js/push.js',
  '/public/icons/icon-192.png',
  '/offline.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // laisse passer les formulaires/POST/API sans interception

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ne touche jamais aux requêtes externes (CinetPay, etc.)

  // Navigation entre pages (chargement complet) : réseau en priorité,
  // page hors-ligne si pas de connexion.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Fichiers statiques (CSS/JS/icônes) : cache en priorité, réseau en secours.
  if (url.pathname.startsWith('/public/')) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Tout le reste (données de l'app, WebSocket, appels API) : réseau direct.
});

// --- Notifications push (nouveaux matchs, nouveaux messages) ---------------
// Le service worker tourne même quand l'onglet/l'app est fermé — c'est lui
// qui reçoit la notification envoyée par le serveur (lib/push.js) et
// l'affiche, peu importe si l'app est ouverte ou non.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}

  const title = data.title || 'Rencontre Congo';
  const options = {
    body: data.body || '',
    icon: '/public/icons/icon-192.png',
    badge: '/public/icons/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined, // regroupe les notifs successives du même match (ex: plusieurs messages)
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur la notification : ramène sur l'onglet déjà ouvert s'il existe,
// sinon en ouvre un nouveau sur la bonne page (ex: le chat concerné).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
