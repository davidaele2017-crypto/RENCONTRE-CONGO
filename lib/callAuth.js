// Jeton signé de courte durée pour authentifier la connexion WebSocket des
// appels (audio/vidéo). On évite de brancher express-session directement sur
// le serveur WebSocket (plus simple, moins couplé) : le navigateur récupère un
// jeton via GET /call/token (protégé par la session normale), puis l'envoie
// en paramètre de l'URL WebSocket. Le serveur le vérifie ici.
const crypto = require('crypto');

function secret() {
  return process.env.SESSION_SECRET || 'congo-rencontre-secret-dev';
}

// jeton = userId.expiration.signature
function createToken(userId) {
  const expires = Date.now() + 60 * 1000; // 60 secondes pour se connecter
  const payload = `${userId}.${expires}`;
  const signature = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  const payload = `${userId}.${expires}`;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() > parseInt(expires, 10)) return null;
  return userId;
}

module.exports = { createToken, verifyToken };
