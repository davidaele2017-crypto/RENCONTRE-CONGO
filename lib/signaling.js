// Petit serveur de signalisation WebRTC (WebSocket). Ne transporte jamais le
// son/l'image — juste les messages nécessaires à deux navigateurs pour
// s'accorder et négocier une connexion directe (offres/réponses SDP,
// candidats ICE). L'audio/vidéo passe ensuite en pair-à-pair (ou via un
// serveur TURN si configuré, voir lib/iceServers.js).
const { WebSocketServer } = require('ws');
const store = require('./store');
const plans = require('./plans');
const callAuth = require('./callAuth');
const push = require('./push');

// userId -> Set<WebSocket> (plusieurs onglets/appareils possibles)
const connections = new Map();

// Un appel dont le destinataire n'a AUCUNE connexion WebSocket ouverte au
// moment de l'invitation (app fermée) reste "en attente" un moment plutôt
// que d'échouer tout de suite — le temps qu'une notification push l'alerte
// et qu'iel ouvre l'app pour répondre, comme une vraie sonnerie.
// matchId -> { callerId, calleeId, mode, timeoutHandle }
const pendingInvites = new Map();
const RING_TIMEOUT_MS = process.env.RC_TEST_RING_TIMEOUT_MS ? parseInt(process.env.RC_TEST_RING_TIMEOUT_MS, 10) : 45 * 1000;

function addConnection(userId, ws) {
  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId).add(ws);
}

function removeConnection(userId, ws) {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connections.delete(userId);
}

function sendTo(userId, message) {
  const set = connections.get(userId);
  if (!set || set.size === 0) return false;
  const payload = JSON.stringify(message);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
  return true;
}

function clearPendingInvite(matchId) {
  const pending = pendingInvites.get(matchId);
  if (!pending) return;
  clearTimeout(pending.timeoutHandle);
  pendingInvites.delete(matchId);
}

function attachSignaling(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/call/socket')) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const userId = callAuth.verifyToken(url.searchParams.get('token'));
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = userId;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    addConnection(ws.userId, ws);

    // Cette personne vient d'ouvrir l'app (ou de se reconnecter) — si un
    // appel l'attendait (invité pendant qu'elle n'avait aucune connexion
    // ouverte), on le lui délivre maintenant, comme s'il arrivait à l'instant.
    for (const [matchId, pending] of pendingInvites) {
      if (pending.calleeId !== ws.userId) continue;
      clearPendingInvite(matchId);
      sendTo(ws.userId, {
        type: 'incoming-call',
        matchId,
        fromUserId: pending.callerId,
        fromName: pending.fromName,
        fromPhoto: pending.fromPhoto,
        mode: pending.mode
      });
    }

    ws.on('close', () => removeConnection(ws.userId, ws));
    ws.on('error', () => removeConnection(ws.userId, ws));

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!msg || !msg.type || !msg.matchId) return;

      try {
        const match = await store.getMatchById(msg.matchId);
        if (!match || !store.isUserInMatch(match, ws.userId)) return; // pas ton match, on ignore
        const otherUserId = store.otherUserInMatch(match, ws.userId);

        if (msg.type === 'call-invite') {
          // Double sécurité : même si le bouton d'appel est caché côté client
          // pour une conversation bloquée (la page /chat redirige déjà avant),
          // on revérifie ici pour bloquer un message WebSocket bricolé à la main.
          if (await store.isBlocked(ws.userId, otherUserId)) {
            ws.send(JSON.stringify({ type: 'call-failed', matchId: msg.matchId, reason: 'blocked' }));
            return;
          }
          const caller = await store.getUserById(ws.userId);
          const callerPlan = plans.getUserPlan(caller);
          if (!callerPlan.calls) {
            ws.send(JSON.stringify({ type: 'call-failed', matchId: msg.matchId, reason: 'premium-required' }));
            return;
          }
          const callerProfile = await store.getProfile(ws.userId);
          const mode = msg.mode === 'video' ? 'video' : 'audio';
          const fromName = callerProfile ? callerProfile.name : 'Quelqu\'un';
          const fromPhoto = callerProfile ? callerProfile.photo : null;

          const delivered = sendTo(otherUserId, {
            type: 'incoming-call',
            matchId: msg.matchId,
            fromUserId: ws.userId,
            fromName,
            fromPhoto,
            mode
          });

          if (delivered) return;

          // Personne connectée côté destinataire (app fermée) : on prévient
          // par notification push plutôt que d'abandonner l'appel tout de
          // suite — l'appelant continue d'entendre la tonalité d'attente
          // pendant ce temps (comportement déjà géré côté client).
          clearPendingInvite(msg.matchId);
          const timeoutHandle = setTimeout(() => {
            pendingInvites.delete(msg.matchId);
            sendTo(ws.userId, { type: 'call-failed', matchId: msg.matchId, reason: 'no-answer' });
          }, RING_TIMEOUT_MS);
          pendingInvites.set(msg.matchId, { callerId: ws.userId, calleeId: otherUserId, mode, fromName, fromPhoto, timeoutHandle });

          push.notifyUser(otherUserId, {
            title: mode === 'video' ? '📹 Appel vidéo entrant' : '📞 Appel entrant',
            body: `${fromName} t'appelle sur Rencontre Congo`,
            url: `/chat/${msg.matchId}`,
            tag: 'incoming-call',
            isCall: true
          }).catch((err) => console.error('Erreur notification push (appel) :', err.message));
          return;
        }

        // Si l'appelant raccroche/annule pendant qu'un appel est encore "en
        // attente" (destinataire pas encore reconnecté), on ne le laisse pas
        // sonner dans le vide ni déclencher un "no-answer" après coup.
        if ((msg.type === 'call-ended' || msg.type === 'call-declined') && pendingInvites.has(msg.matchId)) {
          clearPendingInvite(msg.matchId);
        }

        // Tous les autres types (call-accepted, call-declined, call-ended,
        // webrtc-offer, webrtc-answer, ice-candidate) : on relaie tel quel à
        // l'autre personne du match, en ajoutant qui l'envoie.
        sendTo(otherUserId, { ...msg, fromUserId: ws.userId });
      } catch (err) {
        console.error('Erreur de signalisation WebSocket :', err);
      }
    });
  });

  return wss;
}

module.exports = { attachSignaling };
