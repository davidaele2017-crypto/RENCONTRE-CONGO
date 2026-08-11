// Notifications push (nouveaux matchs, nouveaux messages) via le standard
// Web Push (protocole VAPID) — pris en charge nativement par tous les
// navigateurs (Chrome/Android, Firefox, Safari/iOS 16.4+ en PWA installée).
//
// ⚠️ Contrairement à CinetPay ou Twilio, ceci ne nécessite AUCUN compte ni
// abonnement tiers payant : les clés VAPID s'auto-génèrent une fois (voir
// README, section Notifications push) et servent juste à signer les envois
// — les navigateurs relaient ensuite via leur propre infrastructure gratuite
// (service Google/Mozilla/Apple selon le navigateur du visiteur).
//
// Tant que VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ne sont pas définies, les
// notifications sont simplement désactivées (aucune erreur) — l'app
// fonctionne normalement sans.
const webpush = require('web-push');
const store = require('./store');

function isConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

if (isConfigured()) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || 'contact@puelainvestment.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

async function sendToSubscription(subscription, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err) {
    // 404/410 = l'abonnement n'existe plus côté navigateur (désinstallé,
    // permission retirée, cache effacé...) — on nettoie plutôt que de
    // réessayer indéfiniment sur une adresse morte.
    const gone = err && (err.statusCode === 404 || err.statusCode === 410);
    return { ok: false, gone, error: err };
  }
}

// Envoie une notification à TOUS les appareils d'un utilisateur (il peut en
// avoir plusieurs — plusieurs navigateurs, plusieurs installations PWA).
// Ne fait jamais échouer l'appelant : une erreur d'envoi est juste loguée.
async function notifyUser(userId, payload) {
  if (!isConfigured()) return;
  let subs = [];
  try {
    subs = await store.getPushSubscriptionsForUser(userId);
  } catch (err) {
    console.error('Erreur lecture des abonnements push :', err.message);
    return;
  }
  for (const sub of subs) {
    const result = await sendToSubscription(sub, payload);
    if (!result.ok) {
      if (result.gone) {
        await store.removePushSubscription(sub.endpoint).catch(() => {});
      } else {
        console.error('Erreur envoi notification push :', result.error && result.error.message);
      }
    }
  }
}

module.exports = { isConfigured, getPublicKey, notifyUser };
