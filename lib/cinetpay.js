// Intégration CinetPay (agrégateur Mobile Money : Orange Money, Airtel Money,
// M-Pesa, carte bancaire...) — API Checkout v2.
//
// ⚠️ Implémenté à partir de la documentation publique de CinetPay (docs.cinetpay.com
// et le SDK officiel cinetpay-node-sdk), mais je n'ai pas pu appeler leur vraie API
// pendant le développement (pas de compte marchand). AVANT de passer en argent réel :
//   1. Crée un compte sur https://cinetpay.com (bouton "Devenir partenaire" / marchand).
//   2. Renseigne CINETPAY_API_KEY et CINETPAY_SITE_ID dans .env (voir .env.example).
//   3. Teste un paiement de bout en bout en mode test CinetPay avant d'activer le mode réel.
//   4. Vérifie les noms de champs sur https://docs.cinetpay.com si CinetPay a changé son API.
//
// Tant que CINETPAY_API_KEY n'est pas défini, l'app reste en "mode démo" : changer de
// pack est instantané et gratuit (voir server.js), pratique pour présenter l'app avant
// d'avoir un compte marchand.

const CHECKOUT_BASE = 'https://api-checkout.cinetpay.com/v2';

function isConfigured() {
  return !!(process.env.CINETPAY_API_KEY && process.env.CINETPAY_SITE_ID);
}

// Crée un lien de paiement CinetPay. Retourne { paymentUrl, paymentToken }.
async function initiatePayment({ transactionId, amount, currency, description, customer, notifyUrl, returnUrl }) {
  const body = {
    apikey: process.env.CINETPAY_API_KEY,
    site_id: process.env.CINETPAY_SITE_ID,
    transaction_id: transactionId,
    amount,
    currency,
    description,
    notify_url: notifyUrl,
    return_url: returnUrl,
    channels: 'ALL', // ALL = Mobile Money + carte bancaire ; ou 'MOBILE_MONEY' pour restreindre
    customer_name: customer.name || 'Client',
    customer_surname: customer.surname || 'RencontreCongo',
    customer_phone_number: customer.phone || '',
    customer_email: customer.email || 'client@rencontre-congo.local',
    customer_address: customer.address || 'N/A',
    customer_city: customer.city || 'Kinshasa',
    customer_country: customer.countryCode || 'CD', // CD = RDC, CG = Congo-Brazzaville (ISO 3166-1 alpha-2)
    customer_state: customer.state || 'CD',
    customer_zip_code: customer.zip || '00000',
  };

  const res = await fetch(`${CHECKOUT_BASE}/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();

  if (!res.ok || !json.data || !json.data.payment_url) {
    const msg = json.message || json.description || `Erreur CinetPay (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return { paymentUrl: json.data.payment_url, paymentToken: json.data.payment_token };
}

// Interroge CinetPay pour connaître le vrai statut d'une transaction.
// À TOUJOURS appeler avant de créditer un compte — ne jamais faire confiance
// au seul appel webhook (il peut être falsifié), c'est la recommandation
// officielle de CinetPay.
async function checkPaymentStatus(transactionId) {
  const body = {
    apikey: process.env.CINETPAY_API_KEY,
    site_id: process.env.CINETPAY_SITE_ID,
    transaction_id: transactionId
  };

  const res = await fetch(`${CHECKOUT_BASE}/payment/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();

  return {
    accepted: !!(json.data && json.data.status === 'ACCEPTED'),
    status: json.data ? json.data.status : 'UNKNOWN',
    raw: json
  };
}

module.exports = { isConfigured, initiatePayment, checkPaymentStatus };
