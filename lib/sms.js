// Vérification du numéro de téléphone par SMS via Twilio Verify.
// Twilio gère lui-même la génération du code, son expiration (10 min par
// défaut) et la limite de tentatives — on n'a rien à stocker ni à gérer de
// ce côté-là, juste à démarrer une vérification puis à la vérifier.
//
// Documentation officielle : https://www.twilio.com/docs/verify/api
//
// ⚠️ Comme pour CinetPay : tant que les identifiants Twilio ne sont pas
// renseignés dans .env, l'app reste en "mode démo" — un code à 6 chiffres
// est généré nous-mêmes et affiché directement sur la page de vérification
// (au lieu d'être envoyé par SMS), pratique pour tester/présenter l'app
// sans compte Twilio.
const VERIFY_BASE = 'https://verify.twilio.com/v2';

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
}

function authHeader() {
  const creds = `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`;
  return 'Basic ' + Buffer.from(creds).toString('base64');
}

// Démarre l'envoi d'un code par SMS au numéro donné (format E.164, ex: +243812345678).
async function startVerification(phone) {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const res = await fetch(`${VERIFY_BASE}/Services/${serviceSid}/Verifications`, {
    method: 'POST',
    headers: { 'Authorization': authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, Channel: 'sms' })
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || `Erreur Twilio (HTTP ${res.status})`);
  }
  return { status: json.status };
}

// Vérifie le code saisi par l'utilisateur.
async function checkVerification(phone, code) {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const res = await fetch(`${VERIFY_BASE}/Services/${serviceSid}/VerificationCheck`, {
    method: 'POST',
    headers: { 'Authorization': authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, Code: code })
  });
  const json = await res.json();
  if (!res.ok) return { approved: false, status: json.status || 'error' };
  return { approved: json.status === 'approved', status: json.status };
}

module.exports = { isConfigured, startVerification, checkVerification };
