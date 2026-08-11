// Notifications push (nouveaux matchs, nouveaux messages) — voir lib/push.js
// côté serveur. Ce script propose un bouton "Activer les notifications" dans
// la nav (jamais de demande de permission automatique : les navigateurs
// l'exigent suite à un geste utilisateur, sinon ils ignorent la demande).
//
// `partials/nav.ejs` est à l'intérieur de #app-content, donc ce script est
// réexécuté à chaque navigation pjax (voir router.js) — le garde-fou
// __RC_PUSH_READY évite de relancer l'initialisation à chaque fois (même
// principe que calls.js).
(function () {
  if (window.__RC_PUSH_READY) return;
  window.__RC_PUSH_READY = true;

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function subscribeAndSend(registration, publicKey) {
    let sub = await registration.pushManager.getSubscription();
    if (!sub) {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }
    await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });
  }

  async function init() {
    let keyInfo;
    try {
      keyInfo = await (await fetch('/push/public-key')).json();
    } catch (e) {
      return;
    }
    if (!keyInfo.configured || !keyInfo.key) return; // pas de clés VAPID côté serveur -> rien à proposer

    const registration = await navigator.serviceWorker.ready;

    if (Notification.permission === 'granted') {
      // Déjà autorisé sur cet appareil (ex : réinstallation, autre onglet) —
      // on s'assure juste que le serveur a bien l'abonnement à jour.
      subscribeAndSend(registration, keyInfo.key).catch(() => {});
      return;
    }
    if (Notification.permission === 'denied') return; // le navigateur bloque, rien à faire depuis l'app

    const btn = document.getElementById('push-enable-btn');
    if (!btn) return;
    btn.hidden = false;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          await subscribeAndSend(registration, keyInfo.key);
          btn.textContent = '🔔 Activées';
        } else {
          btn.hidden = true; // refusé -> le navigateur ne repropose plus, inutile de garder le bouton
        }
      } catch (e) {
        btn.textContent = '🔔 Activer';
        btn.disabled = false;
      }
    });
  }

  init();
})();
