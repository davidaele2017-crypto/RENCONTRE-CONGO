// Petit serveur de signalisation WebRTC (WebSocket). Ne transporte jamais le
// son/l'image — juste les messages nécessaires à deux navigateurs pour
// s'accorder et négocier une connexion directe (offres/réponses SDP,
// candidats ICE). L'audio/vidéo passe ensuite en pair-à-pair (ou via un
// serveur TURN si configuré, voir lib/iceServers.js).
const { WebSocketServer } = require('ws');
const store = require('./store');
const plans = require('./plans');
const callAuth = require('./callAuth');

// userId -> Set<WebSocket> (plusieurs onglets/appareils possibles)
const connections = new Map();

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
          const caller = await store.getUserById(ws.userId);
          const callerPlan = plans.getUserPlan(caller);
          if (!callerPlan.calls) {
            ws.send(JSON.stringify({ type: 'call-failed', matchId: msg.matchId, reason: 'premium-required' }));
            return;
          }
          const callerProfile = await store.getProfile(ws.userId);
          const delivered = sendTo(otherUserId, {
            type: 'incoming-call',
            matchId: msg.matchId,
            fromUserId: ws.userId,
            fromName: callerProfile ? callerProfile.name : 'Quelqu\'un',
            mode: msg.mode === 'video' ? 'video' : 'audio'
          });
          if (!delivered) {
            ws.send(JSON.stringify({ type: 'call-failed', matchId: msg.matchId, reason: 'offline' }));
          }
          return;
        }

        // Tous les autres types (call-accept, call-decline, call-end,
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
